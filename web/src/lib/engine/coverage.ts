import type { CityData } from "@/lib/data/city-data";
import { closedAt, type FloodModel } from "./flood";
import type { SearchResult } from "./graph";
import { EMPTY_PLAN, shieldKey, type EnginePlan } from "./plan";
import { planHazard } from "./simulate";

/**
 * Planning-phase estimate. Uses the expected hazard (no random events, which
 * stay hidden until the simulation) at the scenario's reference hours, and
 * asks: if residents left now, could they reach safety?
 */
export interface CoverageContext {
  data: CityData;
  /** Expected hazard with no interventions. */
  flood: FloodModel;
  refHours: number[];
  cache: Map<string, unknown>;
}

export interface StaticEval {
  atRisk: number;
  vulnTotal: number;
  protected: number;
  vulnProtected: number;
  /** Protected residents attributed to each placed intervention, keyed "effect:target". */
  byIntervention: Record<string, number>;
  originShare: Float32Array;
  zoneProtected: Float64Array;
  zoneAtRisk: Float64Array;
  /** Residents whose drive to safe ground only works because of protected roads. */
  routesKept: number;
  /** Residents whose homes stay safe longer because of shields. */
  shielded: number;
}

export function createCoverageContext(data: CityData): CoverageContext {
  return { data, flood: planHazard(data, EMPTY_PLAN, null), refHours: data.cfg.refHours, cache: new Map() };
}

function memo<T>(ctx: CoverageContext, key: string, fn: () => T): T {
  if (ctx.cache.has(key)) return ctx.cache.get(key) as T;
  const v = fn();
  ctx.cache.set(key, v);
  return v;
}

const sorted = (a: number[]) => [...a].sort((x, y) => x - y).join(",");

/** The part of a plan that changes the hazard itself. */
type HazardPlan = Pick<EnginePlan, "crossings" | "shields" | "protectedSites">;
const hazardKey = (p: HazardPlan) => `${sorted(p.crossings)}|${shieldKey(p)}|${sorted(p.protectedSites)}`;

export function hazardFor(ctx: CoverageContext, p: HazardPlan): FloodModel {
  if (!p.crossings.length && !p.shields.length && !p.protectedSites.length) return ctx.flood;
  return memo(ctx, `hz|${hazardKey(p)}`, () => planHazard(ctx.data, { ...EMPTY_PLAN, ...p }, null));
}

function blockedFor(ctx: CoverageContext, p: HazardPlan, hour: number): Uint8Array {
  return memo(ctx, `blocked|${hazardKey(p)}|${hour}`, () => closedAt(hazardFor(ctx, p), hour));
}

function safeTree(ctx: CoverageContext, p: HazardPlan, hour: number): SearchResult {
  return memo(ctx, `safe|${hazardKey(p)}|${hour}`, () =>
    ctx.data.graph.search({ sources: ctx.data.safeNodes, direction: "reverse", cost: "time", blocked: blockedFor(ctx, p, hour) }),
  );
}

export function shelterDriveTree(ctx: CoverageContext, site: number, p: HazardPlan, hour: number) {
  return memo(ctx, `sdrive|${site}|${hazardKey(p)}|${hour}`, () =>
    ctx.data.graph.search({
      sources: [ctx.data.shelters[site].n],
      direction: "reverse",
      cost: "time",
      blocked: blockedFor(ctx, p, hour),
      limit: ctx.data.cfg.coverage.shelterDriveMinutes * 60,
    }),
  );
}

export function walkTree(ctx: CoverageContext, node: number, limit: number, p: HazardPlan, hour: number) {
  return memo(ctx, `walk|${node}|${limit}|${hazardKey(p)}|${hour}`, () =>
    ctx.data.graph.search({ sources: [node], direction: "walk", cost: "length", blocked: blockedFor(ctx, p, hour), limit }),
  );
}

function shelterNetworkTree(ctx: CoverageContext, plan: EnginePlan, hz: FloodModel, hour: number) {
  const open = plan.shelters.filter((s) => hz.shelterFlood[s] > hour);
  return memo(ctx, `snet|${sorted(open)}|${hazardKey(plan)}|${hour}`, () =>
    open.length
      ? ctx.data.graph.search({
          sources: open.map((s) => ctx.data.shelters[s].n),
          direction: "reverse",
          cost: "time",
          blocked: blockedFor(ctx, plan, hour),
          limit: ctx.data.cfg.coverage.busToShelterMaxMinutes * 60,
        })
      : null,
  );
}

