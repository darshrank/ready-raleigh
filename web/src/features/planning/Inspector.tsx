"use client";

import { AlertTriangle, Lock, Move, Trash2, Waves, X } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { int, money, Panel, pct, StatusChip } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { ROUND, specFor, type InterventionSpec, type ScenarioParams } from "@/config/game";
import { candidatePoint, movingFlag, placeOrMove } from "@/features/map/layers";
import { crossingDependents, ripple } from "@/lib/engine/coverage";
import { toEnginePlan, type EnginePlan } from "@/lib/engine/plan";
import { spent, useGame } from "@/stores/game";
import type { StatusLevel } from "@/types";

export function statusFor(share: number, atRisk: number): StatusLevel {
  if (atRisk < 20) return "STABLE";
  if (share >= 0.85) return "STABLE";
  if (share >= 0.65) return "WATCH";
  if (share >= 0.4) return "ELEVATED";
  return "CRITICAL";
}

export function Inspector() {
  const selected = useGame((s) => s.selected);
  const hover = useGame((s) => s.hover);
  const select = useGame((s) => s.select);
  if (hover) return <RipplePreview />;
  if (!selected) return null;
  return (
    <motion.div key={JSON.stringify(selected)} initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="pointer-events-none absolute right-3 top-24 z-20 w-[300px] sm:right-4">
      <Panel className="pointer-events-auto max-h-[calc(100vh-12rem)] overflow-y-auto p-4">
        <button type="button" onClick={() => select(null)} className="absolute right-3 top-3 text-dim hover:text-white" aria-label="Close inspector">
          <X className="size-4" />
        </button>
        {selected.type === "zone" && <ZoneCard id={selected.id} />}
        {selected.type === "intervention" && <PlacementCard id={selected.id} />}
        {selected.type === "crossing" && <CrossingCard id={selected.id} />}
        {selected.type === "hospital" && <HospitalCard id={selected.id} />}
      </Panel>
    </motion.div>
  );
}

function Row({ label, value, locked }: { label: string; value: string; locked?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[12.5px]">
      <span className="text-dim">{label}</span>
      {locked ? (
        <span className="flex items-center gap-1 font-mono text-[11px] text-dim">
          <Lock className="size-3" /> scan
        </span>
      ) : (
        <span className="font-mono text-white">{value}</span>
      )}
    </div>
  );
}

