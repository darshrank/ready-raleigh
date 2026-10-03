"use client";

import { useEffect } from "react";
import type { ScenarioParams } from "@/config/game";
import { cfgOf, useGame } from "@/stores/game";

/** Wall-clock seconds per simulated hour at a given hour (before the speed multiplier). */
export function secondsPerHour(cfg: ScenarioParams, hour: number) {
  for (const seg of cfg.playback) if (hour < seg.untilHour) return seg.secondsPerHour;
  return cfg.playback[cfg.playback.length - 1].secondsPerHour;
}

/** Drives the planning timer and simulation playback from one animation frame loop. */
export function GameLoop() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useGame.getState();
      if (s.phase === "planning") {
        s.tick(dt);
        if (s.timerRunning && useGame.getState().timeLeft <= 0) {
          useGame.setState({ timerRunning: false, activeTool: null, hover: null });
          s.setPhase("locking");
        }
      } else if (s.phase === "simulating" && s.playing && s.sim) {
        const cfg = cfgOf(s);
        const next = s.simHour + (dt * s.speed) / secondsPerHour(cfg, s.simHour);
        if (next >= cfg.durationHours) {
          s.setSimHour(cfg.durationHours);
          s.setPlaying(false);
        } else {
          s.setSimHour(next);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return null;
}
