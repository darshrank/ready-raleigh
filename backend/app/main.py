"""FAULTLINE API: realtime rooms, Gemini, ElevenLabs, Tiger Data and Solana proofs. Every service degrades to a
JSON error so the game keeps working offline."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from . import ai, db, proof, rooms, voice
from .config import ALLOWED_ORIGINS

LAN_ORIGIN_REGEX = (
    r"https?://(localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?"
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    tasks = [asyncio.create_task(db.connect_forever()), asyncio.create_task(rooms.cleanup_forever())]
    yield
    for task in tasks:
        task.cancel()
    await db.close()


app = FastAPI(title="FAULTLINE API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=LAN_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_private_network=True,
    expose_headers=["X-TTS-Cache"],
)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    detail = [{"loc": list(e.get("loc", ())), "msg": e.get("msg", "")} for e in exc.errors()]
    return JSONResponse({"error": "Invalid request", "detail": detail}, status_code=422)


for module in (rooms, ai, voice, db, proof):
    app.include_router(module.router)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "services": {
            "gemini": ai.health.up,
            "elevenlabs": voice.health.up,
            "database": db.pool is not None,
            "solana": proof.PAYER is not None,
        },
    }
