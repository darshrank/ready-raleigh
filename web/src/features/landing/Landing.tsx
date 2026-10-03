"use client";

import { ArrowRight, BookOpen, Play, Radar } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { CITY_ORDER, CITY_PACKS } from "@/cities";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BRAND } from "@/config/game";
import { useGame } from "@/stores/game";
import { SettingsMenu } from "./SettingsMenu";

export function Landing() {
  const setPhase = useGame((s) => s.setPhase);
  const chooseCity = useGame((s) => s.chooseCity);
  const setMode = useGame((s) => s.setMode);

  const runDemo = () => {
    setMode("solo");
    chooseCity("raleigh");
    useGame.getState().setDemo(true);
    setPhase("loading");
  };

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(5,8,16,0.92)_0%,rgba(5,8,16,0.55)_45%,transparent_75%)]" />
      <header className="pointer-events-auto relative flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] tracking-[0.3em] text-dim">GEOSPATIAL RESILIENCE GAME</span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="text-dim hover:text-white">
            <Link href="/methodology">
              <BookOpen /> Methodology
            </Link>
          </Button>
          <SettingsMenu />
        </div>
      </header>

      <main className="relative flex flex-1 items-center px-6 sm:px-10">
        <div className="pointer-events-auto max-w-xl">
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.8 }}>
            <Logo size="xl" />
            <div className="mt-4 font-display text-xl font-semibold uppercase tracking-[0.5em] text-[var(--city)]">
              {BRAND.subtitle}
            </div>
          </motion.div>
          <motion.h1
            className="mt-10 text-3xl font-semibold leading-tight text-white sm:text-4xl"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.7 }}
          >
            {BRAND.hero}
          </motion.h1>
          <motion.p
            className="mt-4 max-w-md text-base leading-relaxed text-dim"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.7 }}
          >
            {BRAND.heroSupport}
          </motion.p>
          <motion.div
            className="mt-9 flex flex-wrap items-center gap-3"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.7 }}
          >
            <Button
              size="lg"
              onClick={() => setPhase("select")}
              className="h-12 rounded-lg bg-[var(--city)] px-6 font-display text-lg font-bold uppercase tracking-[0.2em] text-[#03140d] hover:bg-[var(--city)] hover:brightness-110"
            >
              Play now <ArrowRight className="size-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={runDemo}
              className="h-12 rounded-lg border-white/15 bg-white/5 px-5 font-display text-base font-semibold uppercase tracking-[0.18em]"
            >
              <Play className="size-4" /> Run judge demo
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="lg" variant="ghost" disabled className="h-12 px-4 font-display text-base uppercase tracking-[0.18em] text-dim">
                    <Radar className="size-4" /> Planner mode
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Aggregates every play into a planner map. Arrives with the backend pass.</TooltipContent>
            </Tooltip>
          </motion.div>
        </div>
      </main>

      <footer className="pointer-events-auto relative flex flex-col gap-3 px-6 pb-6 sm:flex-row sm:items-end sm:justify-between sm:px-10">
        <div className="flex flex-wrap gap-2">
          {CITY_ORDER.map((id) => {
            const c = CITY_PACKS[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setPhase("select");
                  useGame.getState().setHoverCity(id);
                }}
                className="hud-panel flex items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:border-white/30"
              >
                <span className="size-2 rounded-full" style={{ background: c.accent, boxShadow: `0 0 10px ${c.accent}` }} />
                <span className="text-xs font-semibold text-white">{c.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-dim">{c.scenarioTitle}</span>
              </button>
            );
          })}
        </div>
        <div className="max-w-sm text-right font-mono text-[10px] leading-relaxed tracking-wide text-dim">
          Real geography: OpenStreetMap road networks, FEMA flood zones, USGS liquefaction, NYC heat vulnerability, U.S. Census ACS.
          <br />
          {BRAND.disclaimer}
        </div>
      </footer>
    </motion.div>
  );
}
