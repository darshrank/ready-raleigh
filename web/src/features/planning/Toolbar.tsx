"use client";

import { Redo2, Scan, Undo2, X } from "lucide-react";
import { useMemo } from "react";
import { money, Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROUND, type InterventionSpec } from "@/config/game";
import { iconUrl } from "@/features/map/icons";
import { placeOrMove, protectableCrossings } from "@/features/map/layers";
import { sfx } from "@/lib/audio/sfx";
import { metersBetween } from "@/lib/engine/geo";
import { candidateSets } from "@/lib/engine/optimize";
import { cn } from "@/lib/utils";
import { spent, useGame } from "@/stores/game";

export function useToolHint() {
  const activeTool = useGame((s) => s.activeTool);
  const data = useGame((s) => s.data);
  const spec = data && activeTool ? data.cfg.interventions.find((i) => i.id === activeTool) : null;
  if (!spec || !data) return "Pick a tool, then tap the map to place it.";
  const heat = data.cfg.hazard.type === "heat";
  switch (spec.snapsTo) {
    case "crossing":
      return "Tap a highlighted road. Red fails first, yellow later.";
    case "shelterSite":
      return heat ? "Tap a library, school or community center." : "Tap a site. Green is dry ground, orange is inside the hazard.";
    case "busStop":
      return spec.effect === "shield" ? "Tap a stop to set up water and shade." : "Tap a yellow stop near people without a car.";
    case "fireStation":
      return "Tap a fire station to base the team there.";
    case "shieldPoint":
      return spec.shieldKind === "surge" ? "Tap a teal shoreline point to hold back surge." : "Tap a blue low spot to pump out rain and canal water.";
    case "zone":
      return "Tap a neighborhood on liquefiable ground.";
  }
}

function useTools() {
  const data = useGame((s) => s.data)!;
  const activeTool = useGame((s) => s.activeTool);
  const placements = useGame((s) => s.placements);
  const cfg = data.cfg;
  const remaining = ROUND.budget - spent(placements, cfg);
  return cfg.interventions.map((def, i) => ({
    def,
    key: i + 1,
    count: placements.filter((p) => p.kind === def.id).length,
    affordable: def.cost <= remaining,
    active: activeTool === def.id,
  }));
}

const pickTool = (id: string, active: boolean) => {
  sfx.click();
  useGame.getState().setTool(active ? null : id);
};

function ScanButton({ onAchilles, compact }: { onAchilles: () => void; compact?: boolean }) {
  const achillesState = useGame((s) => s.achillesState);
  const heat = useGame((s) => s.data?.cfg.hazard.type === "heat");
  return (
    <button
      type="button"
      onClick={() => {
        sfx.whoosh();
        onAchilles();
      }}
      disabled={achillesState !== "idle"}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-rose-400/35 bg-rose-500/10 text-left transition hover:bg-rose-400/20 disabled:opacity-45",
        compact ? "shrink-0 flex-col justify-center px-3 py-2" : "w-full px-3 py-2.5",
      )}
    >
      <Scan className={cn("text-rose-300", compact ? "size-6" : "size-5")} />
      <div className={compact ? "text-center" : ""}>
        <div className={cn("font-semibold text-rose-100", compact ? "text-[11px] leading-tight" : "text-[13px]")}>{heat ? "Find the cooling gap" : "Find the weak spot"}</div>
        {!compact && <div className="text-[10.5px] text-rose-200/60">{achillesState === "done" ? "Used this round" : "AI network scan · once"}</div>}
      </div>
    </button>
  );
}

