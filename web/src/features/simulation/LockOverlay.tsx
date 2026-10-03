"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ROUND } from "@/config/game";
import { sfx } from "@/lib/audio/sfx";
import { useGame } from "@/stores/game";

/** 3-2-1, PLAN LOCKED. Display only: the SimulationController runs the engine. */
export function LockOverlay() {
  const [count, setCount] = useState(ROUND.lockCountdown);
  const simReady = useGame((s) => !!s.sim);
  const simError = useGame((s) => s.simError);
  const reducedMotion = useGame((s) => s.reducedMotion);

  useEffect(() => {
    if (count <= 0) {
      sfx.lock();
      sfx.buzz([30, 40, 120]);
      return;
    }
    sfx.tick();
    const t = setTimeout(() => setCount((c) => c - 1), reducedMotion ? 250 : 850);
    return () => clearTimeout(t);
  }, [count, reducedMotion]);

  return (
    <motion.div className="absolute inset-0 z-30 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-[#050810]/55" />
      <div className="relative text-center">
        <AnimatePresence mode="popLayout">
          {count > 0 ? (
            <motion.div
              key={count}
              initial={{ scale: 1.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              className="font-display text-[160px] font-black leading-none text-white text-glow"
            >
              {count}
            </motion.div>
          ) : (
            <motion.div key="locked" initial={{ scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center">
              <div className="font-display text-7xl font-black uppercase tracking-[0.18em] text-[var(--city)] text-glow">Plan locked</div>
              <div className="mt-3 font-mono text-xs tracking-[0.3em] text-dim">
                {simReady ? "SIMULATION STARTING" : "ROUTING EVERY EVACUATION ON THE REAL ROAD NETWORK…"}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {simError && (
          <div className="mt-6 rounded-lg border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            Simulation failed: {simError}
            <Button size="sm" variant="outline" className="ml-3" onClick={() => useGame.getState().setPhase("planning")}>
              Back to planning
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
