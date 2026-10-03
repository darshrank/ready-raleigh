"""Tiger Data (PostgreSQL + TimescaleDB) persistence: rounds, player actions, leaderboard and stats."""

import asyncio
import json
from contextlib import suppress
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .config import CITY_ID_PATTERN, DATABASE_URL, CityId, LaxInt, error_response, log, redact
from .rooms import clean_id, clean_name

router = APIRouter()
pool: asyncpg.Pool | None = None
timescale = False
hypertables: set[str] = set()

RETRY_SECONDS = 60
MAX_ACTIONS = 50
MAX_PLAN_CHARS = 256 * 1024

SCHEMA = """
CREATE TABLE IF NOT EXISTS rounds (time TIMESTAMPTZ NOT NULL DEFAULT now(), room_code TEXT, city_id TEXT NOT NULL, seed BIGINT, player_name TEXT, score INT, protected INT, at_risk INT, spent BIGINT, plan JSONB);
CREATE TABLE IF NOT EXISTS player_actions (time TIMESTAMPTZ NOT NULL DEFAULT now(), room_code TEXT, player_id TEXT, city_id TEXT, action TEXT, intervention TEXT, lon DOUBLE PRECISION, lat DOUBLE PRECISION, cost BIGINT, metadata JSONB);
CREATE INDEX IF NOT EXISTS rounds_city_score_idx ON rounds (city_id, score DESC);
"""


async def _open() -> asyncpg.Pool:
    global timescale
    new_pool = await asyncpg.create_pool(
        DATABASE_URL,
        min_size=1,
        max_size=5,
        statement_cache_size=0,
        command_timeout=10,
        timeout=10,
        max_inactive_connection_lifetime=120,
    )
    try:
        async with new_pool.acquire() as con:
            await con.execute(SCHEMA)
            timescale = await con.fetchval("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')")
            for table in ("rounds", "player_actions"):
                try:
                    await con.execute(f"SELECT create_hypertable('{table}', 'time', if_not_exists => TRUE, migrate_data => TRUE)")
                    hypertables.add(table)
                except asyncpg.PostgresError as e:
                    log.warning("create_hypertable(%s) failed, keeping a plain table: %s", table, redact(e))
    except BaseException:
        await new_pool.close()
        raise
    return new_pool


async def connect_forever() -> None:
    """Connect in the background and keep retrying, so startup never waits on (or dies with) the network."""
    global pool
    if not DATABASE_URL:
        log.warning("DATABASE_URL is not set; rounds, actions, leaderboard and stats are disabled")
        return
    while pool is None:
        try:
            pool = await _open()
            log.info("database connected (timescaledb: %s, hypertables: %s)", timescale, sorted(hypertables) or "none")
        except Exception as e:
            log.warning("database unavailable (%s); retrying in %d s", redact(f"{type(e).__name__}: {e}"), RETRY_SECONDS)
            await asyncio.sleep(RETRY_SECONDS)


async def close() -> None:
    global pool
    if pool is not None:
        with suppress(Exception):
            await asyncio.wait_for(pool.close(), 5)
        pool = None


def _failure(e: Exception) -> str:
    log.warning("database error: %s", redact(f"{type(e).__name__}: {e}"))
    return f"Database error ({type(e).__name__})"


def _room_code(code: str | None) -> str | None:
    return clean_id(code).upper()[:8] or None