export function Toolbar({ onAchilles }: { onAchilles: () => void }) {
  const tools = useTools();
  const past = useGame((s) => s.past);
  const future = useGame((s) => s.future);
  const undo = useGame((s) => s.undo);
  const redo = useGame((s) => s.redo);
  const activeTool = useGame((s) => s.activeTool);
  const data = useGame((s) => s.data)!;
  const activeSpec = data.cfg.interventions.find((i) => i.id === activeTool) ?? null;
  const hint = useToolHint();

  return (
    <>
      <div className="pointer-events-none absolute left-3 top-24 z-20 hidden max-h-[calc(100vh-8rem)] w-[232px] flex-col gap-2 sm:left-4 md:flex">
        <Panel className="pointer-events-auto min-h-0 overflow-y-auto p-2">
          <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
            <span className="hud-label">Your toolkit</span>
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
            {tools.map(({ def, key, count, affordable, active }) => (
              <Tooltip key={def.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => pickTool(def.id, active)}
                    disabled={!affordable && !active}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition",
                      active ? "border-[var(--city)] bg-[var(--city)]/12 shadow-[0_0_18px_-6px_var(--city)]" : "border-transparent hover:bg-white/5",
                      !affordable && !active && "opacity-40",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={iconUrl(def.icon)} alt="" className="size-9" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-white">{def.short}</div>
                      <div className="font-mono text-[10.5px] text-dim">{money(def.cost)}</div>
                    </div>
                    {count > 0 && <span className="rounded bg-white/10 px-1.5 font-mono text-[11px] text-white">×{count}</span>}
                    <Kbd>{key}</Kbd>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-60">
                  <div className="font-semibold">{def.label}</div>
                  <div className="text-xs opacity-80">{def.description}</div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          {activeSpec && <Suggestions spec={activeSpec} />}
        </Panel>
        <div className="pointer-events-auto">
          <ScanButton onAchilles={onAchilles} />
        </div>
      </div>

      {/* phones: a thumb-friendly tray along the bottom */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 md:hidden">
        <div className="hud-panel rounded-t-2xl px-2 pt-2 pb-[max(env(safe-area-inset-bottom),0.6rem)]">
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
            <span className="truncate text-[12px] text-white/85">{activeSpec ? activeSpec.description : hint}</span>
            {activeSpec ? (
              <button type="button" className="shrink-0 text-dim" onClick={() => useGame.getState().setTool(null)} aria-label="Cancel tool">
                <X className="size-4" />
              </button>
            ) : (
              past.length > 0 && (
                <button type="button" className="flex shrink-0 items-center gap-1 text-[11px] text-dim" onClick={undo}>
                  <Undo2 className="size-3.5" /> Undo
                </button>
              )
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            <ScanButton onAchilles={onAchilles} compact />
            {tools.map(({ def, count, affordable, active }) => (
              <button
                key={def.id}
                type="button"
                onClick={() => pickTool(def.id, active)}
                disabled={!affordable && !active}
                className={cn(
                  "relative flex w-[76px] shrink-0 flex-col items-center gap-0.5 rounded-xl border px-1 py-1.5 transition active:scale-95",
                  active ? "border-[var(--city)] bg-[var(--city)]/15" : "border-white/10 bg-white/[0.03]",
                  !affordable && !active && "opacity-40",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={iconUrl(def.icon)} alt="" className="size-9" />
                <span className="w-full truncate text-center text-[11px] font-semibold leading-tight text-white">{def.short}</span>
                <span className="font-mono text-[10px] text-dim">{money(def.cost)}</span>
                {count > 0 && <span className="absolute right-1 top-1 rounded-full bg-[var(--city)] px-1.5 font-mono text-[10px] font-bold text-[#03140d]">{count}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** Suggested sites ranked by nearby at-risk demand, for keyboard users and quick picks. */
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
        .slice(0, 5)
        .map((x) => x.i);
    switch (spec.snapsTo) {
      case "shelterSite":
        return sets.shelters.slice(0, 5).map((i) => ({ target: i, label: data.shelters[i].name, lon: data.shelters[i].lon, lat: data.shelters[i].lat }));
      case "busStop":
        return sets.busStops.slice(0, 5).map((i) => ({ target: i, label: data.busStops[i].name || `Stop ${i}`, lon: data.busStops[i].lon, lat: data.busStops[i].lat }));
      case "crossing":
        return protectableCrossings(data, coverage.flood.edgeClose)
          .filter((c) => c.kind !== "culvert" && c.cls <= 4)
          .sort((a, b) => a.cls - b.cls || b.len - a.len)
          .slice(0, 5)
          .map((c) => ({ target: c.id, label: c.label, lon: c.lon, lat: c.lat }));
      case "fireStation":
        return nearestTo(data.fire).map((i) => ({ target: data.fire[i].id, label: data.fire[i].name, lon: data.fire[i].lon, lat: data.fire[i].lat }));
      case "shieldPoint":
        return sets.shields.filter((p) => p.kind === spec.shieldKind).slice(0, 5).map((p) => ({ target: p.id, label: p.label, lon: p.lon, lat: p.lat }));
      case "zone":
        return [...data.zones].sort((a, b) => b.floodShare * b.pop - a.floodShare * a.pop).slice(0, 5).map((z) => ({ target: z.id, label: z.name, lon: z.lon, lat: z.lat }));
    }
  }, [spec, data, coverage]);

  return (
    <div className="mt-2 border-t border-white/8 pt-2">
      <div className="px-1.5 pb-1 text-[10.5px] text-dim">Tap the map, or a suggested site:</div>
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
