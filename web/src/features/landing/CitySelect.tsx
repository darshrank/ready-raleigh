"use client";

import { ArrowLeft, Lock } from "lucide-react";
import { motion } from "motion/react";
import { CITY_ORDER, CITY_PACKS } from "@/cities";
import { Skyline } from "@/components/brand/Skyline";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import type { CityId } from "@/types";

export function CitySelect() {
  const hoverCity = useGame((s) => s.hoverCity);
  const setHoverCity = useGame((s) => s.setHoverCity);
  const chooseCity = useGame((s) => s.chooseCity);
  const setPhase = useGame((s) => s.setPhase);

  const pick = (id: CityId) => {
    chooseCity(id);
    setPhase(CITY_PACKS[id].status === "playable" ? "mode" : "preview");
  };

  return (
    <motion.div className="pointer-events-none absolute inset-0 z-10 flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-[#050810] via-[#050810]/85 to-transparent" />
      <div className="pointer-events-auto relative flex items-center justify-between px-6 pt-5 sm:px-10">
        <Button variant="ghost" size="sm" onClick={() => setPhase("landing")} className="text-dim hover:text-white">
          <ArrowLeft /> Back
        </Button>
        <span className="font-mono text-[10px] tracking-[0.3em] text-dim">ONE ENGINE · FOUR REAL CITIES</span>
      </div>
      <div className="relative mt-auto px-6 pb-8 sm:px-10">
        <motion.h2
          className="font-display text-5xl font-black uppercase tracking-[0.12em] text-white sm:text-6xl"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          Choose your city
        </motion.h2>
        <p className="mt-2 max-w-xl text-sm text-dim">Each city forces a different strategy. Hover a card to fly there.</p>
        <div className="pointer-events-auto mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CITY_ORDER.map((id, i) => {
            const c = CITY_PACKS[id];
            const active = hoverCity === id;
            return (
              <motion.button
                key={id}
                type="button"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.5 }}
                onMouseEnter={() => setHoverCity(id)}
                onFocus={() => setHoverCity(id)}
                onClick={() => pick(id)}
                className={cn(
                  "hud-panel group relative flex flex-col overflow-hidden rounded-2xl p-5 text-left transition-all duration-300",
                  active ? "-translate-y-1.5 border-white/30" : "hover:border-white/25",
                )}
                style={active ? { boxShadow: `0 0 0 1px ${c.accent}55, 0 24px 60px -20px ${c.accent}66` } : undefined}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: c.accent }}>
                      {c.hazard}
                    </div>
                    <div className="mt-1 font-display text-3xl font-extrabold uppercase tracking-wider text-white">{c.name}</div>
                  </div>
                  {c.status === "playable" ? (
                    <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest text-emerald-300">
                      PLAYABLE
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest text-dim">
                      <Lock className="size-2.5" /> PREVIEW
                    </span>
                  )}
                </div>
                <Skyline shapes={c.skyline} color={c.accent} className="mt-3 h-16 w-full" />
                <div className="mt-3 font-display text-xl font-bold uppercase tracking-[0.14em]" style={{ color: c.accent }}>
                  {c.scenarioTitle}
                </div>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-dim">Difficulty</dt>
                  <dd className="font-mono tracking-[0.2em]" aria-label={`${c.difficulty} of 5`} style={{ color: c.accent }}>
                    {"●".repeat(c.difficulty)}
                    <span className="text-white/20">{"●".repeat(5 - c.difficulty)}</span>
                  </dd>
                  <dt className="text-dim">Mechanic</dt>
                  <dd className="text-white">{c.specialMechanic}</dd>
                  <dt className="text-dim">At risk</dt>
                  <dd className="text-white/85">{c.populationTheme}</dd>
                </dl>
                <div className="mt-4 border-t border-white/8 pt-3 text-sm italic text-white/80">“{c.question}”</div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
