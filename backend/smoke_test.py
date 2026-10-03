"""End-to-end smoke test against a running backend: .venv/bin/python smoke_test.py [base_url]

Calls the real external services (Gemini, ElevenLabs, Tiger Data, Solana devnet) when /api/health reports them up.
Database rows are written under cityId "smoke-test" so real leaderboards stay clean. Prints results, never secrets.
"""

import asyncio
import hashlib
import json
import sys
import time
from typing import Any

import httpx
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
WS_BASE = "ws" + BASE.removeprefix("http")
CITY = "smoke-test"
failures: list[str] = []


def check(label: str, ok: bool, detail: object = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f"  [{detail}]" if detail != "" else ""))
    if not ok:
        failures.append(label)


async def send(ws: ClientConnection, **msg: Any) -> None:
    await ws.send(json.dumps(msg))


async def next_msg(ws: ClientConnection, kind: str | None = None) -> dict[str, Any]:
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), 5))
        if kind is None or msg.get("type") == kind:
            return msg


async def states(*sockets: ClientConnection) -> list[dict[str, Any]]:
    """The next room broadcast seen by each socket."""
    return [(await next_msg(ws, "room"))["room"] for ws in sockets]


async def test_rooms(http: httpx.AsyncClient) -> None:
    r = await http.post("/api/rooms", json={"hostId": "smoke-host", "hostName": "  Host\tPerson\n"})
    code = r.json().get("code", "")
    check("create room", r.status_code == 200 and len(code) == 5, code)
    async with connect(f"{WS_BASE}/ws/rooms/{code.lower()}?pid=smoke-host&name=Host") as host:
        (s,) = await states(host)
        check("host connects with lowercase code", s["players"][0]["host"] and s["players"][0]["connected"], s["players"][0])
        async with connect(f"{WS_BASE}/ws/rooms/{code}?pid=smoke-p1&name=%20%20Alice%0A%07") as alice:
            s, _ = await states(alice, host)
            check("player joins, name sanitized", [p["name"] for p in s["players"]] == ["Host", "Alice"], [p["name"] for p in s["players"]])
            await send(alice, type="configure", cityId="miami", planningSeconds=60)
            await send(alice, type="start")
            await send(alice, type="bogus")
            await send(alice, type="ping")
            pong = await next_msg(alice)
            check("non-host configure/start and unknown types ignored; ping -> pong", pong.get("type") == "pong", pong)
            await send(host, type="start")  # no city yet: ignored
            await send(host, type="configure", cityId="raleigh", planningSeconds=90)
            s, _ = await states(alice, host)
            check("configure", (s["phase"], s["cityId"], s["planningSeconds"]) == ("lobby", "raleigh", 90))
            await send(host, type="start")
            s, _ = await states(alice, host)
            check(
                "start",
                s["phase"] == "playing"
                and s["round"] == 1
                and isinstance(s["seed"], int)
                and 0 < s["seed"] < 2**31
                and s["deadline"] - s["startedAt"] == (15 + 90) * 1000
                and {p["status"] for p in s["players"]} == {"planning"},
                {k: s[k] for k in ("round", "seed", "startedAt", "deadline")},
            )
            await send(alice, type="status", status="locked", spent=4200, placed=3)
            s, _ = await states(host, alice)
            a = s["players"][1]
            check("status", (a["status"], a["spent"], a["placed"]) == ("locked", 4200, 3), a)
            await send(alice, type="result", round=99, result={"score": 1})
            await send(alice, type="result", round=1, result={"score": 87, "protected": 12000})
            s, _ = await states(host, alice)
            a = s["players"][1]
            check("result stored, wrong round ignored", a["status"] == "done" and a["result"] == {"score": 87, "protected": 12000}, a)
        (s,) = await states(host)
        check("disconnect marks connected=false", s["players"][1]["connected"] is False)
        async with connect(f"{WS_BASE}/ws/rooms/{code}?pid=smoke-p1&name=Alice2") as alice:
            s, _ = await states(alice, host)
            a = s["players"][1]
            check("reconnect keeps identity and result", a["connected"] and a["name"] == "Alice2" and a["result"]["score"] == 87, a)
            await send(host, type="reset")
            s, _ = await states(alice, host)
            check(
                "reset keeps results",
                (s["phase"], s["seed"], s["startedAt"], s["deadline"]) == ("lobby", None, None, None)
                and {p["status"] for p in s["players"]} == {"lobby"}
                and s["players"][1]["result"] is not None,
            )
            await send(host, type="kick", pid="smoke-p1")
            err = await next_msg(alice)
            try:
                await asyncio.wait_for(alice.recv(), 5)
            except ConnectionClosed:
                pass
            check("kicked player gets error and close 4403", err.get("type") == "error" and alice.close_code == 4403, (err, alice.close_code))
            (s,) = await states(host)
            check("kick removes player", [p["id"] for p in s["players"]] == ["smoke-host"])
        async with connect(f"{WS_BASE}/ws/rooms/{code}?pid=smoke-p1&name=Alice") as again:
            msg = await next_msg(again)
            check("kicked player cannot rejoin", msg.get("type") == "error", msg)
    async with connect(f"{WS_BASE}/ws/rooms/00000?pid=x&name=y") as ws:
        msg = await next_msg(ws)
        try:
            await asyncio.wait_for(ws.recv(), 5)
        except ConnectionClosed:
            pass
        check("unknown room -> error and close", msg == {"type": "error", "message": "Room not found"} and ws.close_code == 4404, msg)
    r = await http.get(f"/api/rooms/{code.lower()}")
    check("GET /api/rooms/{code}", r.status_code == 200 and r.json()["code"] == code)
    r = await http.get("/api/rooms/00000")
    check("GET unknown room -> 404", r.status_code == 404, r.json())


