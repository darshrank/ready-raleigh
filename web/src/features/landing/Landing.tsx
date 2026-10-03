"use client";

import { ArrowRight, BookOpen, Play, QrCode, Users } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { CITY_ORDER, CITY_PACKS } from "@/cities";
import { BackendStatus } from "@/components/hud/BackendStatus";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/config/game";
import { sfx } from "@/lib/audio/sfx";
import { useBackend } from "@/lib/api";
import { useGame } from "@/stores/game";
import { SettingsMenu } from "./SettingsMenu";

export function Landing() {
  const setPhase = useGame((s) => s.setPhase);
  const chooseCity = useGame((s) => s.chooseCity);
  const setMode = useGame((s) => s.setMode);
  const online = useBackend((s) => s.status === "online");

  const go = (mode: "solo" | "multiplayer") => {
    sfx.unlock();
    sfx.whoosh();
    setMode(mode);
    setPhase("select");
  };
  const runDemo = () => {
    sfx.unlock();
    setMode("solo");
    chooseCity("raleigh");
    useGame.getState().setDemo(true);
    setPhase("loading");
  };

  return (
    <motion.div className="pointer-events-none absolute inset-0 z-10 flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(5,8,16,0.94)_0%,rgba(5,8,16,0.6)_50%,transparent_80%)]" />
      <header className="pointer-events-auto relative flex items-center justify-between gap-2 px-4 py-4 sm:px-10 sm:py-5">
        <BackendStatus />
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="text-dim hover:text-white">
            <Link href="/methodology">
              <BookOpen /> <span className="hidden sm:inline">Methodology</span>
            </Link>
          </Button>
          <SettingsMenu />
        </div>
      </header>

      <main className="relative flex flex-1 items-center px-5 sm:px-10">
        <div className="pointer-events-auto w-full max-w-xl">
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.8 }}>
            <Logo size="xl" />
            <div className="mt-3 font-display text-base font-semibold uppercase tracking-[0.45em] text-[var(--city)] sm:text-xl">{BRAND.subtitle}</div>
          </motion.div>
          <motion.h1 className="mt-6 text-2xl font-semibold leading-tight text-white sm:mt-9 sm:text-4xl" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35, duration: 0.7 }}>
            {BRAND.hero}
          </motion.h1>
          <motion.p className="mt-3 max-w-md text-sm leading-relaxed text-dim sm:text-base" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.45, duration: 0.7 }}>
            {BRAND.heroSupport}
          </motion.p>
          <motion.div className="mt-7 grid gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6, duration: 0.7 }}>
            <Button
              size="lg"
              onClick={() => go("solo")}
              className="h-13 rounded-xl bg-[var(--city)] px-7 font-display text-lg font-bold uppercase tracking-[0.2em] text-[#03140d] shadow-[0_0_30px_-6px_var(--city)] hover:bg-[var(--city)] hover:brightness-110"
            >
              Play <ArrowRight className="size-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => go("multiplayer")}
              disabled={!online}
              title={online ? undefined : "Rooms need the game server"}
              className="h-13 rounded-xl border-white/15 bg-white/5 px-5 font-display text-base font-semibold uppercase tracking-[0.16em]"
            >
              <Users className="size-4" /> Host a room
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                sfx.unlock();
                sfx.whoosh();
                setPhase("join");
              }}
              className="h-13 rounded-xl border-white/15 bg-white/5 px-5 font-display text-base font-semibold uppercase tracking-[0.16em]"
            >
              <QrCode className="size-4" /> Join
            </Button>
          </motion.div>
          <button type="button" onClick={runDemo} className="mt-4 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-dim transition hover:text-white">
            <Play className="size-3" /> Judge demo · plays itself in 90 s
          </button>
        </div>
      </main>

      <footer className="pointer-events-auto relative flex flex-col gap-2 px-4 pb-5 sm:flex-row sm:items-end sm:justify-between sm:px-10 sm:pb-6">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CITY_ORDER.map((id) => {
            const c = CITY_PACKS[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  go("solo");
                  useGame.getState().setHoverCity(id);
                }}
                className="hud-panel flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:border-white/30"
              >
                <span className="size-2 rounded-full" style={{ background: c.accent, boxShadow: `0 0 10px ${c.accent}` }} />
                <span className="text-xs font-semibold text-white">{c.name}</span>
                <span className="hidden font-mono text-[10px] uppercase tracking-wider text-dim sm:inline">{c.scenarioTitle}</span>
              </button>
            );
          })}
        </div>
        <div className="font-mono text-[10px] tracking-wide text-dim sm:text-right">{BRAND.disclaimer}</div>
      </footer>
    </motion.div>
  );
}