function ZoneCard({ id }: { id: number }) {
  const data = useGame((s) => s.data)!;
  const estimate = useGame((s) => s.estimate);
  const intel = useGame((s) => s.intel);
  const placements = useGame((s) => s.placements);
  const z = data.zones[id];
  const sh = data.zoneShares[id];
  const cfg = data.cfg;
  const type = cfg.hazard.type;
  const share = estimate && estimate.zoneAtRisk[id] > 0 ? estimate.zoneProtected[id] / estimate.zoneAtRisk[id] : 1;
  const level = statusFor(share, z.atRisk);
  const locked = !intel.demographic;
  const nearby = placements.filter((p) => Math.hypot((p.lon - z.lon) * 0.81, p.lat - z.lat) < 0.02).length;
  const why =
    z.atRisk < 20
      ? "Few residents here face the hazard directly. Its roads may still matter to neighbors who pass through."
      : type === "heat"
        ? `${int(z.atRisk)} heat-vulnerable residents here likely lack reliable home cooling.` + (locked ? " Run a Demographic Scan to see who they are." : ` ${pct(sh.s65)} are 65 or older and ${pct(sh.spov)} live below the poverty line. A cooling center within a 900 m walk is what helps.`)
        : `${int(z.atRisk)} of ${int(z.pop)} residents live in or near the ${cfg.terms.hazardArea}.` +
          (locked
            ? " Run a Demographic Scan to see who they are."
            : sh.snv > 0.12
              ? ` ${pct(sh.snv)} of households have no car, so drive-time coverage does not reach them. Buses or a walkable shelter do.`
              : sh.s65 > 0.18
                ? ` ${pct(sh.s65)} are 65 or older and tend to leave later.`
                : " Most households can drive out if their roads stay open.");
  return (
    <div>
      <div className="hud-label">Neighborhood · Census tract {z.tract}</div>
      <div className="mt-1 pr-6 font-display text-2xl font-extrabold uppercase tracking-wide text-white">{z.name}</div>
      <div className="mt-2 flex items-center gap-2">
        <StatusChip level={level} />
        <span className="font-mono text-[11px] text-dim">{pct(share)} est. protected</span>
      </div>
      <div className="mt-3 border-t border-white/8 pt-2">
        <Row label="Population" value={int(z.pop)} />
        <Row label="At-risk residents" value={int(z.atRisk)} />
        {type === "heat" ? <Row label="Heat Vulnerability Index" value={z.hvi ? `${z.hvi} / 5` : "n/a"} /> : <Row label={type === "quake" ? "Area on liquefiable ground" : "Area in flood zones"} value={pct(z.floodShare)} />}
        <Row label="Households without a car" value={`${int(z.hhNoVeh)} (${pct(sh.snv)})`} locked={locked} />
        <Row label="Aged 65+" value={`${int(z.pop65)} (${pct(sh.s65)})`} locked={locked} />
        <Row label="Aged 65+ living alone" value={int(z.pop65Alone)} locked={locked} />
        <Row label="Below poverty line" value={pct(sh.spov)} locked={locked} />
        <Row label="With a disability" value={int(z.disab)} locked={locked} />
        <Row label="Limited English (adults)" value={int(z.lep)} locked={locked} />
        <Row label="Households without internet" value={int(z.hhNoNet)} locked={locked} />
        <Row label="Your interventions nearby" value={String(nearby)} />
      </div>
      <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.03] p-3">
        <div className="hud-label">Why this zone matters</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/85">{why}</p>
      </div>
      <div className="mt-2 font-mono text-[9.5px] text-dim">ACS {data.meta.sources.find((s) => s.id === "acs")?.vintage} 5-year estimates</div>
    </div>
  );
}

function effectNote(spec: InterventionSpec, cfg: ScenarioParams): string {
  switch (spec.effect) {
    case "shelter":
      return cfg.coverage.shelterDriveMinutes > 0 ? "at-risk residents covered (capacity-limited)" : "vulnerable residents within walking distance (capacity-limited)";
    case "pickup":
      return "residents without a car reached (capacity-limited)";
    case "protectRoad":
      return "at-risk residents keep a route to safety";
    case "rescue":
      return `${cfg.terms.strandedVerb} residents reachable within ${cfg.coverage.rescueReachMinutes} min (scored in the simulation)`;
    case "shield":
      return "residents whose homes stay safe longer";
    case "protectSite":
      return "residents served by the site it keeps running";
    case "medical":
      return "adds emergency care for the accessibility score";
  }
}

