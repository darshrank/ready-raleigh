"use client";

import { ChevronRight, Crosshair, Pause, Play, Rewind, SkipForward } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { CITY_PACKS } from "@/cities";
import { Logo } from "@/components/brand/Logo";
import { DataBadge, int, Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { BRAND, type ScenarioParams } from "@/config/game";
import { CameraModes, CommandButtons, LayerMenu } from "@/features/planning/BottomDock";
import { ThemeToggle } from "@/features/map/ThemeToggle";
import { mapBus } from "@/lib/map-bus";
import { speak } from "@/lib/speech";
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

const LEGEND = [
  { label: "Evacuating", color: "#22d3ee", glyph: "→" },
  { label: "Rerouted", color: "#fb923c", glyph: "↺" },
  { label: "Delayed", color: "#facc15", glyph: "…" },
  { label: "Protected", color: "#34d399", glyph: "●" },
  { label: "__STRANDED__", color: "#f43f5e", glyph: "✕" },
  { label: "Isolated", color: "#a855f7", glyph: "⊘" },
  { label: "Bus / rescue", color: "#fde047", glyph: "▬" },
];

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
  const sample = sim.timeline[Math.min(sim.timeline.length - 1, quarter)];
  const clock = clockLabel(cfg, simHour);
  const done = simHour >= cfg.durationHours;
  const spoken = useRef(new Set<number>());

  const visibleEvents = useMemo(() => sim.events.filter((e) => e.hour <= quarter / 4).reverse(), [sim, quarter]);

  useEffect(() => {
    if (!radio) return;
    sim.events.forEach((e, i) => {
      if (e.hour <= simHour && e.hour > simHour - 0.5 && !spoken.current.has(i) && (e.level === "critical" || e.level === "success")) {
        spoken.current.add(i);
        speak(`${e.title}. ${e.detail}`, { rate: 1.08 });
      }
    });
  }, [radio, simHour, sim]);

  useEffect(() => {
    if (!done || !demo) return;
    const t = setTimeout(() => setPhase("results"), 2000);
    return () => clearTimeout(t);
  }, [done, demo, setPhase]);

  return (
    <motion.div className="pointer-events-none absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
        <Panel className="pointer-events-auto flex flex-col items-center px-6 py-2">
          <div className="hud-label">{stormPhase(cfg, simHour)}</div>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold text-white tabular">{clock.time}</span>
            <span className="font-mono text-xs text-dim">DAY {clock.day} · H+{simHour.toFixed(1)}</span>
          </div>
        </Panel>
        <Panel className="pointer-events-auto grid grid-cols-4 gap-4 px-4 py-2.5">
          <Counter label={cfg.hazard.type === "heat" ? "Cooled" : "Protected"} value={sample.protected} color="#34d399" />
          <Counter label={cfg.hazard.type === "heat" ? "Moving" : "Evacuating"} value={sample.evacuating} color="#22d3ee" />
          <Counter label={cfg.terms.stranded} value={sample.stranded} color="#f43f5e" />
          <Counter label="Isolated" value={sample.isolated} color="#a855f7" />
        </Panel>
      </div>

      <Panel className="pointer-events-auto absolute left-3 top-24 z-20 w-[200px] p-3 sm:left-4">
        <div className="hud-label">Agents</div>
        <ul className="mt-2 flex flex-col gap-1">
          {LEGEND.map((l) => ({ ...l, label: l.label === "__STRANDED__" ? cfg.terms.stranded : l.label })).map((l) => (
            <li key={l.label} className="flex items-center gap-2 text-[12px] text-white/85">
              <span className="w-4 text-center font-mono" style={{ color: l.color }}>
                {l.glyph}
              </span>
              {l.label}
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t border-white/8 pt-2 font-mono text-[10.5px] text-dim">1 agent ≈ {cfg.residentsPerAgent} residents</div>
        {cfg.hazard.type !== "heat" && <div className="mt-1 font-mono text-[10.5px] text-dim">Red roads: closed</div>}
      </Panel>

      <Panel className="pointer-events-auto absolute right-3 top-24 z-20 flex max-h-[calc(100vh-13rem)] w-[320px] flex-col p-3 sm:right-4">
        <div className="hud-label">Event feed</div>
        <ul className="mt-2 flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1" aria-live="polite">
          <AnimatePresence initial={false}>
            {visibleEvents.map((e) => (
              <motion.li key={`${e.hour}-${e.title}`} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} layout>
                <button
                  type="button"
                  disabled={e.lon === undefined}
                  onClick={() => e.lon !== undefined && mapBus.flyTo({ center: [e.lon, e.lat!], zoom: 14.5, pitch: 55, duration: 1800 })}
                  className={cn(
                    "w-full rounded-lg border px-2.5 py-2 text-left transition hover:bg-white/5",
                    e.level === "critical" ? "border-rose-400/35 bg-rose-500/8" : e.level === "success" ? "border-emerald-400/30 bg-emerald-500/8" : e.level === "warning" ? "border-amber-400/25 bg-amber-400/5" : "border-white/8",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-dim">H+{e.hour.toFixed(1)}</span>
                    {e.lon !== undefined && <Crosshair className="size-3 text-dim" />}
                  </div>
                  <div className="text-[12.5px] font-semibold text-white">{e.title}</div>
                  <div className="text-[11.5px] leading-snug text-white/65">{e.detail}</div>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Panel>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 p-3 sm:p-4">
        <Panel className="pointer-events-auto flex items-center gap-3 px-3 py-2.5">
          <Button size="icon-sm" variant="ghost" onClick={() => setSimHour(0)} aria-label="Rewind">
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
          <Button size="icon-sm" variant="ghost" onClick={() => setSimHour(Math.min(cfg.durationHours, Math.floor(simHour) + 1))} aria-label="Step forward one hour">
            <SkipForward />
          </Button>
          <div className="flex rounded-md border border-white/10 p-0.5">
            {([1, 2, 4] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setSpeed(v)}
                className={cn("rounded px-2 py-0.5 font-mono text-[11px]", speed === v ? "bg-white/15 text-white" : "text-dim hover:text-white")}
              >
                {v}x
              </button>
            ))}
          </div>
          <div className="relative flex-1 px-2">
            <div className="pointer-events-none absolute inset-x-2 -top-2 h-2">
              {sim.events.map((e, i) => (
                <span
                  key={i}
                  className="absolute top-0 h-2 w-0.5 rounded"
                  style={{
                    left: `${(e.hour / cfg.durationHours) * 100}%`,
                    background: e.level === "critical" ? "#f43f5e" : e.level === "success" ? "#34d399" : e.level === "warning" ? "#fb923c" : "#64748b",
                  }}
                />
              ))}
            </div>
            <Slider
              value={[simHour]}
              min={0}
              max={cfg.durationHours}
              step={0.05}
              onValueChange={([v]) => setSimHour(v)}
              aria-label="Simulation time"
            />
          </div>
          <span className="w-16 text-right font-mono text-xs text-dim">H+{simHour.toFixed(1)}</span>
        </Panel>
        <div className="flex items-end justify-between gap-3">
          <Panel className="pointer-events-auto flex items-center gap-2 p-2">
            <CameraModes allowShadow />
            <ThemeToggle />
            <LayerMenu />
            <Button size="sm" variant="ghost" onClick={() => {
                const b = CITY_PACKS[cityId].cameraBookmarks.find((x) => x.id === "overview") ?? CITY_PACKS[cityId].cameraBookmarks[0];
                mapBus.flyTo({ ...b, duration: 1500 });
              }}>
              Reset camera
            </Button>
          </Panel>
          {done ? (
            <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <Button
                size="lg"
                onClick={() => setPhase("results")}
                className="pointer-events-auto h-12 animate-pulse bg-[var(--city)] font-display text-lg font-bold uppercase tracking-[0.2em] text-[#03140d] hover:bg-[var(--city)]"
              >
                See what happened <ChevronRight />
              </Button>
            </motion.div>
          ) : (
            <Panel className="pointer-events-auto p-2">
              <CommandButtons />
            </Panel>
          )}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{`Hour ${Math.floor(simHour)}. ${int(sample.protected)} protected, ${int(sample.stranded)} stranded.`}</span>
    </motion.div>
  );
}

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="min-w-16">
      <div className="hud-label" style={{ color }}>
        {label}
      </div>
      <div className="font-mono text-xl font-semibold text-white tabular">{int(value)}</div>
    </div>
  );
}
