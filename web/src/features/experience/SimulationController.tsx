"use client";

import { useEffect } from "react";
import { ROUND } from "@/config/game";
import { engine } from "@/lib/engine/client";
import { toEnginePlan } from "@/lib/engine/plan";
import { mapBus } from "@/lib/map-bus";
import { useRoom } from "@/lib/room/store";
import { useGame } from "@/stores/game";

const STEP_MS = 850;

/**
 * Runs the locked plan, the optimizer and the room in the engine worker, and
 * starts playback once the 3-2-1 countdown and the player's run are both done.
 */
export function SimulationController() {
  const phase = useGame((s) => s.phase);

  useEffect(() => {
    if (phase !== "locking") return;
    const s = useGame.getState();
    if (!s.data || !s.cityId) return;
    const city = s.cityId;
    const plan = toEnginePlan(s.placements, s.data.cfg);
    const events = s.events!;
    const countdownMs = (s.reducedMotion ? 250 : STEP_MS) * ROUND.lockCountdown + 900;
    const startedAt = performance.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const start = () => {
      if (cancelled) return;
      const g = useGame.getState();
      if (g.phase !== "locking") return;
      g.setPhase("simulating");
      if (g.demo) g.setSpeed(2);
      g.setPlaying(true);
    };

    engine
      .simulate(city, plan, events, true)
      .then((sim) => {
        if (cancelled) return;
        useGame.getState().setSim(sim);
        timer = setTimeout(start, Math.max(0, countdownMs - (performance.now() - startedAt)));
      })
      .catch((err: Error) => !cancelled && useGame.getState().setSim(null, err.message));
    engine
      .reference(city, events, plan.crossings)
      .then((r) => !cancelled && useGame.getState().setReference(r))
      .catch(() => {});
    // In a live room with other players, RoomBridge fills the crowd with their real plans at the reveal.
    const room = useRoom.getState();
    const livePlayers = room.status === "open" && (room.state?.players.filter((p) => p.connected).length ?? 0) > 1;
    if (!livePlayers)
      engine
        .bots(city, events)
        .then((b) => !cancelled && useGame.getState().setBots(b))
        .catch(() => {});

    const m = mapBus.get();
    if (m) m.easeTo({ zoom: Math.min(m.getZoom(), 12.4) - 0.5, pitch: 52, duration: s.reducedMotion ? 0 : 2500 });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase]);

  return null;
}