def _avg(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


class RoundIn(BaseModel):
    roomCode: str | None = None
    cityId: CityId
    seed: LaxInt | None = None
    playerName: str = ""
    score: LaxInt
    protected: LaxInt = 0
    atRisk: LaxInt = 0
    spent: LaxInt = 0
    plan: dict[str, Any] = Field(default_factory=dict)


class ActionIn(BaseModel):
    model_config = ConfigDict(extra="allow")  # extra fields are kept in the metadata column

    action: str = Field(max_length=64)
    intervention: str = Field(default="", max_length=64)
    lon: float | None = None
    lat: float | None = None
    cost: LaxInt = 0


class ActionsIn(BaseModel):
    roomCode: str | None = None
    playerId: str = ""
    cityId: CityId
    actions: list[ActionIn] = Field(default_factory=list)


CityQuery = Annotated[str | None, Query(pattern=CITY_ID_PATTERN)]


@router.post("/api/rounds")
async def save_round(body: RoundIn) -> dict[str, Any]:
    if pool is None:
        return {"ok": False, "error": "Database unavailable"}
    plan = json.dumps(body.plan, separators=(",", ":"))
    if len(plan) > MAX_PLAN_CHARS:
        return {"ok": False, "error": "plan is too large"}
    try:
        await pool.execute(
            "INSERT INTO rounds (room_code, city_id, seed, player_name, score, protected, at_risk, spent, plan)"
            " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)",
            _room_code(body.roomCode),
            body.cityId,
            body.seed,
            clean_name(body.playerName),
            body.score,
            body.protected,
            body.atRisk,
            body.spent,
            plan,
        )
    except Exception as e:
        return {"ok": False, "error": _failure(e)}
    return {"ok": True}


@router.post("/api/actions")
async def save_actions(body: ActionsIn) -> dict[str, Any]:
    if pool is None:
        return {"ok": False, "error": "Database unavailable"}
    room_code, player_id = _room_code(body.roomCode), clean_id(body.playerId) or None
    rows = [
        (room_code, player_id, body.cityId, a.action, a.intervention, a.lon, a.lat, a.cost, json.dumps(a.model_extra) if a.model_extra else None)
        for a in body.actions[:MAX_ACTIONS]
    ]
    try:
        if rows:
            await pool.executemany(
                "INSERT INTO player_actions (room_code, player_id, city_id, action, intervention, lon, lat, cost, metadata)"
                " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)",
                rows,
            )
    except Exception as e:
        return {"ok": False, "error": _failure(e)}
    return {"ok": True}


@router.get("/api/leaderboard", response_model=None)
async def leaderboard(cityId: CityQuery = None, limit: int = 10) -> dict[str, Any] | JSONResponse:
    if pool is None:
        return error_response("Database unavailable")
    try:
        rows = await pool.fetch(
            "SELECT player_name, score, time, room_code FROM rounds"
            " WHERE ($1::text IS NULL OR city_id = $1) AND score IS NOT NULL"
            " ORDER BY score DESC, time LIMIT $2",
            cityId,
            max(1, min(limit, 100)),
        )
    except Exception as e:
        return error_response(_failure(e))
    return {
        "entries": [
            {"playerName": r["player_name"], "score": r["score"], "time": r["time"].isoformat(), "roomCode": r["room_code"]}
            for r in rows
        ]
    }


@router.get("/api/stats", response_model=None)
async def stats(cityId: CityQuery = None) -> dict[str, Any] | JSONResponse:
    if pool is None:
        return error_response("Database unavailable")
    bucket = "time_bucket('1 hour', time)" if timescale else "date_trunc('hour', time)"
    where = "($1::text IS NULL OR city_id = $1)"
    try:
        async with pool.acquire() as con:
            total = await con.fetchrow(
                f"SELECT count(*) AS plays, avg(score)::float8 AS avg, max(score) AS best FROM rounds WHERE {where}", cityId
            )
            hourly = await con.fetch(
                f"SELECT {bucket} AS bucket, count(*) AS plays, avg(score)::float8 AS avg FROM rounds"
                f" WHERE {where} AND time > now() - interval '48 hours' GROUP BY 1 ORDER BY 1",
                cityId,
            )
    except Exception as e:
        return error_response(_failure(e))
    return {
        "plays": total["plays"],
        "avgScore": _avg(total["avg"]),
        "best": total["best"],
        "hourly": [{"bucket": r["bucket"].isoformat(), "plays": r["plays"], "avgScore": _avg(r["avg"])} for r in hourly],
    }