export function evaluatePlan(ctx: CoverageContext, plan: EnginePlan): StaticEval {
  const { data } = ctx;
  const cfg = data.cfg;
  const C = cfg.coverage;
  const q = cfg.carShelterSeekingShare;
  const hz = hazardFor(ctx, plan);
  const base = ctx.flood;
  const originShare = new Float32Array(data.origins.length);
  const byIntervention: Record<string, number> = {};
  let protectedSum = 0;
  let vulnSum = 0;
  let routesKept = 0;
  let shielded = 0;
  let atRisk = 0;
  let vulnTotal = 0;
  const zoneProtected = new Float64Array(data.zones.length);
  const zoneAtRisk = new Float64Array(data.zones.length);
  for (const o of data.origins) {
    const sh = data.zoneShares[o.z];
    atRisk += o.pop;
    vulnTotal += o.pop * (sh.s65 + sh.spov + sh.snv);
    zoneAtRisk[o.z] += o.pop;
  }
  const k = ctx.refHours.length;
  const credit = (key: string, v: number) => {
    byIntervention[key] = (byIntervention[key] ?? 0) + v / k;
  };

  for (const hour of ctx.refHours) {
    const safe = cfg.everyoneWalks ? null : safeTree(ctx, plan, hour);
    const safeBase = !safe ? null : plan.crossings.length || plan.shields.length ? safeTree(ctx, { crossings: [], shields: [], protectedSites: [] }, hour) : safe;
    const shelters = plan.shelters.map((site) => ({
      site,
      open: hz.shelterFlood[site] > hour,
      left: C.shelterCapacity,
      drive: C.shelterDriveMinutes > 0 ? shelterDriveTree(ctx, site, plan, hour) : null,
      walk: walkTree(ctx, data.shelters[site].n, C.walkToShelterMeters, plan, hour),
    }));
    const net = shelterNetworkTree(ctx, plan, hz, hour);
    const stops = plan.busStops.map((stop) => ({
      stop,
      left: C.busCapacity,
      viable: cfg.everyoneWalks || (!!safe && Number.isFinite(safe.dist[data.busStops[stop].n])) || (!!net && Number.isFinite(net.dist[data.busStops[stop].n])),
      walk: walkTree(ctx, data.busStops[stop].n, C.busWalkMeters, plan, hour),
    }));
    const orderIdx = data.origins
      .map((o, i) => {
        let best = Infinity;
        for (const s of shelters) best = Math.min(best, s.drive ? s.drive.dist[o.n] : s.walk.dist[o.n]);
        return { i, best };
      })
      .sort((a, b) => a.best - b.best || a.i - b.i);

    for (const { i } of orderIdx) {
      const o = data.origins[i];
      const sh = data.zoneShares[o.z];
      const homeBad = hz.originFlood[i] <= hour;
      if (!homeBad && base.originFlood[i] <= hour) {
        shielded += o.pop / k;
        for (const s of plan.shields) credit(`shield:${s.lon.toFixed(4)},${s.lat.toFixed(4)}`, o.pop / Math.max(1, plan.shields.length));
      }
      if (homeBad) continue;
      const carPop = cfg.everyoneWalks ? o.pop * (cfg.hazard.heat?.selfCoolShare ?? 0) : o.pop * (1 - sh.snv);
      const self = carPop * (1 - q);
      let seek = carPop * q;
      let walk = cfg.everyoneWalks ? o.pop - carPop : o.pop * sh.snv;
      let prot = 0;
      let protWalk = 0;
      if (cfg.everyoneWalks) prot += self;
      else if (safe && Number.isFinite(safe.dist[o.n])) {
        prot += self;
        if (safeBase && !Number.isFinite(safeBase.dist[o.n])) routesKept += self;
      }
      for (const s of shelters.filter((s) => s.open && s.drive && s.drive.dist[o.n] <= C.shelterDriveMinutes * 60).sort((a, b) => a.drive!.dist[o.n] - b.drive!.dist[o.n])) {
        if (seek <= 0) break;
        const take = Math.min(seek, s.left);
        if (take <= 0) continue;
        s.left -= take;
        seek -= take;
        prot += take;
        credit(`shelter:${s.site}`, take);
      }
      for (const s of shelters.filter((s) => s.open && Number.isFinite(s.walk.dist[o.n])).sort((a, b) => a.walk.dist[o.n] - b.walk.dist[o.n])) {
        if (walk <= 0) break;
        const take = Math.min(walk, s.left);
        if (take <= 0) continue;
        s.left -= take;
        walk -= take;
        protWalk += take;
        credit(`shelter:${s.site}`, take);
      }
      for (const b of stops.filter((b) => b.viable && Number.isFinite(b.walk.dist[o.n])).sort((a, b) => a.walk.dist[o.n] - b.walk.dist[o.n])) {
        if (walk <= 0) break;
        const take = Math.min(walk, b.left);
        if (take <= 0) continue;
        b.left -= take;
        walk -= take;
        protWalk += take;
        credit(`pickup:${b.stop}`, take);
      }
      const total = prot + protWalk;
      protectedSum += total;
      vulnSum += total * (sh.s65 + sh.spov) + (cfg.everyoneWalks ? total * sh.snv : protWalk);
      originShare[i] += total / o.pop / k;
      zoneProtected[o.z] += total / k;
    }
  }
  if (plan.crossings.length) {
    const per = routesKept / k / plan.crossings.length;
    for (const c of plan.crossings) byIntervention[`protectRoad:${c}`] = per;
  }
  for (const s of plan.protectedSites) {
    if (plan.shelters.includes(s)) byIntervention[`protectSite:${s}`] = byIntervention[`shelter:${s}`] ?? 0;
  }
  return { atRisk, vulnTotal, protected: protectedSum / k, vulnProtected: vulnSum / k, byIntervention, originShare, zoneProtected, zoneAtRisk, routesKept: routesKept / k, shielded: shielded / k };
}

