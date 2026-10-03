import { specFor, type ScenarioParams } from "@/config/game";
import type { PlacedIntervention } from "@/types";

export interface ShieldPlacement {
  spec: string;
  lon: number;
  lat: number;
  radiusM: number;
  delayH: number;
  sources: number[];
}

/** Plan in engine terms: indices into the city's site lists, plus hazard shields. */
export interface EnginePlan {
  shelters: number[];
  busStops: number[];
  crossings: number[];
  rescue: number[];
  shields: ShieldPlacement[];
  protectedSites: number[];
  medical: number[];
  cost: number;
}

export const EMPTY_PLAN: EnginePlan = { shelters: [], busStops: [], crossings: [], rescue: [], shields: [], protectedSites: [], medical: [], cost: 0 };

export function toEnginePlan(placed: PlacedIntervention[], cfg: ScenarioParams): EnginePlan {
  const plan: EnginePlan = { shelters: [], busStops: [], crossings: [], rescue: [], shields: [], protectedSites: [], medical: [], cost: 0 };
  for (const p of placed) {
    const spec = specFor(cfg, p.kind);
    plan.cost += spec.cost;
    if (spec.effect === "shelter") plan.shelters.push(p.target);
    else if (spec.effect === "pickup") plan.busStops.push(p.target);
    else if (spec.effect === "protectRoad") plan.crossings.push(p.target);
    else if (spec.effect === "rescue") plan.rescue.push(p.target);
    else if (spec.effect === "protectSite") plan.protectedSites.push(p.target);
    else if (spec.effect === "medical") plan.medical.push(p.target);
    else if (spec.effect === "shield") {
      plan.shields.push({ spec: spec.id, lon: p.lon, lat: p.lat, radiusM: spec.radiusM ?? 500, delayH: spec.delayH ?? Infinity, sources: spec.sources ?? [] });
    }
  }
  return plan;
}

export function planCost(plan: EnginePlan): number {
  return plan.cost;
}

export function shieldKey(plan: Pick<EnginePlan, "shields">): string {
  return plan.shields.map((s) => `${s.spec}@${s.lon.toFixed(4)},${s.lat.toFixed(4)}`).sort().join(";");
}

export function planKey(plan: EnginePlan): string {
  const s = (a: number[]) => [...a].sort((x, y) => x - y).join(",");
  return `s:${s(plan.shelters)}|b:${s(plan.busStops)}|c:${s(plan.crossings)}|r:${s(plan.rescue)}|p:${s(plan.protectedSites)}|m:${s(plan.medical)}|h:${shieldKey(plan)}`;
}

/** Hospital nodes plus any emergency medical sites in the plan. */
export function careNodes(hospitals: { n: number }[], shelters: { n: number }[], plan: EnginePlan): number[] {
  return [...hospitals.map((h) => h.n), ...plan.medical.map((i) => shelters[i].n)];
}
