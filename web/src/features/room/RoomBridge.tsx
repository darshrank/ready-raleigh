"use client";

import { useEffect, useRef } from "react";
import { cfgOf, spent, useGame } from "@/stores/game";
import type { CityId, Phase } from "@/types";
import { isRoomHost, useRoom } from "./room-store";

const IN_ROUND: Phase[] = ["briefing", "planning", "locking", "simulating", "results"];

/** Keeps the local game in step with the room: shared city, seed and clock, and live status. */
export function RoomBridge() {
  const room = useRoom((s) => s.room);
  const placements = useGame((s) => s.placements);
  const phase = useGame((s) => s.phase);
  const started = useRef(0);

  useEffect(() => {
    if (!room || room.phase !== "playing" || !room.cityId || room.seed === null || room.round <= started.current) return;
    started.current = room.round;
    const g = useGame.getState();
    const cityId = room.cityId as CityId;
    const sameCity = g.cityId === cityId && !!g.data;
    useGame.setState({ mode: "multiplayer", roomCode: room.code, demo: false });
    g.setPlanningSeconds(room.planningSeconds);
    if (!sameCity) g.chooseCity(cityId);
    useGame.getState().setSeed(room.seed);
    useGame.getState().newRound();
    useGame.getState().setPhase(sameCity ? "briefing" : "loading");
  }, [room]);

  const roomPhase = room?.phase;
  useEffect(() => {
    const r = useRoom.getState().room;
    if (roomPhase !== "lobby" || !r || started.current === 0) return;
    const g = useGame.getState();
    if (g.mode !== "multiplayer" || !IN_ROUND.includes(g.phase)) return;
    g.newRound();
    g.setPhase(isRoomHost(r) ? "mode" : "join");
  }, [roomPhase]);

  useEffect(() => {
    const r = useRoom.getState();
    const g = useGame.getState();
    if (!r.room || r.room.phase !== "playing" || g.mode !== "multiplayer") return;
    const cost = spent(placements, cfgOf(g));
    if (phase === "planning") r.send({ type: "status", status: "planning", spent: cost, placed: placements.length });
    else if (phase === "locking") r.send({ type: "status", status: "locked", spent: cost, placed: placements.length });
  }, [placements, phase]);

  return null;
}