CONTEXT = {
    "budgetLeft": 1500,
    "estimate": {"score": 61, "protectedPeople": 42000, "peopleAtRisk": 9800},
    "candidates": [
        {"id": "pump-17", "kind": "pump", "label": "Pump station on Crabtree Creek at Wake Forest Rd", "cost": 900, "gain": 3100},
        {"id": "shelter-4", "kind": "shelter", "label": "Shelter at Broughton High School", "cost": 1200, "gain": 2400},
        {"id": "levee-2", "kind": "levee", "label": "Levee along Walnut Creek", "cost": 4000, "gain": 6000},
    ],
    "riskyZones": [{"name": "Crabtree Valley", "peopleAtRisk": 5200}],
    "bottlenecks": [{"road": "Glenwood Ave bridge over Crabtree Creek", "detourMinutes": 14}],
}

RESULT_CONTEXT = {
    "score": 74,
    "optimizerScore": 81,
    "roomAverageScore": 69,
    "protectedPeople": 45100,
    "peopleAtRisk": 6700,
    "spent": 9200,
    "budget": 10000,
    "placed": [{"kind": "pump", "label": "Pump station on Crabtree Creek at Wake Forest Rd", "gain": 3100}],
    "missed": [{"kind": "shelter", "label": "Shelter at Broughton High School", "gain": 2400}],
    "failures": [{"road": "Glenwood Ave bridge over Crabtree Creek", "closedAtMinute": 42}],
}


async def test_ai(http: httpx.AsyncClient) -> None:
    t = time.perf_counter()
    r = await http.post("/api/ai/commander", json={"cityId": "raleigh", "question": "What should I build next with my remaining budget?", "context": CONTEXT}, timeout=40)
    body = r.json()
    shape = (
        r.status_code == 200
        and set(body) == {"answer", "candidateId", "evidence", "tradeoff", "limitations"}
        and isinstance(body["answer"], str)
        and body["candidateId"] in (None, "pump-17", "shelter-4", "levee-2")
        and isinstance(body["evidence"], list)
    )
    check(f"Gemini commander ({time.perf_counter() - t:.1f} s)", shape, json.dumps(body, ensure_ascii=False))
    t = time.perf_counter()
    r = await http.post("/api/ai/debrief", json={"cityId": "raleigh", "context": RESULT_CONTEXT}, timeout=40)
    body = r.json()
    check(f"Gemini debrief ({time.perf_counter() - t:.1f} s)", r.status_code == 200 and isinstance(body.get("text"), str) and body["text"], body)
    r = await http.post("/api/ai/commander", json={"cityId": "raleigh"})
    check("commander validation error -> 422 with error", r.status_code == 422 and "error" in r.json(), r.json())


