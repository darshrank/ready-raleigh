"""ElevenLabs text-to-speech with an on-disk cache, so repeated lines (and offline demos) cost nothing."""

import hashlib
import re
import secrets

import httpx
from fastapi import APIRouter
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from .config import BACKEND_DIR, ELEVENLABS_API_KEY, ELEVENLABS_MODEL, ELEVENLABS_VOICE_ID, ServiceHealth, error_response, log, redact

router = APIRouter()
health = ServiceHealth(bool(ELEVENLABS_API_KEY))

TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
CACHE_DIR = BACKEND_DIR / ".cache" / "tts"
MAX_CHARS = 1500
VOICE_ID_RE = re.compile(r"[A-Za-z0-9]{1,64}")


class TtsRequest(BaseModel):
    text: str
    voiceId: str | None = None


def _clip(text: str) -> str:
    text = " ".join(text.split())
    if len(text) <= MAX_CHARS:
        return text
    cut = text[:MAX_CHARS]
    return cut.rsplit(" ", 1)[0] if " " in cut else cut


def _detail(r: httpx.Response) -> str:
    try:
        body = r.json()
    except ValueError:
        return redact(r.text or r.reason_phrase, 200)
    detail = body.get("detail") if isinstance(body, dict) else body
    if isinstance(detail, dict):
        detail = detail.get("message") or detail.get("status")
    return redact(detail or r.reason_phrase, 200)


@router.post("/api/voice/tts")
async def tts(body: TtsRequest) -> Response:
    text = _clip(body.text)
    if not text:
        return error_response("text is empty", 422)
    voice_id = (body.voiceId or "").strip() or ELEVENLABS_VOICE_ID
    if not VOICE_ID_RE.fullmatch(voice_id):
        return error_response("voiceId is invalid", 422)
    path = CACHE_DIR / f"{hashlib.sha256(f'{voice_id}|{ELEVENLABS_MODEL}|{text}'.encode()).hexdigest()}.mp3"
    if path.is_file():
        return FileResponse(path, media_type="audio/mpeg", headers={"X-TTS-Cache": "hit"})
    if not ELEVENLABS_API_KEY:
        return error_response("ElevenLabs is not configured (ELEVENLABS_API_KEY is missing)")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                TTS_URL.format(voice_id=voice_id),
                params={"output_format": "mp3_44100_128"},
                headers={"xi-api-key": ELEVENLABS_API_KEY, "accept": "audio/mpeg"},
                json={"text": text, "model_id": ELEVENLABS_MODEL},
            )
    except httpx.HTTPError as e:
        health.failed()
        log.warning("ElevenLabs unreachable: %s", type(e).__name__)
        return error_response(f"ElevenLabs is unreachable ({type(e).__name__})")
    if r.status_code != 200 or not r.content:
        if r.status_code not in (400, 404, 422):  # request-specific errors don't mean the service is down
            health.failed()
        message = f"ElevenLabs error {r.status_code}: {_detail(r)}"
        log.warning(message)
        return error_response(message)
    health.succeeded()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.stem}.{secrets.token_hex(4)}.tmp")
    tmp.write_bytes(r.content)
    tmp.replace(path)
    return Response(r.content, media_type="audio/mpeg", headers={"X-TTS-Cache": "miss"})
