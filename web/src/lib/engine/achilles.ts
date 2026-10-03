import type { CityData } from "@/lib/data/city-data";
import { closedAt, type FloodModel } from "./flood";
import { metersBetween } from "./geo";
import { treeUsage } from "./usage";

export interface AchillesFinding {
  crossing: number;
  dependents: number;
  isolated: number;
  addedMinutes: number;
  zones: { zone: number; residents: number }[];
  closesAt: number;
}

export interface CoolingGap {
  zone: number;
  residents: number;
  stop: number | null;
}

export interface AchillesScan {
  mode: "network" | "cooling";
  hour: number;
  segmentsAnalyzed: number;
  crossingsTested: number;
  findings: AchillesFinding[];
  gaps: CoolingGap[];
}

/**
 * Network bottleneck scan. Residents (all neighbourhoods plus at-risk
 * clusters) follow their fastest route to a hospital or safe ground on the
 * expected hazard network. Crossings carrying the most people are removed one
 * at a time to measure who loses access within 30 minutes. In a heatwave the
 * roads stay open, so the scan looks for cooling deserts instead.
 */
export function scanAchilles(data: CityData, flood: FloodModel, protectedCrossings: number[], hourOverride?: number): AchillesScan {
  const { graph, cfg } = data;
  const hour = hourOverride ?? cfg.refHours[cfg.refHours.length - 1];
  if (cfg.hazard.type === "heat") return { mode: "cooling", hour, segmentsAnalyzed: graph.m, crossingsTested: data.shelters.length, findings: [], gaps: coolingGaps(data) };

  const blocked = closedAt(flood, hour);
  const prot = new Set(protectedCrossings);
  for (const c of protectedCrossings) for (const e of data.crossings[c].edges) blocked[e] = 0;
  const sources = [...data.hospitals.map((h) => h.n), ...data.safeNodes];
  const base = graph.search({ sources, direction: "reverse", cost: "time", blocked });
  const weights = [
    ...data.anchors.map((a) => ({ node: a.n, w: a.pop, z: a.z })),
    ...data.origins.map((o) => ({ node: o.n, w: o.pop * 0.5, z: o.z })),
  ];
  const usage = treeUsage(graph, base, weights);
  const limit = cfg.coverage.hospitalAccessMinutes * 60;

  const candidates = data.crossings
    .filter((c) => c.cls >= 2 && !prot.has(c.id) && c.edges.every((e) => !blocked[e]))
    .map((c) => ({ c, u: Math.max(...c.edges.map((e) => usage[e])) }))
    .filter((x) => x.u > 0)
    .sort((a, b) => b.u - a.u)
    .slice(0, 32);

  const findings: AchillesFinding[] = candidates.map(({ c, u }) => {
    const mask = blocked.slice();
    for (const e of c.edges) mask[e] = 1;
    const tree = graph.search({ sources, direction: "reverse", cost: "time", blocked: mask });
    let isolated = 0;
    let added = 0;
    let affected = 0;
    const zoneHit = new Map<number, number>();
    for (const { node, w, z } of weights) {
      const d0 = base.dist[node];
      const d1 = tree.dist[node];
      if (!(d1 > d0 + 1)) continue;
      if (d0 <= limit && d1 > limit) isolated += w;
      added += w * (Number.isFinite(d1) ? d1 - d0 : limit);
      affected += w;
      zoneHit.set(z, (zoneHit.get(z) ?? 0) + w);
    }
    return {
      crossing: c.id,
      dependents: Math.round(u),
      isolated: Math.round(isolated),
      addedMinutes: affected > 0 ? added / affected / 60 : 0,
      zones: [...zoneHit.entries()].map(([zone, residents]) => ({ zone, residents: Math.round(residents) })).sort((a, b) => b.residents - a.residents).slice(0, 5),
      closesAt: Math.min(...c.edges.map((e) => flood.edgeClose[e])),
    };
  });
  findings.sort((a, b) => b.isolated - a.isolated || b.dependents * b.addedMinutes - a.dependents * a.addedMinutes);
  return { mode: "network", hour, segmentsAnalyzed: graph.m, crossingsTested: data.crossings.length, findings: findings.slice(0, 10), gaps: [] };
}

/** Minutes of walking, at an older adult's pace, beyond which a cooling site no longer counts as close. */
export const COOLING_WALK_MINUTES = 10;

/** Neighborhoods whose heat-vulnerable residents have no possible cooling site within a short walk. */
function coolingGaps(data: CityData): CoolingGap[] {
  const C = data.cfg.coverage;
  const limit = Math.min(C.walkToShelterMeters, C.walkSpeedMps * COOLING_WALK_MINUTES * 60);
  const reach = data.graph.search({ sources: data.shelters.map((s) => s.n), direction: "walk", cost: "length", limit });
  const uncovered = new Map<number, { pop: number; best: { lon: number; lat: number; pop: number } | null }>();
  for (const o of data.origins) {
    if (Number.isFinite(reach.dist[o.n])) continue;
    const z = uncovered.get(o.z) ?? { pop: 0, best: null };
    z.pop += o.pop;
    if (!z.best || o.pop > z.best.pop) z.best = { lon: o.lon, lat: o.lat, pop: o.pop };
    uncovered.set(o.z, z);
  }
  return [...uncovered.entries()]
    .sort((a, b) => b[1].pop - a[1].pop)
    .slice(0, 6)
    .map(([zone, v]) => {
      let stop: number | null = null;
      let bestD = Infinity;
      if (v.best) {
        data.busStops.forEach((b, i) => {
          const d = metersBetween(b.lon, b.lat, v.best!.lon, v.best!.lat);
          if (d < bestD) {
            bestD = d;
            stop = i;
          }
        });
      }
      return { zone, residents: Math.round(v.pop), stop };
    });
}
