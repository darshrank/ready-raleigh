"""In-memory multiplayer rooms over WebSockets.

Room mutations never await, so each message handler runs atomically on the event loop and needs no lock.
Every socket has its own send queue, so broadcasts keep their order and a slow phone never blocks the room.
"""

import asyncio
import json
import math
import secrets
import time
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import CITY_ID_RE, error_response, log

router = APIRouter()

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 5
MAX_ROOMS = 1000
MAX_PLAYERS = 40
MAX_MESSAGE_BYTES = 64 * 1024
MAX_SEND_QUEUE = 256
BRIEFING_SECONDS = 15
IDLE_ROOM_SECONDS = 3 * 3600

CLOSE_BAD_REQUEST = 4400
CLOSE_KICKED = 4403
CLOSE_NOT_FOUND = 4404
CLOSE_FULL = 4409


def now_ms() -> int:
    return int(time.time() * 1000)


def clean_name(raw: object, default: str = "Player") -> str:
    printable = "".join(ch for ch in str(raw or "") if ch.isprintable())
    return " ".join(printable.split())[:20].strip() or default


def clean_id(raw: object) -> str:
    return "".join(ch for ch in str(raw or "") if ch.isprintable() and not ch.isspace())[:64]


def as_int(value: object, default: int, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return default
    return max(lo, min(hi, int(value)))


def _reject_constant(name: str) -> None:
    raise ValueError(name)  # NaN/Infinity would make the broadcast invalid JSON for browsers


def parse_message(text: object) -> dict[str, Any] | None:
    if not isinstance(text, str) or len(text) > MAX_MESSAGE_BYTES or len(text.encode()) > MAX_MESSAGE_BYTES:
        return None
    try:
        msg = json.loads(text, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        return None
    return msg if isinstance(msg, dict) else None


@dataclass
class Player:
    id: str
    name: str
    connected: bool = False
    status: str = "lobby"
    spent: int = 0
    placed: int = 0
    result: dict[str, Any] | None = None

    def state(self, host: bool) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "host": host,
            "connected": self.connected,
            "status": self.status,
            "spent": self.spent,
            "placed": self.placed,
            "result": self.result,
        }


class Conn:
    """One open socket. A player may have several (two tabs, or a reconnect racing the old socket)."""

    def __init__(self, ws: WebSocket, pid: str) -> None:
        self.ws = ws
        self.pid = pid
        self.queue: asyncio.Queue[str | None] = asyncio.Queue()
        self.close_code: int | None = None

    def send(self, text: str) -> None:
        if self.close_code is not None:
            return
        if self.queue.qsize() >= MAX_SEND_QUEUE:
            # The client stopped reading; drop the stale backlog and let it reconnect for a fresh state.
            while not self.queue.empty():
                self.queue.get_nowait()
            self.close(1013)
        else:
            self.queue.put_nowait(text)

    def close(self, code: int, message: str | None = None) -> None:
        if self.close_code is None:
            if message:
                self.queue.put_nowait(json.dumps({"type": "error", "message": message}))
            self.close_code = code
            self.queue.put_nowait(None)

    async def pump(self) -> None:
        try:
            while (text := await self.queue.get()) is not None:
                await self.ws.send_text(text)
            await self.ws.close(self.close_code or 1000)
        except Exception:
            pass  # the receive loop sees the disconnect and cleans up


@dataclass
class Room:
    code: str
    host_id: str
    phase: str = "lobby"
    city_id: str | None = None
    planning_seconds: int = 120
    seed: int | None = None
    round: int = 0
    started_at: int | None = None
    deadline: int | None = None
    players: dict[str, Player] = field(default_factory=dict)
    conns: set[Conn] = field(default_factory=set)
    kicked: set[str] = field(default_factory=set)
    idle_since: float = field(default_factory=time.monotonic)

    def state(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "hostId": self.host_id,
            "phase": self.phase,
            "cityId": self.city_id,
            "planningSeconds": self.planning_seconds,
            "seed": self.seed,
            "round": self.round,
            "startedAt": self.started_at,
            "deadline": self.deadline,
            "players": [p.state(p.id == self.host_id) for p in self.players.values()],
        }

    def broadcast(self) -> None:
        text = json.dumps({"type": "room", "room": self.state()}, separators=(",", ":"))
        for conn in self.conns:
            conn.send(text)

    def start(self) -> None:
        self.phase = "playing"
        self.round += 1
        self.seed = secrets.randbelow(2**31 - 1) + 1
        self.started_at = now_ms()
        self.deadline = self.started_at + (BRIEFING_SECONDS + self.planning_seconds) * 1000
        for p in self.players.values():
            p.status, p.spent, p.placed, p.result = "planning", 0, 0, None

    def reset(self) -> None:
        self.phase = "lobby"
        self.seed = self.started_at = self.deadline = None
        for p in self.players.values():
            p.status = "lobby"  # results stay visible until the next start

    def kick(self, pid: str) -> bool:
        if pid == self.host_id or self.players.pop(pid, None) is None:
            return False
        self.kicked.add(pid)
        for conn in [c for c in self.conns if c.pid == pid]:
            self.conns.discard(conn)
            conn.close(CLOSE_KICKED, "You were removed from the room")
        return True


ROOMS: dict[str, Room] = {}


def handle(room: Room, conn: Conn, msg: dict[str, Any]) -> None:
    player = room.players.get(conn.pid)
    if player is None:
        return
    kind = msg.get("type")
    is_host = conn.pid == room.host_id
    if kind == "ping":
        conn.send(json.dumps({"type": "pong", "serverTime": now_ms()}))
        return
    if kind == "configure" and is_host and room.phase == "lobby":
        city = msg.get("cityId")
        if isinstance(city, str) and CITY_ID_RE.fullmatch(city):
            room.city_id = city
        room.planning_seconds = as_int(msg.get("planningSeconds"), room.planning_seconds, 10, 3600)
    elif kind == "start" and is_host and room.city_id:
        room.start()
    elif kind == "status" and room.phase == "playing" and player.status != "done":
        status = msg.get("status", player.status)
        if status not in ("planning", "locked"):
            return
        player.status = status
        player.spent = as_int(msg.get("spent"), player.spent, 0, 10**15)
        player.placed = as_int(msg.get("placed"), player.placed, 0, 10**6)
    elif kind == "result" and room.round and msg.get("round") == room.round:
        result = msg.get("result")
        if not isinstance(result, dict) or len(json.dumps(result)) > MAX_MESSAGE_BYTES:
            return
        player.result = result
        if room.phase == "playing":
            player.status = "done"
    elif kind == "reset" and is_host:
        room.reset()
    elif kind == "kick" and is_host:
        if not room.kick(clean_id(msg.get("pid"))):
            return
    else:
        return
    room.broadcast()


class CreateRoom(BaseModel):
    hostId: str = Field(min_length=1, max_length=64)
    hostName: str = Field(default="", max_length=200)


@router.post("/api/rooms", response_model=None)
async def create_room(body: CreateRoom) -> dict[str, str] | JSONResponse:
    host_id = clean_id(body.hostId)
    if not host_id:
        return error_response("hostId is required", 422)
    if len(ROOMS) >= MAX_ROOMS:
        return error_response("Too many active rooms")
    while (code := "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))) in ROOMS:
        pass
    room = ROOMS[code] = Room(code, host_id)
    room.players[host_id] = Player(host_id, clean_name(body.hostName))
    return {"code": code}


@router.get("/api/rooms/{code}")
async def get_room(code: str) -> dict[str, Any]:
    room = ROOMS.get(code.upper())
    if room is None:
        raise HTTPException(404, "Room not found")
    return room.state()


async def _refuse(ws: WebSocket, message: str, code: int) -> None:
    with suppress(Exception):
        await ws.send_text(json.dumps({"type": "error", "message": message}))
        await ws.close(code)


@router.websocket("/ws/rooms/{code}")
async def room_socket(ws: WebSocket, code: str, pid: str = "", name: str = "") -> None:
    await ws.accept()
    room = ROOMS.get(code.upper())
    pid = clean_id(pid)
    if room is None:
        return await _refuse(ws, "Room not found", CLOSE_NOT_FOUND)
    if not pid:
        return await _refuse(ws, "Missing player id", CLOSE_BAD_REQUEST)
    if pid in room.kicked:
        return await _refuse(ws, "You were removed from the room", CLOSE_KICKED)
    player = room.players.get(pid)
    if player is None:
        if len(room.players) >= MAX_PLAYERS:
            return await _refuse(ws, "Room is full", CLOSE_FULL)
        status = "planning" if room.phase == "playing" else "lobby"
        player = room.players[pid] = Player(pid, clean_name(name), status=status)
    elif name.strip():
        player.name = clean_name(name)

    conn = Conn(ws, pid)
    room.conns.add(conn)
    player.connected = True
    room.broadcast()
    sender = asyncio.create_task(conn.pump())
    try:
        while (message := await ws.receive())["type"] != "websocket.disconnect":
            if (msg := parse_message(message.get("text"))) is not None:
                try:
                    handle(room, conn, msg)
                except Exception:
                    log.exception("room %s: failed to handle %r", room.code, msg.get("type"))
    finally:
        sender.cancel()
        room.conns.discard(conn)
        if not room.conns:
            room.idle_since = time.monotonic()
        if (p := room.players.get(pid)) is not None:
            p.connected = any(c.pid == pid for c in room.conns)
            room.broadcast()


async def cleanup_forever() -> None:
    while True:
        await asyncio.sleep(300)
        cutoff = time.monotonic() - IDLE_ROOM_SECONDS
        for code in [c for c, r in ROOMS.items() if not r.conns and r.idle_since < cutoff]:
            del ROOMS[code]
            log.info("room %s expired", code)
