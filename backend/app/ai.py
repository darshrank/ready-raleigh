"""AI Commander and after-action debrief via Gemini, grounded in the context the browser engine computes."""

import asyncio
import json
from functools import cache
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field

from .config import GEMINI_API_KEY, GEMINI_MODEL, CityId, ServiceHealth, error_response, log, redact

router = APIRouter()
health = ServiceHealth(bool(GEMINI_API_KEY))

TIMEOUT_SECONDS = 25
MAX_PROMPT_CHARS = 64_000
MAX_ENUM_IDS = 200

_RULES = """- Every number you state must appear in the context: write it as digits, exactly as given. Never invent, estimate or calculate new numbers.
- Use only the units the context states (for example from key names like detourMinutes). Never add a currency or unit it does not state.
- This is a scenario simulation, not an emergency forecast. Never give real-world emergency instructions."""

COMMANDER_INSTRUCTION = f"""You are the AI Commander of FAULTLINE, a multiplayer disaster-planning game played on real city data (road networks, census population, hazard zones). A player planning against the scenario asks you a question; the game engine's analysis is the JSON context.
- answer: at most 3 short sentences that directly answer the question.
- candidateId: recommend at most one candidate by its exact "id" from context.candidates, or null if none fits. If the context gives a remaining budget, only recommend what the player can afford.
- Be concrete about places: use the zone, road, neighborhood and facility names from the context.
- evidence: 1 to 3 short facts from the context that support the answer.
- tradeoff: one sentence on what the recommendation costs or leaves exposed.
- limitations: one sentence on what this analysis cannot tell the player.
{_RULES}"""

DEBRIEF_INSTRUCTION = f"""You are the AI Commander of FAULTLINE, a multiplayer disaster-planning game played on real city data. Write the after-action debrief of the round that just ended from the game engine's results in the JSON context.
- text: 4 to 6 sentences of plain spoken English. It is read aloud by a voice, so use no markdown, lists, emoji, symbols or abbreviations.
- Name the places, roads and facilities that mattered most, and say what worked and what failed.
- End with one actionable lesson for the next round.
{_RULES}"""


class CommanderRequest(BaseModel):
    cityId: CityId
    question: str = Field(min_length=1, max_length=2000)
    context: dict[str, Any] = Field(default_factory=dict)


class DebriefRequest(BaseModel):
    cityId: CityId
    context: dict[str, Any] = Field(default_factory=dict)


class AIError(Exception):
    pass


def _string(**kwargs: Any) -> types.Schema:
    return types.Schema(type=types.Type.STRING, **kwargs)


def _commander_schema(candidate_ids: list[str]) -> types.Schema:
    enum = {"enum": candidate_ids} if 0 < len(candidate_ids) <= MAX_ENUM_IDS else {}
    fields = {
        "answer": _string(),
        "candidateId": _string(nullable=True, **enum),
        "evidence": types.Schema(type=types.Type.ARRAY, items=_string(), max_items=3),
        "tradeoff": _string(),
        "limitations": _string(),
    }
    return types.Schema(type=types.Type.OBJECT, properties=fields, required=list(fields), property_ordering=list(fields))


DEBRIEF_SCHEMA = types.Schema(type=types.Type.OBJECT, properties={"text": _string()}, required=["text"])

# Google retires model names for new API keys, so a 404 falls back to the always-current alias.
FALLBACK_MODEL = "gemini-flash-latest"
_model = GEMINI_MODEL
_zero_thinking = True


@cache
def _client() -> genai.Client:
    return genai.Client(api_key=GEMINI_API_KEY, http_options=types.HttpOptions(timeout=TIMEOUT_SECONDS * 1000))


