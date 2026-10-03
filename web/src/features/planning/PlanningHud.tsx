"use client";

import { motion } from "motion/react";
import { useEffect } from "react";
import { movingFlag, placeOrMove } from "@/features/map/layers";
import { candidateSets } from "@/lib/engine/optimize";
import { useGame } from "@/stores/game";
import { AchillesScan, runAchillesScan } from "./AchillesScan";
import { AiCommander } from "./AiCommander";
import { BottomDock } from "./BottomDock";
import { Inspector } from "./Inspector";
import { Toolbar } from "./Toolbar";
import { lockPlan, TopBar } from "./TopBar";

export function PlanningHud() {
  const demo = useGame((s) => s.demo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      const s = useGame.getState();
      if (e.key === "Escape") {
        movingFlag.id = null;
        s.setTool(null);
        s.select(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && s.data) {
        const k = s.data.cfg.interventions[Number(e.key) - 1]?.id;
        if (k) s.setTool(s.activeTool === k ? null : k);
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selected?.type === "intervention") {
        s.remove(s.selected.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // judge demo: a seeded plan placed step by step, then locked
  useEffect(() => {
    if (!demo) return;
    const s = useGame.getState();
    const data = s.data!;
    const sets = candidateSets(s.coverage!, null);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const spec = (effect: string) => data.cfg.interventions.find((i) => i.effect === effect);
    const sh = data.shelters[sets.shelters[0]];
    const bus = sets.busStops.length ? data.busStops[sets.busStops[0]] : null;
    const shelterSpec = spec("shelter");
    const pickupSpec = spec("pickup");
    if (shelterSpec && sh) at(1200, () => placeOrMove(shelterSpec.id, sh.id, sh.lon, sh.lat, sh.name));
    if (pickupSpec && bus) at(2600, () => placeOrMove(pickupSpec.id, bus.id, bus.lon, bus.lat, bus.name || "Bus stop"));
    at(4000, () => runAchillesScan());
    at(9800, () => {
      const a = useGame.getState().achilles;
      const f = a?.findings[0];
      const protect = spec("protectRoad");
      if (f && protect) {
        const c = data.crossings[f.crossing];
        placeOrMove(protect.id, c.id, c.lon, c.lat, c.label);
      }
    });
    at(11800, lockPlan);
    return () => timers.forEach(clearTimeout);
  }, [demo]);

  return (
    <motion.div className="pointer-events-none absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <TopBar />
      <Toolbar onAchilles={runAchillesScan} />
      <Inspector />
      <AchillesScan />
      <BottomDock />
      <AiCommander />
    </motion.div>
  );
}
