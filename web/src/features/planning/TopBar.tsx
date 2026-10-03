"use client";

import { Lock } from "lucide-react";
import { useEffect, useRef } from "react";
import { Logo } from "@/components/brand/Logo";
import { AnimatedNumber, DataBadge, Meter, money, Panel, pct } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { ROUND } from "@/config/game";
import { CITY_PACKS } from "@/cities";
import { sfx } from "@/lib/audio/sfx";
import { cn } from "@/lib/utils";
import { cfgOf, spent, useGame } from "@/stores/game";

export function lockPlan() {
  useGame.setState({ timerRunning: false, activeTool: null, hover: null });
  useGame.getState().setPhase("locking");
}

export function TopBar() {
  const placements = useGame((s) => s.placements);
  const cfg = useGame((s) => cfgOf(s));
  const cityId = useGame((s) => s.cityId ?? "raleigh");
  const timeLeft = useGame((s) => s.timeLeft);
  const timerRunning = useGame((s) => s.timerRunning);
  const planningSeconds = useGame((s) => s.planningSeconds);
  const estimate = useGame((s) => s.estimate);
  const used = spent(placements, cfg);
  const remaining = ROUND.budget - used;
  const untimed = planningSeconds === 0 || !timerRunning;
  const mm = Math.floor(timeLeft / 60);
  const ss = Math.floor(timeLeft % 60);
  const urgent = !untimed && timeLeft < 15;
  const share = estimate ? estimate.protected / estimate.atRisk : 0;
  const lastTick = useRef(-1);

  useEffect(() => {
    const sec = Math.ceil(timeLeft);
    if (!untimed && sec <= 10 && sec > 0 && sec !== lastTick.current) {
      lastTick.current = sec;
      sfx.tick();
      if (sec <= 3) sfx.buzz(30);
    }
  }, [timeLeft, untimed]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2 sm:gap-3 sm:p-4">
      <Panel className="pointer-events-auto hidden items-center gap-4 px-4 py-2.5 lg:flex">
        <Logo size="sm" />
        <div className="h-8 w-px bg-white/10" />
        <div>
          <div className="font-display text-base font-bold uppercase tracking-[0.16em] text-white">
            {CITY_PACKS[cityId].name} · {CITY_PACKS[cityId].scenarioTitle}
          </div>
          <DataBadge kind="SCENARIO DATA" />
        </div>
      </Panel>

      <Panel className={cn("pointer-events-auto flex flex-col items-center px-3 py-1.5 sm:px-6 sm:py-2", urgent && "animate-pulse border-rose-400/60")}>
        <div className="hud-label">Plan</div>
        <div className={cn("font-mono text-2xl font-semibold tabular sm:text-3xl", urgent ? "text-rose-300" : "text-white")}>{untimed ? (planningSeconds === 0 ? "∞" : "--:--") : `${mm}:${String(ss).padStart(2, "0")}`}</div>
      </Panel>

      <Panel className="pointer-events-auto flex flex-1 items-center gap-2.5 px-3 py-2 sm:flex-none sm:gap-4 sm:px-4 sm:py-2.5">
        <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
          <div className="flex items-baseline justify-between gap-2">
            <span className="hud-label">Budget</span>
            <AnimatedNumber value={remaining} format={(n) => money(Math.round(n / 5e4) * 5e4)} className="text-base font-semibold text-white sm:text-lg" />
          </div>
          <Meter value={remaining / ROUND.budget} className="mt-1" color={remaining < 1e6 ? "#f43f5e" : "var(--city)"} />
        </div>
        <div className="h-9 w-px bg-white/10" />
        <div>
          <div className="hud-label">Safe</div>
          <AnimatedNumber value={share * 100} format={(n) => `${n.toFixed(0)}%`} className="text-base font-semibold text-[var(--city)] sm:text-lg" />
        </div>
        <Button
          onClick={() => {
            sfx.click();
            lockPlan();
          }}
          aria-label="Lock plan"
          className="h-10 bg-[var(--city)] px-3 font-display text-sm font-bold uppercase tracking-[0.18em] text-[#03140d] hover:bg-[var(--city)] hover:brightness-110 sm:px-4"
        >
          <Lock className="size-4" /> <span className="hidden sm:inline">Lock plan</span>
        </Button>
      </Panel>
      <span className="sr-only" aria-live="polite">
        {`Budget remaining ${money(remaining)}. Estimated protected ${pct(share)}.`}
      </span>
    </div>
  );
}
