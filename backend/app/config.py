"""Settings from the environment plus small helpers shared by the routers.

Secrets are read only here. Never log them or put them in a response; pass error text through `redact`.
"""

import logging
import math
import os
import re
import time
from pathlib import Path
from typing import Annotated
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv
from fastapi.responses import JSONResponse
from pydantic import BeforeValidator, StringConstraints

BACKEND_DIR = Path(__file__).resolve().parents[1]
# load_dotenv never overrides, so precedence is: real environment, backend/.env, repo-root .env.
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
# httpx logs full request URLs at INFO, and an RPC URL can embed an API key.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger("faultline")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, "").strip() or default


GEMINI_API_KEY = _env("GEMINI_API_KEY")
GEMINI_MODEL = _env("GEMINI_MODEL", "gemini-2.5-flash")
ELEVENLABS_API_KEY = _env("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = _env("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
ELEVENLABS_MODEL = _env("ELEVENLABS_MODEL", "eleven_multilingual_v2")
DATABASE_URL = _env("DATABASE_URL")
SOLANA_RPC_URL = _env("SOLANA_RPC_URL", "https://api.devnet.solana.com")
SOLANA_PAYER_SECRET_KEY = _env("SOLANA_PAYER_SECRET_KEY")
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in _env("ALLOWED_ORIGINS").split(",") if o.strip()]

_SECRETS = sorted(
    {
        s
        for s in (
            GEMINI_API_KEY,
            ELEVENLABS_API_KEY,
            SOLANA_PAYER_SECRET_KEY,
            DATABASE_URL,
            unquote(urlparse(DATABASE_URL).password or ""),
            _env("CENSUS_API_KEY"),
        )
        if len(s) >= 8
    },
    key=len,
    reverse=True,
)


def redact(text: object, limit: int = 300) -> str:
    """Error text that is safe to log or return: known secret values removed, length capped."""
    out = str(text)
    for secret in _SECRETS:
        out = out.replace(secret, "***")
    return out[:limit]


def error_response(message: str, status: int = 503) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


class ServiceHealth:
    """A configured service counts as down for a cooldown after a failed call, so /api/health tracks reachability."""

    def __init__(self, configured: bool, cooldown: float = 60.0) -> None:
        self.configured = configured
        self.cooldown = cooldown
        self._down_until = 0.0

    @property
    def up(self) -> bool:
        return self.configured and time.monotonic() >= self._down_until

    def failed(self) -> None:
        self._down_until = time.monotonic() + self.cooldown

    def succeeded(self) -> None:
        self._down_until = 0.0


CITY_ID_PATTERN = r"^[A-Za-z0-9_-]{1,40}$"
CITY_ID_RE = re.compile(CITY_ID_PATTERN)
CityId = Annotated[str, StringConstraints(pattern=CITY_ID_PATTERN)]
# The browser engine may send whole numbers as floats (e.g. 1200.0000001); round instead of rejecting.
LaxInt = Annotated[int, BeforeValidator(lambda v: round(v) if isinstance(v, float) and math.isfinite(v) else v)]
