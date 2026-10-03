"use client";

import { ChevronRight, Crosshair, Pause, Play, Radio, Rewind } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo } from "react";
import { CITY_PACKS } from "@/cities";
import { Logo } from "@/components/brand/Logo";
import { SoundToggle, ThemeCycle } from "@/components/hud/Controls";
import { DataBadge, int, Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { ScenarioParams } from "@/config/game";
import { sfx } from "@/lib/audio/sfx";
import { mapBus } from "@/lib/map-bus";
import { cn } from "@/lib/utils";
import { cfgOf, useGame } from "@/stores/game";

export function clockLabel(cfg: ScenarioParams, h: number) {
  const total = cfg.startClock + h;
  const day = Math.floor(total / 24) + 1;
  const hh = Math.floor(total % 24);
  const mm = Math.floor((total % 1) * 60);
  return { day, time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
}

export function stormPhase(cfg: ScenarioParams, h: number) {
  return (cfg.phases.find((p) => h < p.untilHour) ?? cfg.phases[cfg.phases.length - 1]).label;
}

const LEVEL_STYLE = {
  critical: "border-rose-400/45 bg-rose-500/12",
  success: "border-emerald-400/40 bg-emerald-500/10",
  warning: "border-amber-400/30 bg-amber-400/8",
  info: "border-white/10 bg-white/[0.03]",
} as const;

export function SimulationHud() {
  const sim = useGame((s) => s.sim)!;
  const cfg = useGame((s) => cfgOf(s));
  const cityId = useGame((s) => s.cityId ?? "raleigh");
  const quarter = useGame((s) => Math.floor(s.simHour * 4));
  const simHour = useGame((s) => s.simHour);
  const playing = useGame((s) => s.playing);
  const speed = useGame((s) => s.speed);
  const radio = useGame((s) => s.radio);
  const demo = useGame((s) => s.demo);
  const setPlaying = useGame((s) => s.setPlaying);
  const setSpeed = useGame((s) => s.setSpeed);
  const setSimHour = useGame((s) => s.setSimHour);
  const setPhase = useGame((s) => s.setPhase);
  const setPref = useGame((s) => s.setPref);
  const sample = sim.timeline[Math.min(sim.timeline.length - 1, quarter)];
  const clock = clockLabel(cfg, simHour);
  const done = simHour >= cfg.durationHours;
  const pack = CITY_PACKS[cityId];

  const visibleEvents = useMemo(() => sim.events.filter((e) => e.hour <= quarter / 4).reverse(), [sim, quarter]);

  useEffect(() => {
    if (!done) return;
    sfx.alert("success");
    if (!demo) return;
    const t = setTimeout(() => setPhase("results"), 2000);
    return () => clearTimeout(t);
  }, [done, demo, setPhase]);

  return (
    <motion.div className="pointer-events-none absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2 sm:gap-3 sm:p-4">
        <Panel className="pointer-events-auto hidden items-center gap-4 px-4 py-2.5 lg:flex">
          <Logo size="sm" />
          <div className="h-8 w-px bg-white/10" />
          <div>
            <div className="font-display text-base font-bold uppercase tracking-[0.16em] text-white">
              {pack.name} · {pack.scenarioTitle}
            </div>
            <DataBadge kind="SCENARIO DATA" />
          </div>
        </Panel>
        <Panel className="pointer-events-auto flex flex-col items-center px-3 py-1.5 sm:px-6 sm:py-2">
          <div className="hud-label max-w-28 truncate sm:max-w-none">{stormPhase(cfg, simHour)}</div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-white tabular sm:text-3xl">{clock.time}</span>
            <span className="hidden font-mono text-xs text-dim sm:inline">DAY {clock.day}</span>
          </div>
        </Panel>
        <Panel className="pointer-events-auto grid flex-1 grid-cols-3 gap-2 px-3 py-2 sm:flex-none sm:gap-4 sm:px-4 sm:py-2.5">
          <Counter label={cfg.hazard.type === "heat" ? "Cooled" : "Safe"} value={sample.protected} color="#34d399" />
          <Counter label={cfg.terms.stranded} value={sample.stranded} color="#f43f5e" />
          <Counter label="Cut off" value={sample.isolated} color="#a855f7" />
        </Panel>
      </div>

      <div className="pointer-events-none absolute right-2 top-[5.2rem] z-20 flex w-[min(320px,calc(100vw-1rem))] flex-col gap-1.5 sm:right-4 sm:top-24">
        <AnimatePresence initial={false}>
          {visibleEvents.slice(0, 4).map((e, i) => (
            <motion.button
              key={`${e.hour}-${e.title}`}
              type="button"
              layout
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: i === 0 ? 1 : 0.75 - i * 0.12, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30 }}
              disabled={e.lon === undefined}
              onClick={() => e.lon !== undefined && mapBus.flyTo({ center: [e.lon, e.lat!], zoom: 14.5, pitch: 55, duration: 1800 })}
              className={cn("hud-panel pointer-events-auto w-full rounded-xl border px-3 py-2 text-left transition hover:brightness-125", LEVEL_STYLE[e.level], i > 0 && "max-sm:hidden")}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-dim">{clockLabel(cfg, e.hour).time}</span>
                {e.lon !== undefined && <Crosshair className="size-3 text-dim" />}
              </div>
              <div className="text-[13px] font-semibold leading-snug text-white">{e.title}</div>
              {i === 0 && <div className="text-[11.5px] leading-snug text-white/70">{e.detail}</div>}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:p-4">
        {done && (
          <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex justify-center">
            <Button
              size="lg"
              onClick={() => {
                sfx.whoosh();
                setPhase("results");
              }}
              className="pointer-events-auto h-13 animate-pulse rounded-xl bg-[var(--city)] px-8 font-display text-lg font-bold uppercase tracking-[0.2em] text-[#03140d] shadow-[0_0_30px_-4px_var(--city)] hover:bg-[var(--city)]"
            >
              See your score <ChevronRight />
            </Button>
          </motion.div>
        )}
        <Panel className="pointer-events-auto flex items-center gap-2 px-2.5 py-2 sm:gap-3 sm:px-3 sm:py-2.5">
          <Button size="icon-sm" variant="ghost" onClick={() => setSimHour(0)} aria-label="Restart playback" className="hidden sm:inline-flex">
            <Rewind />
          </Button>
          <Button
            size="icon"
            onClick={() => {
              if (done) setSimHour(0);
              setPlaying(!playing || done);
            }}
            aria-label={playing ? "Pause" : "Play"}
            className="bg-[var(--city)] text-[#03140d] hover:bg-[var(--city)]"
          >
            {playing && !done ? <Pause /> : <Play />}
          </Button>
          <div className="flex rounded-md border border-white/10 p-0.5">
            {([1, 2, 4] as const).map((v) => (
              <button key={v} type="button" onClick={() => setSpeed(v)} className={cn("rounded px-1.5 py-0.5 font-mono text-[11px] sm:px-2", speed === v ? "bg-white/15 text-white" : "text-dim hover:text-white")}>
                {v}x
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 px-1 sm:px-2">
            <div className="pointer-events-none absolute inset-x-1 -top-2 h-2 sm:inset-x-2">
              {sim.events.map((e, i) => (
                <span key={i} className="absolute top-0 h-2 w-0.5 rounded" style={{ left: `${(e.hour / cfg.durationHours) * 100}%`, background: e.level === "critical" ? "#f43f5e" : e.level === "success" ? "#34d399" : e.level === "warning" ? "#fb923c" : "#64748b" }} />
              ))}
            </div>
            <Slider value={[simHour]} min={0} max={cfg.durationHours} step={0.05} onValueChange={([v]) => setSimHour(v)} aria-label="Simulation time" />
          </div>
          <Legend term={cfg.terms.stranded} />
          <Button
            size="icon-sm"
            variant="outline"
            aria-pressed={radio}
            title={radio ? "Voice alerts on" : "Voice alerts off"}
            aria-label="Toggle voice alerts"
            onClick={() => setPref("radio", !radio)}
            className={cn("border-white/10 bg-black/40", radio ? "text-rose-200" : "text-dim")}
          >
            <Radio />
          </Button>
          <SoundToggle />
          <ThemeCycle className="hidden sm:inline-flex" />
        </Panel>
      </div>
      <span className="sr-only" aria-live="polite">{`Hour ${Math.floor(simHour)}. ${int(sample.protected)} safe, ${int(sample.stranded)} ${cfg.terms.strandedVerb}.`}</span>
    </motion.div>
  );
}

function Legend({ term }: { term: string }) {
  const items = [
    ["#22d3ee", "Moving"],
    ["#34d399", "Safe"],
    ["#f43f5e", term],
    ["#a855f7", "Cut off"],
  ];
  return (
    <div className="hidden items-center gap-2.5 xl:flex">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1 text-[11px] text-white/70">
          <span className="size-2 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
          {l}
        </span>
      ))}
    </div>
  );
}

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="min-w-0 sm:min-w-16">
      <div className="hud-label truncate" style={{ color }}>
        {label}
      </div>
      <div className="font-mono text-base font-semibold text-white tabular sm:text-xl">{int(value)}</div>
    </div>
  );
}
