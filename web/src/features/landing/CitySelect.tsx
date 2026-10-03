"use client";

import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import { CITY_ORDER, CITY_PACKS } from "@/cities";
import { Skyline } from "@/components/brand/Skyline";
import { Button } from "@/components/ui/button";
import { sfx } from "@/lib/audio/sfx";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import type { CityId } from "@/types";

export function CitySelect() {
  const hoverCity = useGame((s) => s.hoverCity);
  const mode = useGame((s) => s.mode);
  const setHoverCity = useGame((s) => s.setHoverCity);
  const chooseCity = useGame((s) => s.chooseCity);
  const setPhase = useGame((s) => s.setPhase);
  const hosting = mode === "multiplayer";

  const pick = (id: CityId) => {
    sfx.click();
    chooseCity(id);
    setPhase(hosting ? "mode" : "loading");
  };

  return (
    <motion.div className="pointer-events-none absolute inset-0 z-10 flex flex-col overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-[#050810] via-[#050810]/85 to-transparent" />
      <div className="pointer-events-auto relative flex items-center justify-between px-4 pt-4 sm:px-10 sm:pt-5">
        <Button variant="ghost" size="sm" onClick={() => setPhase("landing")} className="text-dim hover:text-white">
          <ArrowLeft /> Back
        </Button>
        <span className="font-mono text-[10px] tracking-[0.3em] text-dim">{hosting ? "HOSTING A ROOM" : "ONE ENGINE · FOUR REAL CITIES"}</span>
      </div>
      <div className="relative mt-auto px-4 pb-5 sm:px-10 sm:pb-8">
        <motion.h2 className="font-display text-3xl font-black uppercase tracking-[0.1em] text-white sm:text-6xl" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.6 }}>
          Choose your city
        </motion.h2>
        <p className="mt-1 text-sm text-dim">{hosting ? "Everyone in the room plays this city." : "Each disaster needs a different strategy."}</p>
        <div className="pointer-events-auto mt-4 grid grid-cols-2 gap-2.5 sm:mt-6 sm:gap-4 xl:grid-cols-4">
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
                whileTap={{ scale: 0.97 }}
                onMouseEnter={() => setHoverCity(id)}
                onFocus={() => setHoverCity(id)}
                onClick={() => pick(id)}
                className={cn(
                  "hud-panel group relative flex flex-col overflow-hidden rounded-2xl p-3 text-left transition-all duration-300 sm:p-5",
                  active ? "-translate-y-1.5 border-white/30" : "hover:border-white/25",
                )}
                style={active ? { boxShadow: `0 0 0 1px ${c.accent}55, 0 24px 60px -20px ${c.accent}66` } : undefined}
              >
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] sm:text-[10px]" style={{ color: c.accent }}>
                  {c.hazard}
                </div>
                <div className="mt-0.5 font-display text-xl font-extrabold uppercase leading-tight tracking-wider text-white sm:text-3xl">{c.name}</div>
                <Skyline shapes={c.skyline} color={c.accent} className="mt-1.5 h-7 w-full sm:mt-3 sm:h-16" />
                <div className="mt-2 font-display text-base font-bold uppercase tracking-[0.12em] sm:text-xl" style={{ color: c.accent }}>
                  {c.scenarioTitle}
                </div>
                <div className="mt-1 hidden font-mono text-xs tracking-[0.2em] sm:block" aria-label={`Difficulty ${c.difficulty} of 5`} style={{ color: c.accent }}>
                  {"●".repeat(c.difficulty)}
                  <span className="text-white/20">{"●".repeat(5 - c.difficulty)}</span>
                  <span className="ml-2 font-sans text-[11px] tracking-normal text-white/70">{c.specialMechanic}</span>
                </div>
                <div className="mt-3 hidden border-t border-white/8 pt-3 text-sm italic text-white/80 sm:block">“{c.question}”</div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