async def _call(config: types.GenerateContentConfig, prompt: str) -> types.GenerateContentResponse:
    global _model, _zero_thinking
    # Each fallback below can trigger only once per process, so this makes at most three attempts.
    while True:
        thinking = types.ThinkingConfig(thinking_budget=0) if _zero_thinking else None
        try:
            return await _client().aio.models.generate_content(
                model=_model, contents=prompt, config=config.model_copy(update={"thinking_config": thinking})
            )
        except errors.ClientError as e:
            if e.code == 404 and _model != FALLBACK_MODEL:
                log.warning("Gemini model %s is unavailable to this key; using %s (set GEMINI_MODEL)", _model, FALLBACK_MODEL)
                _model = FALLBACK_MODEL
            elif _zero_thinking and "thinking" in (e.message or "").lower():
                _zero_thinking = False  # thinking-only models (e.g. 2.5 Pro) reject a zero budget
            else:
                raise


def _describe(e: Exception) -> str:
    if isinstance(e, TimeoutError):
        return f"Gemini timed out after {TIMEOUT_SECONDS} s"
    if isinstance(e, errors.APIError):
        return f"Gemini error {e.code}: {e.message or e.status}"
    return f"Gemini is unreachable ({type(e).__name__})"


async def _generate(instruction: str, prompt: str, schema: types.Schema) -> dict[str, Any]:
    if not GEMINI_API_KEY:
        raise AIError("Gemini is not configured (GEMINI_API_KEY is missing)")
    config = types.GenerateContentConfig(
        system_instruction=instruction,
        temperature=0.4,
        response_mime_type="application/json",
        response_schema=schema,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS):
            response = await _call(config, prompt)
    except Exception as e:
        health.failed()
        message = redact(_describe(e))
        log.warning(message)
        raise AIError(message) from None
    health.succeeded()
    try:
        data = json.loads(response.text or "")
    except ValueError:
        raise AIError("Gemini returned malformed JSON") from None
    if not isinstance(data, dict):
        raise AIError("Gemini returned an unexpected shape")
    return data


def _prompt(city_id: str, context: dict[str, Any], question: str | None = None) -> str:
    lines = [f"City: {city_id}"]
    if question:
        lines.append(f"Player question: {question}")
    lines.append("Context (JSON from the game engine):")
    lines.append(json.dumps(context, ensure_ascii=False, separators=(",", ":")))
    return "\n".join(lines)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


@router.post("/api/ai/commander", response_model=None)
async def commander(body: CommanderRequest) -> dict[str, Any] | JSONResponse:
    candidates = body.context.get("candidates")
    ids = list(
        dict.fromkeys(
            str(c["id"]) for c in (candidates if isinstance(candidates, list) else []) if isinstance(c, dict) and c.get("id") is not None
        )
    )
    prompt = _prompt(body.cityId, body.context, body.question.strip())
    if len(prompt) > MAX_PROMPT_CHARS:
        return error_response("context is too large", 413)
    try:
        data = await _generate(COMMANDER_INSTRUCTION, prompt, _commander_schema(ids))
    except AIError as e:
        return error_response(str(e))
    answer = _text(data.get("answer"))
    if not answer:
        return error_response("Gemini returned an empty answer")
    candidate = data.get("candidateId")
    evidence = data.get("evidence")
    return {
        "answer": answer,
        "candidateId": candidate if candidate in ids else None,
        "evidence": [t for t in map(_text, evidence if isinstance(evidence, list) else []) if t][:3],
        "tradeoff": _text(data.get("tradeoff")),
        "limitations": _text(data.get("limitations")),
    }


@router.post("/api/ai/debrief", response_model=None)
async def debrief(body: DebriefRequest) -> dict[str, str] | JSONResponse:
    prompt = _prompt(body.cityId, body.context)
    if len(prompt) > MAX_PROMPT_CHARS:
        return error_response("context is too large", 413)
    try:
        data = await _generate(DEBRIEF_INSTRUCTION, prompt, DEBRIEF_SCHEMA)
    except AIError as e:
        return error_response(str(e))
    text = _text(data.get("text"))
    return {"text": text} if text else error_response("Gemini returned an empty debrief")