/** Marginal value of adding to a plan. */
export function ripple(ctx: CoverageContext, plan: EnginePlan, add: Partial<EnginePlan>) {
  const before = evaluatePlan(ctx, plan);
  const next: EnginePlan = {
    shelters: [...plan.shelters, ...(add.shelters ?? [])],
    busStops: [...plan.busStops, ...(add.busStops ?? [])],
    crossings: [...plan.crossings, ...(add.crossings ?? [])],
    rescue: [...plan.rescue, ...(add.rescue ?? [])],
    shields: [...plan.shields, ...(add.shields ?? [])],
    protectedSites: [...plan.protectedSites, ...(add.protectedSites ?? [])],
    medical: [...plan.medical, ...(add.medical ?? [])],
    cost: plan.cost + (add.cost ?? 0),
  };
  const after = evaluatePlan(ctx, next);
  return {
    residents: after.protected - before.protected,
    vulnerable: after.vulnProtected - before.vulnProtected,
    routesKept: after.routesKept - before.routesKept,
    shielded: after.shielded - before.shielded,
    after,
  };
}

/** Coverage field around a shelter for drawing it on the map (drive time, or walking distance when nobody drives). */
export function shelterReach(ctx: CoverageContext, site: number, plan: HazardPlan) {
  const C = ctx.data.cfg.coverage;
  if (C.shelterDriveMinutes > 0) return { tree: shelterDriveTree(ctx, site, plan, ctx.refHours[0]), limit: C.shelterDriveMinutes * 60 };
  return { tree: walkTree(ctx, ctx.data.shelters[site].n, C.walkToShelterMeters, plan, ctx.refHours[0]), limit: C.walkToShelterMeters };
}

export function busReach(ctx: CoverageContext, stop: number, plan: HazardPlan) {
  const C = ctx.data.cfg.coverage;
  return { tree: walkTree(ctx, ctx.data.busStops[stop].n, C.busWalkMeters, plan, ctx.refHours[0]), limit: C.busWalkMeters };
}

/** Origins whose drive to safe ground runs through a crossing at the second reference hour. */
export function crossingDependents(ctx: CoverageContext, plan: EnginePlan, crossing: number) {
  if (ctx.data.cfg.everyoneWalks) return [];
  const hour = ctx.refHours[ctx.refHours.length - 1];
  const without = safeTree(ctx, plan, hour);
  const withIt = safeTree(ctx, { ...plan, crossings: [...plan.crossings, crossing] }, hour);
  return ctx.data.origins.filter((o) => !Number.isFinite(without.dist[o.n]) && Number.isFinite(withIt.dist[o.n]));
}
