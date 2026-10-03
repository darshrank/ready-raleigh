"use client";

import { Lock, Snowflake } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { AnimatedNumber, DataBadge, Meter, money, Panel, pct } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { BRAND, ROUND } from "@/config/game";
import { cn } from "@/lib/utils";
import { CITY_PACKS } from "@/cities";
import { cfgOf, spent, useGame } from "@/stores/game";

export function TopBar() {
  const placements = useGame((s) => s.placements);
  const cfg = useGame((s) => cfgOf(s));
  const cityId = useGame((s) => s.cityId ?? "raleigh");
  const timeLeft = useGame((s) => s.timeLeft);
  const timerRunning = useGame((s) => s.timerRunning);
  const freezeLeft = useGame((s) => s.freezeLeft);
  const planningSeconds = useGame((s) => s.planningSeconds);
  const estimate = useGame((s) => s.estimate);
  const baseline = useGame((s) => s.baseline);
  const setPhase = useGame((s) => s.setPhase);
  const used = spent(placements, cfg);
  const remaining = ROUND.budget - used;
  const untimed = planningSeconds === 0 || !timerRunning;
  const mm = Math.floor(timeLeft / 60);
  const ss = Math.floor(timeLeft % 60);
  const urgent = !untimed && timeLeft < 30;
  const share = estimate ? estimate.protected / estimate.atRisk : 0;
  const gain = estimate && baseline ? estimate.protected - baseline.protected : 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 sm:p-4">
      <Panel className="pointer-events-auto flex items-center gap-4 px-4 py-2.5">
        <Logo size="sm" />
        <div className="h-8 w-px bg-white/10" />
        <div>
          <div className="font-display text-base font-bold uppercase tracking-[0.16em] text-white">
            {CITY_PACKS[cityId].name} · {CITY_PACKS[cityId].scenarioTitle}
          </div>
          <div className="flex items-center gap-2">
            <DataBadge kind="SCENARIO DATA" />
            <span className="hidden font-mono text-[9.5px] tracking-wider text-dim lg:inline">{BRAND.disclaimer}</span>
          </div>
        </div>
      </Panel>

      <Panel className={cn("pointer-events-auto flex flex-col items-center px-6 py-2", urgent && "border-rose-400/50")}>
        <div className="hud-label">{freezeLeft > 0 ? "Time frozen" : "Planning phase"}</div>
        {untimed ? (
          <div className="font-mono text-2xl font-semibold text-white">{planningSeconds === 0 ? "∞" : "Paused"}</div>
        ) : (
          <div className={cn("flex items-center gap-2 font-mono text-3xl font-semibold tabular", urgent ? "text-rose-300" : "text-white")}>
            {freezeLeft > 0 && <Snowflake className="size-5 text-sky-300" />}
            {mm}:{String(ss).padStart(2, "0")}
          </div>
        )}
      </Panel>

      <Panel className="pointer-events-auto flex items-center gap-4 px-4 py-2.5">
        <div className="w-44">
          <div className="flex items-baseline justify-between">
            <span className="hud-label">Budget left</span>
            <AnimatedNumber value={remaining} format={(n) => money(Math.round(n / 1e5) * 1e5)} className="text-lg font-semibold text-white" />
          </div>
          <Meter value={remaining / ROUND.budget} className="mt-1" color={remaining < 1e6 ? "#f43f5e" : "var(--city)"} />
        </div>
        <div className="h-9 w-px bg-white/10" />
        <div className="min-w-28">
          <div className="hud-label">Est. protected</div>
          <div className="flex items-baseline gap-1.5">
            <AnimatedNumber value={share * 100} format={(n) => `${n.toFixed(0)}%`} className="text-lg font-semibold text-[var(--city)]" />
            {gain > 0 && <span className="font-mono text-[10px] text-emerald-300">+{Math.round(gain).toLocaleString()}</span>}
          </div>
        </div>
        <Button
          onClick={() => {
            useGame.setState({ timerRunning: false, activeTool: null, hover: null });
            setPhase("locking");
          }}
          className="h-10 bg-[var(--city)] font-display text-sm font-bold uppercase tracking-[0.18em] text-[#03140d] hover:bg-[var(--city)] hover:brightness-110"
        >
          <Lock className="size-4" /> Lock plan
        </Button>
      </Panel>
      <span className="sr-only" aria-live="polite">
        {`Budget remaining ${money(remaining)}. Estimated protected ${pct(share)}.`}
      </span>
    </div>
  );
}
