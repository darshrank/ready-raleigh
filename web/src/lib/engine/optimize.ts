import { ROUND, type EffectType, type InterventionSpec } from "@/config/game";
import type { AchillesScan } from "./achilles";
import { evaluatePlan, type CoverageContext, type StaticEval } from "./coverage";
import { metersBetween } from "./geo";
import { EMPTY_PLAN, type EnginePlan } from "./plan";

export { metersBetween };

export interface OptimizeStep {
  spec: string;
  effect: EffectType;
  target: number;
  lon: number;
  lat: number;
  gain: number;
}

export interface OptimizeResult {
  plan: EnginePlan;
  steps: OptimizeStep[];
  bestGainPerMillion: number;
  baseline: StaticEval;
  final: StaticEval;
}

/** Share of the isolation a protected bottleneck prevents that counts toward the objective. */
const ISOLATION_CREDIT = 0.25;

export function withAdd(plan: EnginePlan, spec: InterventionSpec, target: number, lon: number, lat: number): EnginePlan {
  const next: EnginePlan = {
    ...plan,
    shelters: [...plan.shelters],
    busStops: [...plan.busStops],
    crossings: [...plan.crossings],
    rescue: [...plan.rescue],
    shields: [...plan.shields],
    protectedSites: [...plan.protectedSites],
    medical: [...plan.medical],
    cost: plan.cost + spec.cost,
  };
  if (spec.effect === "shelter") next.shelters.push(target);
  else if (spec.effect === "pickup") next.busStops.push(target);
  else if (spec.effect === "protectRoad") next.crossings.push(target);
  else if (spec.effect === "rescue") next.rescue.push(target);
  else if (spec.effect === "protectSite") next.protectedSites.push(target);
  else if (spec.effect === "medical") next.medical.push(target);
  else next.shields.push({ spec: spec.id, lon, lat, radiusM: spec.radiusM ?? 500, delayH: spec.delayH ?? Infinity, sources: spec.sources ?? [] });
  return next;
}

interface Candidate {
  spec: InterventionSpec;
  target: number;
  lon: number;
  lat: number;
}

/** Candidate sites ranked by nearby demand, so the greedy search stays small. */
export function candidateSets(ctx: CoverageContext, achilles: AchillesScan | null) {
  const { data } = ctx;
  const cfg = data.cfg;
  const walkers = (o: (typeof data.origins)[number]) => (cfg.everyoneWalks ? 1 : data.zoneShares[o.z].snv);
  const shelterScore = data.shelters.map((s, i) => {
    if (ctx.flood.shelterFlood[i] < cfg.durationHours) return { i, v: -1 };
    let v = 0;
    for (const o of data.origins) {
      const d = metersBetween(s.lon, s.lat, o.lon, o.lat);
      const near = d < cfg.coverage.walkToShelterMeters * 1.3 ? 2 : 0;
      v += (o.pop * ((cfg.everyoneWalks ? 0 : 0.3 * (1 - walkers(o))) + walkers(o) * near)) / (1 + d / 1500);
    }
    return { i, v };
  });
  const shelters = shelterScore.filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 24).map((x) => x.i);
  const busScore = data.busStops.map((b, i) => {
    let v = 0;
    for (const o of data.origins) if (metersBetween(b.lon, b.lat, o.lon, o.lat) < cfg.coverage.busWalkMeters * 0.6) v += o.pop * walkers(o);
    return { i, v };
  });
  const busStops: number[] = [];
  for (const x of busScore.filter((x) => x.v > 0).sort((a, b) => b.v - a.v)) {
    const b = data.busStops[x.i];
    if (busStops.some((j) => metersBetween(b.lon, b.lat, data.busStops[j].lon, data.busStops[j].lat) < 400)) continue;
    busStops.push(x.i);
    if (busStops.length >= 24) break;
  }
  const crossings = achilles ? achilles.findings.slice(0, 8).map((f) => f.crossing) : [];
  const shieldScore = data.shieldPoints.map((s) => {
    let v = 0;
    for (const o of data.origins) if (metersBetween(s.lon, s.lat, o.lon, o.lat) < 800) v += o.pop;
    return { s, v };
  });
  const shields = shieldScore.filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10).map((x) => x.s);
  return { shelters, busStops, crossings, shields };
}

