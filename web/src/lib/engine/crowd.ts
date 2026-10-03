import type { EffectType } from "@/config/game";
import type { CityData } from "@/lib/data/city-data";
import type { StaticEval } from "./coverage";
import { metersBetween } from "./geo";
import type { EnginePlan } from "./plan";

export type Quadrant = "consensus" | "blindspot" | "signal" | "low";

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  consensus: "Consensus priority",
  blindspot: "Data blind spot",
  signal: "Community signal",
  low: "Low priority",
};

export interface ZoneQuadrant {
  zone: number;
  crowd: number;
  model: number;
  quadrant: Quadrant;
}

export interface CrowdPlacement {
  lon: number;
  lat: number;
  weight: number;
  effect: EffectType;
  player: number;
}

const SIGMA: Record<EffectType, number> = { shelter: 1800, pickup: 900, protectRoad: 1400, rescue: 2200, shield: 900, protectSite: 900, medical: 1500 };
const HIGH = 0.3;

export function planPlacements(data: CityData, plan: EnginePlan, player: number): CrowdPlacement[] {
  return [
    ...plan.shelters.map((i) => ({ lon: data.shelters[i].lon, lat: data.shelters[i].lat, weight: 3, effect: "shelter" as const, player })),
    ...plan.busStops.map((i) => ({ lon: data.busStops[i].lon, lat: data.busStops[i].lat, weight: 1, effect: "pickup" as const, player })),
    ...plan.crossings.map((i) => ({ lon: data.crossings[i].lon, lat: data.crossings[i].lat, weight: 2, effect: "protectRoad" as const, player })),
    ...plan.rescue.map((i) => ({ lon: data.fire[i].lon, lat: data.fire[i].lat, weight: 1.5, effect: "rescue" as const, player })),
    ...plan.shields.map((s) => ({ lon: s.lon, lat: s.lat, weight: 2, effect: "shield" as const, player })),
    ...plan.protectedSites.map((i) => ({ lon: data.shelters[i].lon, lat: data.shelters[i].lat, weight: 1, effect: "protectSite" as const, player })),
    ...plan.medical.map((i) => ({ lon: data.shelters[i].lon, lat: data.shelters[i].lat, weight: 1.5, effect: "medical" as const, player })),
  ];
}

/**
 * Crowd attention: how strongly the room's placements reach each zone.
 * Model priority: vulnerability-weighted at-risk residents left unprotected
 * with no action. The four quadrants compare the two.
 */
export function crowdAnalysis(data: CityData, plans: EnginePlan[], baseline: StaticEval) {
  const placements = plans.flatMap((p, i) => planPlacements(data, p, i));
  const nZ = data.zones.length;
  const crowdRaw = new Float64Array(nZ);
  data.zones.forEach((z, zi) => {
    const perPlayer = new Float64Array(plans.length);
    for (const p of placements) {
      const d = metersBetween(p.lon, p.lat, z.lon, z.lat);
      const s = SIGMA[p.effect];
      perPlayer[p.player] = Math.max(perPlayer[p.player], Math.exp(-(d * d) / (2 * s * s)));
    }
    crowdRaw[zi] = perPlayer.reduce((a, b) => a + b, 0) / Math.max(1, plans.length);
  });
  const need = new Float64Array(nZ);
  data.origins.forEach((o, i) => {
    const sh = data.zoneShares[o.z];
    need[o.z] += (1 - baseline.originShare[i]) * o.pop * (1 + sh.s65 + sh.spov + 2 * sh.snv);
  });
  const maxNeed = Math.max(1, ...need);
  const maxCrowd = Math.max(1e-6, ...crowdRaw);
  const zones: ZoneQuadrant[] = data.zones.map((_, zi) => {
    const crowd = crowdRaw[zi] / maxCrowd;
    const model = need[zi] / maxNeed;
    const quadrant: Quadrant = crowd >= HIGH && model >= HIGH ? "consensus" : crowd < HIGH && model >= HIGH ? "blindspot" : crowd >= HIGH ? "signal" : "low";
    return { zone: zi, crowd, model, quadrant };
  });
  const gapZone = zones.filter((z) => z.model >= HIGH).sort((a, b) => b.model - b.crowd - (a.model - a.crowd))[0];
  return { zones, placements, gapZone: gapZone ?? null, need };
}