function PlacementCard({ id }: { id: string }) {
  const data = useGame((s) => s.data)!;
  const coverage = useGame((s) => s.coverage)!;
  const estimate = useGame((s) => s.estimate);
  const placements = useGame((s) => s.placements);
  const remove = useGame((s) => s.remove);
  const setTool = useGame((s) => s.setTool);
  const p = placements.find((x) => x.id === id);
  if (!p) return null;
  const cfg = data.cfg;
  const spec = specFor(cfg, p.kind);
  const key = spec.effect === "shield" ? `shield:${p.lon.toFixed(4)},${p.lat.toFixed(4)}` : `${spec.effect}:${p.target}`;
  const covered = estimate?.byIntervention[key] ?? 0;
  const failAt = spec.snapsTo === "shelterSite" ? coverage.flood.shelterFlood[p.target] : Infinity;
  return (
    <div>
      <div className="hud-label">{spec.label}</div>
      <div className="mt-1 pr-6 font-display text-xl font-extrabold uppercase tracking-wide text-white">{p.label}</div>
      <div className="mt-1 font-mono text-xs text-dim">{money(spec.cost)}</div>
      <div className="mt-3 rounded-lg border border-[var(--city)]/30 bg-[var(--city)]/8 p-3">
        <div className="hud-label">Estimated effect</div>
        {spec.effect === "rescue" || spec.effect === "medical" ? (
          <div className="mt-1 text-sm text-white/85">{effectNote(spec, cfg)}</div>
        ) : (
          <>
            <div className="mt-1 font-mono text-2xl font-semibold text-[var(--city)]">{int(covered)}</div>
            <div className="text-xs text-dim">{effectNote(spec, cfg)}</div>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-dim">{spec.description}</p>
      {Number.isFinite(failAt) && failAt < cfg.durationHours && (
        <div className="mt-2 flex gap-2 rounded-md border border-amber-400/30 bg-amber-400/8 p-2 text-xs text-amber-100">
          <AlertTriangle className="size-4 shrink-0" /> This site is in the {cfg.terms.hazardArea} and is expected to fail around hour {failAt.toFixed(0)}.
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 border-white/15"
          onClick={() => {
            movingFlag.id = p.id;
            setTool(p.kind);
          }}
        >
          <Move /> Move
        </Button>
        <Button variant="destructive" size="sm" className="flex-1" onClick={() => remove(p.id)}>
          <Trash2 /> Remove
        </Button>
      </div>
    </div>
  );
}

function CrossingCard({ id }: { id: number }) {
  const data = useGame((s) => s.data)!;
  const coverage = useGame((s) => s.coverage)!;
  const placements = useGame((s) => s.placements);
  const cfg = data.cfg;
  const c = data.crossings[id];
  const close = Math.min(...c.edges.map((e) => coverage.flood.edgeClose[e]));
  const plan = useMemo(() => toEnginePlan(placements, cfg), [placements, cfg]);
  const protectedAlready = plan.crossings.includes(id);
  const deps = useMemo(() => crossingDependents(coverage, { ...plan, crossings: plan.crossings.filter((x) => x !== id) }, id), [coverage, id, plan]);
  const depPop = deps.reduce((s, o) => s + o.pop, 0);
  const spec = cfg.interventions.find((i) => i.effect === "protectRoad");
  const afford = !!spec && spent(placements, cfg) + spec.cost <= ROUND.budget;
  const cls = ["Motorway", "Trunk", "Primary", "Secondary", "Tertiary", "Residential", "Local"][c.cls];
  const kindLabel = c.kind === "culvert" ? "Crossing outside the mapped hazard" : c.kind === "corridor" ? "Road on failing ground" : "Flood-prone crossing";
  return (
    <div>
      <div className="hud-label">{kindLabel}</div>
      <div className="mt-1 pr-6 font-display text-xl font-extrabold uppercase tracking-wide text-white">{c.label}</div>
      <div className="mt-3 border-t border-white/8 pt-2">
        <Row label="Road class" value={cls} />
        <Row label="Length exposed" value={`${c.len} m`} />
        <Row label="Expected to close" value={Number.isFinite(close) ? `hour ${close.toFixed(1)}` : "not in the mapped hazard"} />
        <Row label="Routes to safety it keeps open" value={int(depPop)} />
      </div>
      {spec && (
        <Button className="mt-4 w-full bg-sky-400 font-semibold text-[#03121c] hover:bg-sky-300" disabled={protectedAlready || !afford} onClick={() => placeOrMove(spec.id, c.id, c.lon, c.lat, c.label)}>
          <Waves /> {protectedAlready ? "Protected" : `${spec.short} for ${money(spec.cost)}`}
        </Button>
      )}
    </div>
  );
}

function HospitalCard({ id }: { id: number }) {
  const data = useGame((s) => s.data)!;
  const h = data.hospitals[id];
  return (
    <div>
      <div className="hud-label">Hospital</div>
      <div className="mt-1 pr-6 font-display text-xl font-extrabold uppercase tracking-wide text-white">{h.name}</div>
      <p className="mt-2 text-xs text-dim">Accessibility is scored as the share of residents who can still reach care within {data.cfg.coverage.hospitalAccessMinutes} minutes at the hazard peak.</p>
    </div>
  );
}

/** "See the ripple": marginal effect of the hovered candidate before you commit. */
function RipplePreview() {
  const hover = useGame((s) => s.hover)!;
  const data = useGame((s) => s.data)!;
  const coverage = useGame((s) => s.coverage)!;
  const placements = useGame((s) => s.placements);
  const cfg = data.cfg;
  const spec = specFor(cfg, hover.kind);
  const pt = candidatePoint(data, spec, hover.target);
  const r = useMemo(() => {
    const plan = toEnginePlan(placements, cfg);
    const add: Partial<EnginePlan> = { cost: spec.cost };
    if (spec.effect === "shelter") add.shelters = [hover.target];
    else if (spec.effect === "pickup") add.busStops = [hover.target];
    else if (spec.effect === "protectRoad") add.crossings = [hover.target];
    else if (spec.effect === "protectSite") add.protectedSites = [hover.target];
    else if (spec.effect === "shield" && pt) add.shields = [{ spec: spec.id, lon: pt.lon, lat: pt.lat, radiusM: spec.radiusM ?? 500, delayH: spec.delayH ?? Infinity, sources: spec.sources ?? [] }];
    return ripple(coverage, plan, add);
  }, [hover, coverage, placements, cfg, spec, pt]);
  const failAt = spec.snapsTo === "shelterSite" ? coverage.flood.shelterFlood[hover.target] : Infinity;
  const simOnly = spec.effect === "rescue" || spec.effect === "medical" || (spec.effect === "shield" && spec.sources?.includes(5));
  return (
    <div className="pointer-events-none absolute right-3 top-24 z-20 w-[300px] sm:right-4">
      <Panel className="p-4">
        <div className="hud-label text-[var(--city)]">See the ripple</div>
        <div className="mt-1 font-display text-lg font-extrabold uppercase tracking-wide text-white">{pt?.label}</div>
        <div className="mt-1 font-mono text-[11px] text-dim">
          {spec.label} · {money(spec.cost)}
        </div>
        <div className="mt-3 flex flex-col gap-1.5 border-t border-white/8 pt-3 text-[13px]">
          {simOnly ? (
            <div className="text-white/85">{spec.effect === "rescue" ? "Rescue teams act once people are stuck. Their effect is scored in the simulation." : spec.effect === "medical" ? "Adds care for neighborhoods cut off from hospitals. Scored in the simulation." : "Fires start where the earthquake breaks gas lines. Scored in the simulation."}</div>
          ) : (
            <>
              <RippleLine value={r.residents} label="at-risk residents protected (est.)" />
              <RippleLine value={r.vulnerable} label="vulnerability-weighted" />
              {spec.effect === "protectRoad" && <RippleLine value={r.routesKept} label="routes to safety kept open" />}
              {spec.effect === "shield" && <RippleLine value={r.shielded} label="residents whose homes stay safe longer" />}
            </>
          )}
        </div>
        {Number.isFinite(failAt) && failAt < cfg.durationHours && (
          <div className="mt-3 flex gap-2 rounded-md border border-amber-400/30 bg-amber-400/8 p-2 text-xs text-amber-100">
            <AlertTriangle className="size-4 shrink-0" /> In the {cfg.terms.hazardArea}: expected to fail around hour {failAt.toFixed(0)}.
          </div>
        )}
      </Panel>
    </div>
  );
}

function RippleLine({ value, label }: { value: number; label: string }) {
  const v = Math.round(value);
  return (
    <div className="flex items-baseline gap-2">
      <span className={v > 0 ? "font-mono font-semibold text-emerald-300" : "font-mono text-dim"}>{v > 0 ? `+${int(v)}` : "±0"}</span>
      <span className="text-white/80">{label}</span>
    </div>
  );
}