async def test_tts(http: httpx.AsyncClient) -> None:
    text = f"Faultline radio check at {time.strftime('%H:%M:%S')}. The Crabtree Valley evacuation route is open."
    timings, results = [], []
    for _ in range(2):
        t = time.perf_counter()
        r = await http.post("/api/voice/tts", json={"text": text, "voiceId": None}, timeout=40)
        timings.append(time.perf_counter() - t)
        results.append(r)
    first, second = results
    check(
        f"ElevenLabs TTS ({timings[0]:.1f} s)",
        first.status_code == 200 and first.headers.get("content-type") == "audio/mpeg" and len(first.content) > 5000,
        f"{first.status_code} {first.headers.get('content-type')} {len(first.content)} bytes cache={first.headers.get('x-tts-cache')}"
        + ("" if first.status_code == 200 else f" {first.text[:200]}"),
    )
    check(
        f"TTS second call served from cache ({timings[1] * 1000:.0f} ms)",
        second.headers.get("x-tts-cache") == "hit" and second.content == first.content,
    )


async def test_db(http: httpx.AsyncClient) -> None:
    plan = {"interventions": [{"kind": "pump", "lon": -78.64, "lat": 35.84}]}
    r = await http.post(
        "/api/rounds",
        json={"roomCode": None, "cityId": CITY, "seed": 12345, "playerName": "Smoke Tester", "score": 87, "protected": 45100, "atRisk": 6700, "spent": 9200, "plan": plan},
    )
    check("POST /api/rounds", r.json() == {"ok": True}, r.json())
    actions = [
        {"action": "place", "intervention": "pump", "lon": -78.64, "lat": 35.84, "cost": 900},
        {"action": "remove", "intervention": "pump", "lon": -78.64, "lat": 35.84, "cost": -900, "reason": "moved"},
    ]
    r = await http.post("/api/actions", json={"roomCode": "ABCDE", "playerId": "smoke-p1", "cityId": CITY, "actions": actions})
    check("POST /api/actions", r.json() == {"ok": True}, r.json())
    r = await http.get("/api/leaderboard", params={"cityId": CITY, "limit": 5})
    entries = r.json().get("entries", [])
    check("GET /api/leaderboard", r.status_code == 200 and any(e["playerName"] == "Smoke Tester" for e in entries), entries[:2])
    r = await http.get("/api/stats", params={"cityId": CITY})
    body = r.json()
    check("GET /api/stats", r.status_code == 200 and body.get("plays", 0) >= 1 and len(body.get("hourly", [])) >= 1, body)


async def test_proof(http: httpx.AsyncClient) -> None:
    plan = {"interventions": [{"kind": "pump", "id": "pump-17"}], "note": "smoke test"}
    canonical = json.dumps({"cityId": CITY, "score": 87, "plan": plan}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    t = time.perf_counter()
    r = await http.post("/api/proof", json={"cityId": CITY, "score": 87, "playerName": "Smoke Tester", "plan": plan}, timeout=60)
    body = r.json()
    check("proof hash is sha256 of canonical JSON", body.get("hash") == hashlib.sha256(canonical.encode()).hexdigest())
    check(f"Solana proof ({time.perf_counter() - t:.1f} s)", r.status_code == 200 and "signature" in body, body)


async def test_cors(http: httpx.AsyncClient) -> None:
    for origin, allowed in [
        ("http://localhost:3000", True),
        ("http://192.168.1.23:3000", True),
        ("http://10.0.0.5:3000", True),
        ("http://172.20.1.4:3000", True),
        ("http://172.32.1.4:3000", False),
        ("https://evil.example", False),
    ]:
        r = await http.options("/api/ai/commander", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
        got = r.headers.get("access-control-allow-origin") == origin
        check(f"CORS {origin} {'allowed' if allowed else 'blocked'}", got == allowed)


async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE, timeout=20) as http:
        services = (await http.get("/api/health")).json()["services"]
        print("health:", services)
        await test_cors(http)
        await test_rooms(http)
        for name, test in [("gemini", test_ai), ("elevenlabs", test_tts), ("database", test_db), ("solana", test_proof)]:
            if services[name]:
                await test(http)
            else:
                print(f"SKIP  {name} (health reports it down)")
        print("health after:", (await http.get("/api/health")).json()["services"])
    print(f"\n{len(failures)} failure(s)" + (f": {failures}" if failures else ""))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    asyncio.run(main())
