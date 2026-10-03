"use client";

import { useEffect, useRef } from "react";
import { CITY_PACKS } from "@/cities";
import { engine } from "@/lib/engine/client";
import { toEnginePlan, type EnginePlan } from "@/lib/engine/plan";
import type { BotResult } from "@/lib/engine/worker-types";
import { useRoom } from "@/lib/room/store";
import { useGame } from "@/stores/game";
import type { CityId } from "@/types";

/**
 * Connects the game to a live multiplayer room:
 *  - ?room=CODE in the URL joins that room;
 *  - picking "Multiplayer room" opens the room under the generated code;
 *  - when the host starts, every player loads the same city, seed and timer;
 *  - locking a plan submits it; at the reveal the other players' plans are
 *    simulated here with the same engine and replace the simulated players.
 */
export function RoomBridge() {
  const mode = useGame((s) => s.mode);
  const roomCode = useGame((s) => s.roomCode);
  const phase = useGame((s) => s.phase);
  const room = useRoom((s) => s.state);
  const status = useRoom((s) => s.status);
  const startedRound = useRef(0);
  const submittedRound = useRef(0);
  const crowdRound = useRef(0);

  // join from a shared link
  useEffect(() => {
    const code = new URLSearchParams(location.search).get("room");
    if (!code) return;
    useGame.setState({ mode: "multiplayer", roomCode: code.toUpperCase() });
    useGame.getState().chooseCity("raleigh");
    useGame.getState().setPhase("mode");
  }, []);

  // open / close the socket with the multiplayer mode
  useEffect(() => {
    if (mode === "multiplayer" && roomCode) useRoom.getState().connect(roomCode);
    else if (mode !== "multiplayer") useRoom.getState().leave();
  }, [mode, roomCode]);

  // the host started a round: everyone loads the same scenario
  useEffect(() => {
    if (!room || room.phase !== "playing" || room.round === startedRound.current) return;
    startedRound.current = room.round;
    const g = useGame.getState();
    const cityId = (room.cityId in CITY_PACKS ? room.cityId : "raleigh") as CityId;
    if (g.cityId !== cityId) g.chooseCity(cityId);
    g.newRound();
    useGame.setState({ seed: room.seed, mode: "multiplayer" });
    g.setPlanningSeconds(room.planningSeconds);
    // events depend on the seed; re-resolve them if this city's data is already loaded
    const data = useGame.getState().data;
    if (data) useGame.getState().setData(data);
    useGame.getState().setPhase("loading");
  }, [room]);

  // lock = submit this player's plan once per round
  useEffect(() => {
    if (phase !== "locking" || !room || room.phase !== "playing" || submittedRound.current === room.round) return;
    const g = useGame.getState();
    if (!g.data) return;
    submittedRound.current = room.round;
    const plan = toEnginePlan(g.placements, g.data.cfg);
    const est = g.estimate;
    const protectedPct = est && "protected" in est && "atRisk" in est ? Math.round((100 * (est as { protected: number }).protected) / Math.max(1, (est as { atRisk: number }).atRisk)) : undefined;
    useRoom.getState().send({ t: "submit", plan, protectedPct });
  }, [phase, room]);

  // reveal: simulate everyone else's plan and use them as the crowd
  useEffect(() => {
    if (!room || room.phase !== "reveal" || crowdRound.current === room.round) return;
    const g = useGame.getState();
    if (!g.data || !g.events || !g.cityId) return;
    const me = useRoom.getState().me;
    const others = room.submissions.filter((s) => s.playerId !== me);
    if (!others.length) return;
    crowdRound.current = room.round;
    const city = g.cityId;
    const events = g.events;
    Promise.all(
      others.map(async (s) => ({
        id: s.playerId,
        name: s.name,
        style: "Player",
        real: true,
        plan: s.plan as EnginePlan,
        sim: await engine.simulate(city, s.plan as EnginePlan, events, false),
      })),
    )
      .then((players) => useGame.getState().setBots(players as BotResult[]))
      .catch(() => {});
  }, [room, phase]);

  // the host opened the next round: everyone returns to the room lobby
  const lastRoomPhase = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastRoomPhase.current;
    lastRoomPhase.current = room?.phase ?? null;
    if (room?.phase === "lobby" && prev && prev !== "lobby") {
      useGame.getState().newRound();
      useGame.setState({ bots: null });
      useGame.getState().setPhase("mode");
    }
  }, [room]);

  // keep a live room open while the tab lives
  useEffect(() => () => void (status === "idle" || useRoom.getState().leave()), []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
