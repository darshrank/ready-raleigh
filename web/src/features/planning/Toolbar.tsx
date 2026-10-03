"use client";

import { Eye, Lock, Redo2, Scan, Snowflake, Undo2 } from "lucide-react";
import { useMemo } from "react";
import { money, Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROUND, type InterventionSpec } from "@/config/game";
import { iconUrl } from "@/features/map/icons";
import { placeOrMove, protectableCrossings } from "@/features/map/layers";
import { metersBetween } from "@/lib/engine/geo";
import { candidateSets } from "@/lib/engine/optimize";
import { cn } from "@/lib/utils";
import { INTEL, intelLabel, spent, useGame, type IntelKey } from "@/stores/game";

export function Toolbar({ onAchilles }: { onAchilles: () => void }) {
  const data = useGame((s) => s.data)!;
  const activeTool = useGame((s) => s.activeTool);
  const setTool = useGame((s) => s.setTool);
  const placements = useGame((s) => s.placements);
  const past = useGame((s) => s.past);
  const future = useGame((s) => s.future);
  const undo = useGame((s) => s.undo);
  const redo = useGame((s) => s.redo);
  const timeFreezeUsed = useGame((s) => s.timeFreezeUsed);
  const useTimeFreeze = useGame((s) => s.useTimeFreeze);
  const timerRunning = useGame((s) => s.timerRunning);
  const achillesState = useGame((s) => s.achillesState);
  const intelTokens = useGame((s) => s.intelTokens);
  const intel = useGame((s) => s.intel);
  const unlockIntel = useGame((s) => s.unlockIntel);
  const cfg = data.cfg;
  const remaining = ROUND.budget - spent(placements, cfg);
  const heat = cfg.hazard.type === "heat";
  const activeSpec = cfg.interventions.find((i) => i.id === activeTool) ?? null;

  return (
    <div className="pointer-events-none absolute left-3 top-24 z-20 flex max-h-[calc(100vh-11rem)] w-[248px] flex-col gap-3 sm:left-4">
      <Panel className="pointer-events-auto min-h-0 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
          <span className="hud-label">Interventions</span>
          <div className="flex gap-0.5">
            <Button size="icon-xs" variant="ghost" disabled={!past.length} onClick={undo} aria-label="Undo">
              <Undo2 />
            </Button>
            <Button size="icon-xs" variant="ghost" disabled={!future.length} onClick={redo} aria-label="Redo">
              <Redo2 />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {cfg.interventions.map((def, i) => {
            const count = placements.filter((p) => p.kind === def.id).length;
            const affordable = def.cost <= remaining;
            const active = activeTool === def.id;
            return (
              <Tooltip key={def.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setTool(active ? null : def.id)}
                    disabled={!affordable && !active}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition",
                      active ? "border-[var(--city)] bg-[var(--city)]/12" : "border-transparent hover:bg-white/5",
                      !affordable && !active && "opacity-40",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={iconUrl(def.icon)} alt="" className="size-8" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-white">{def.short}</div>
                      <div className="font-mono text-[10.5px] text-dim">{money(def.cost)}</div>
                    </div>
                    {count > 0 && <span className="rounded bg-white/10 px-1.5 font-mono text-[11px] text-white">×{count}</span>}
                    <Kbd className="hidden sm:inline-flex">{i + 1}</Kbd>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-60">
                  <div className="font-semibold">{def.label}</div>
                  <div className="text-xs opacity-80">{def.description}</div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        {activeSpec && <Suggestions spec={activeSpec} />}
      </Panel>

      <Panel className="pointer-events-auto p-2">
        <div className="px-1.5 pb-1.5 hud-label">Special powers</div>
        <button
          type="button"
          onClick={onAchilles}
          disabled={achillesState !== "idle"}
          className="flex w-full items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/8 px-2.5 py-2 text-left transition hover:bg-rose-400/15 disabled:opacity-50"
        >
          <Scan className="size-4 text-rose-300" />
          <div className="flex-1">
            <div className="text-[12.5px] font-semibold text-rose-100">{heat ? "Find the cooling gap" : "Find the Achilles' heel"}</div>
            <div className="text-[10.5px] text-rose-200/60">{achillesState === "done" ? "Used this round" : heat ? "Cooling access scan · once" : "Network bottleneck scan · once"}</div>
          </div>
        </button>
        <button
          type="button"
          onClick={useTimeFreeze}
          disabled={timeFreezeUsed || !timerRunning}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/5 disabled:opacity-40"
        >
          <Snowflake className="size-4 text-sky-300" />
          <div className="flex-1">
            <div className="text-[12.5px] font-semibold text-white">Time freeze</div>
            <div className="text-[10.5px] text-dim">Pause the timer {ROUND.timeFreezeSeconds}s · once</div>
          </div>
        </button>
      </Panel>

      <Panel className="pointer-events-auto min-h-0 shrink-0 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-1.5 pb-1.5">
          <span className="hud-label">Intel scans</span>
          <span className="font-mono text-[11px] text-white">
            {intelTokens} <span className="text-dim">tokens</span>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          {(Object.keys(INTEL) as IntelKey[]).map((k) => {
            const info = intelLabel(k, cfg.hazard.type);
            return (
              <button
                key={k}
                type="button"
                disabled={intel[k] || intelTokens <= 0}
                onClick={() => unlockIntel(k)}
                className={cn("flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition", intel[k] ? "bg-[var(--city)]/10" : "hover:bg-white/5 disabled:opacity-40")}
              >
                {intel[k] ? <Eye className="mt-0.5 size-3.5 text-[var(--city)]" /> : <Lock className="mt-0.5 size-3.5 text-dim" />}
                <div>
                  <div className="text-[12px] font-semibold text-white">{info.label}</div>
                  <div className="text-[10.5px] leading-snug text-dim">{info.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/** Keyboard-friendly placement: suggested sites ranked by nearby at-risk demand. */
function Suggestions({ spec }: { spec: InterventionSpec }) {
  const data = useGame((s) => s.data)!;
  const coverage = useGame((s) => s.coverage)!;
  const setHover = useGame((s) => s.setHover);
  const items = useMemo(() => {
    const sets = candidateSets(coverage, null);
    const heavy = [...data.origins].sort((a, b) => b.pop - a.pop).slice(0, 12);
    const nearestTo = <T extends { lon: number; lat: number }>(list: T[]) =>
      list
        .map((it, i) => ({ i, d: Math.min(...heavy.map((o) => metersBetween(it.lon, it.lat, o.lon, o.lat))) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)
        .map((x) => x.i);
    switch (spec.snapsTo) {
      case "shelterSite":
        return sets.shelters.slice(0, 6).map((i) => ({ target: i, label: data.shelters[i].name, lon: data.shelters[i].lon, lat: data.shelters[i].lat }));
      case "busStop":
        return sets.busStops.slice(0, 6).map((i) => ({ target: i, label: data.busStops[i].name || `Stop ${i}`, lon: data.busStops[i].lon, lat: data.busStops[i].lat }));
      case "crossing":
        return protectableCrossings(data, coverage.flood.edgeClose)
          .filter((c) => c.kind !== "culvert" && c.cls <= 4)
          .sort((a, b) => a.cls - b.cls || b.len - a.len)
          .slice(0, 6)
          .map((c) => ({ target: c.id, label: c.label, lon: c.lon, lat: c.lat }));
      case "fireStation":
        return nearestTo(data.fire).map((i) => ({ target: data.fire[i].id, label: data.fire[i].name, lon: data.fire[i].lon, lat: data.fire[i].lat }));
      case "shieldPoint":
        return sets.shields.filter((p) => p.kind === spec.shieldKind).slice(0, 6).map((p) => ({ target: p.id, label: p.label, lon: p.lon, lat: p.lat }));
      case "zone":
        return [...data.zones].sort((a, b) => b.floodShare * b.pop - a.floodShare * a.pop).slice(0, 6).map((z) => ({ target: z.id, label: z.name, lon: z.lon, lat: z.lat }));
    }
  }, [spec, data, coverage]);

  return (
    <div className="mt-2 border-t border-white/8 pt-2">
      <div className="px-1.5 pb-1 text-[10.5px] text-dim">Click the map, or pick a suggested site:</div>
      <ul className="flex flex-col">
        {items.map((it) => (
          <li key={it.target}>
            <button
              type="button"
              onMouseEnter={() => setHover({ kind: spec.id, target: it.target })}
              onFocus={() => setHover({ kind: spec.id, target: it.target })}
              onMouseLeave={() => setHover(null)}
              onClick={() => placeOrMove(spec.id, it.target, it.lon, it.lat, it.label)}
              className="w-full truncate rounded px-1.5 py-1 text-left text-[12px] text-white/85 hover:bg-white/8 focus-visible:bg-white/10"
            >
              {it.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