export function optimizePlan(ctx: CoverageContext, achilles: AchillesScan | null, budget = ROUND.budget): OptimizeResult {
  const { data } = ctx;
  const cfg = data.cfg;
  const cand = candidateSets(ctx, achilles);
  const spec = (effect: EffectType) => cfg.interventions.find((i) => i.effect === effect);
  const pool: Candidate[] = [];
  const sh = spec("shelter");
  const pk = spec("pickup");
  const pr = spec("protectRoad");
  if (sh) pool.push(...cand.shelters.map((t) => ({ spec: sh, target: t, lon: data.shelters[t].lon, lat: data.shelters[t].lat })));
  if (pk) pool.push(...cand.busStops.map((t) => ({ spec: pk, target: t, lon: data.busStops[t].lon, lat: data.busStops[t].lat })));
  if (pr) pool.push(...cand.crossings.map((t) => ({ spec: pr, target: t, lon: data.crossings[t].lon, lat: data.crossings[t].lat })));
  for (const s of cfg.interventions.filter((i) => i.effect === "shield" && i.snapsTo === "shieldPoint")) {
    pool.push(...cand.shields.filter((p) => p.kind === s.shieldKind).map((p) => ({ spec: s, target: p.id, lon: p.lon, lat: p.lat })));
  }

  // the planning estimate stops at its last reference hour, so bottlenecks that fail later are credited by the isolation they prevent
  const isolation = new Map((achilles?.findings ?? []).map((f) => [f.crossing, f.isolated * ISOLATION_CREDIT]));
  const objective = (e: StaticEval, p: EnginePlan) => e.protected + e.vulnProtected + p.crossings.reduce((s, c) => s + (isolation.get(c) ?? 0), 0);
  let plan: EnginePlan = { ...EMPTY_PLAN };
  const baseline = evaluatePlan(ctx, plan);
  let current = baseline;
  let remaining = budget;
  const steps: OptimizeStep[] = [];
  let bestGainPerMillion = 0;
  let first = true;
  const used = new Set<string>();

  while (true) {
    let best: (Candidate & { gain: number; ratio: number; ev: StaticEval; next: EnginePlan }) | null = null;
    for (const c of pool) {
      const key = `${c.spec.id}:${c.target}`;
      if (used.has(key) || c.spec.cost > remaining) continue;
      const next = withAdd(plan, c.spec, c.target, c.lon, c.lat);
      const ev = evaluatePlan(ctx, next);
      const gain = objective(ev, next) - objective(current, plan);
      const ratio = gain / c.spec.cost;
      if (first) bestGainPerMillion = Math.max(bestGainPerMillion, (ev.vulnProtected - baseline.vulnProtected) / (c.spec.cost / 1e6));
      if (!best || ratio > best.ratio) best = { ...c, gain, ratio, ev, next };
    }
    first = false;
    if (!best || best.gain <= 1) break;
    plan = best.next;
    used.add(`${best.spec.id}:${best.target}`);
    remaining -= best.spec.cost;
    current = best.ev;
    steps.push({ spec: best.spec.id, effect: best.spec.effect, target: best.target, lon: best.lon, lat: best.lat, gain: best.gain });
  }

  // leftover budget: a rescue team where staying home turns dangerous for the most people
  const rescue = spec("rescue");
  if (rescue && remaining >= rescue.cost && data.fire.length) {
    let wx = 0;
    let wy = 0;
    let w = 0;
    data.origins.forEach((o, i) => {
      if (ctx.flood.originFlood[i] < cfg.durationHours || (ctx.flood.originTrapped?.[i] ?? 0) > 0) {
        wx += o.lon * o.pop;
        wy += o.lat * o.pop;
        w += o.pop;
      }
    });
    if (w > 0) {
      const cx = wx / w;
      const cy = wy / w;
      let bestI = 0;
      let bestD = Infinity;
      data.fire.forEach((f, i) => {
        const d = metersBetween(f.lon, f.lat, cx, cy);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      });
      plan = withAdd(plan, rescue, bestI, data.fire[bestI].lon, data.fire[bestI].lat);
      steps.push({ spec: rescue.id, effect: "rescue", target: bestI, lon: data.fire[bestI].lon, lat: data.fire[bestI].lat, gain: 0 });
    }
  }
  return { plan, steps, bestGainPerMillion, baseline, final: current };
}
