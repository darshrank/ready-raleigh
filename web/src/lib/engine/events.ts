import type { CityData } from "@/lib/data/city-data";
import { buildFloodModel, closedAt, SRC, type HazardRuntime } from "./flood";
import { metersBetween } from "./geo";
import { createRng, type Rng } from "./rng";
import { treeUsage } from "./usage";

export interface ResolvedEvents {
  seed: number;
  culvert: { crossing: number; hour: number } | null;
  creekSurge: { sid: number; hours: number; hour: number } | null;
  surgeEarly: { hours: number; hour: number } | null;
  blackout: { zones: number[]; hour: number } | null;
  ignitions: number[];
  aftershock: { hour: number } | null;
}

const NONE: Omit<ResolvedEvents, "seed"> = { culvert: null, creekSurge: null, surgeEarly: null, blackout: null, ignitions: [], aftershock: null };

/**
 * Seeded random events, resolved before planning so every plan in a room
 * faces the same disaster. Planning estimates never see them.
 */
export function resolveEvents(data: CityData, seed: number): ResolvedEvents {
  const rng = createRng(seed);
  const type = data.cfg.hazard.type;
  if (type === "flood" || type === "coastal") return { seed, ...NONE, ...waterEvents(data, rng, type) };
  if (type === "heat") return { seed, ...NONE, blackout: blackoutEvent(data, rng) };
  return { seed, ...NONE, ...quakeEvents(data, rng) };
}

function waterEvents(data: CityData, rng: Rng, type: "flood" | "coastal") {
  const { graph, cfg } = data;
  // one creek or canal rises early: the one with the most at-risk residents among the top three
  const popByFeature = new Map<number, number>();
  for (const o of data.origins) if (o.fsid >= 0) popByFeature.set(o.fsid, (popByFeature.get(o.fsid) ?? 0) + o.pop);
  const top = [...popByFeature.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const creekSurge = top.length ? { sid: rng.pick(top)[0], hours: 2, hour: cfg.orderHour + 1 } : null;
  const surgeEarly = type === "coastal" ? { hours: 1.5, hour: cfg.orderHour + 4 } : null;

  // a crossing outside the mapped hazard fails, chosen among the five that carry the most evacuees
  const hour = Math.round(rng.range(cfg.refHours[0] + 2.5, cfg.refHours[1] + 1.5) * 2) / 2;
  const rt: HazardRuntime = {
    streamBoost: creekSurge ? new Map([[creekSurge.sid, creekSurge.hours]]) : undefined,
    sourceShift: surgeEarly ? new Map([[SRC.surge, surgeEarly.hours]]) : undefined,
  };
  const flood = buildFloodModel(data, rt);
  const blocked = closedAt(flood, hour);
  const tree = graph.search({ sources: data.safeNodes, direction: "reverse", cost: "time", blocked });
  const usage = treeUsage(graph, tree, data.origins.map((o) => ({ node: o.n, w: o.pop })));
  const ranked = data.crossings
    .filter((c) => c.kind === "culvert" && c.edges.every((e) => !blocked[e]))
    .map((c) => ({ c, u: Math.max(...c.edges.map((e) => usage[e])) }))
    .filter((x) => x.u > 0)
    .sort((a, b) => b.u - a.u)
    .slice(0, 5);
  const culvert = ranked.length ? { crossing: rng.pick(ranked).c.id, hour } : null;
  return { creekSurge, surgeEarly, culvert };
}

/** A grid failure knocks out a contiguous cluster of the densest hot neighborhoods. */
function blackoutEvent(data: CityData, rng: Rng) {
  const h = data.cfg.hazard.heat!;
  const hourLo = h.blackoutWindow[0];
  const hourHi = h.blackoutWindow[1];
  const ranked = data.zones
    .map((z) => ({ z, score: z.atRisk / Math.max(0.2, z.areaKm2) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (!ranked.length) return null;
  const seed = rng.pick(ranked).z;
  const zones = [...data.zones]
    .sort((a, b) => metersBetween(a.lon, a.lat, seed.lon, seed.lat) - metersBetween(b.lon, b.lat, seed.lon, seed.lat))
    .slice(0, h.blackoutZones)
    .map((z) => z.id);
  return { zones, hour: Math.round(rng.range(hourLo, hourHi) * 4) / 4 };
}

/** Fires start in the most fuel-dense blocks, kept apart; an aftershock follows hours later. */
function quakeEvents(data: CityData, rng: Rng) {
  const q = data.cfg.hazard.quake!;
  const { cells } = data;
  const fuelCells: number[] = [];
  for (let i = 0; i < cells.h3.length; i++) if (cells.b[i] >= 70) fuelCells.push(i);
  const ignitions: number[] = [];
  for (let tries = 0; tries < 200 && ignitions.length < q.fire.ignitions && fuelCells.length; tries++) {
    const c = rng.pick(fuelCells);
    if (ignitions.some((o) => metersBetween(cells.lon[o], cells.lat[o], cells.lon[c], cells.lat[c]) < 1800)) continue;
    ignitions.push(c);
  }
  const aftershock = { hour: Math.round(rng.range(q.aftershockWindow[0], q.aftershockWindow[1]) * 2) / 2 };
  return { ignitions, aftershock };
}

/** Hazard runtime that applies the round's events. */
export function eventRuntime(data: CityData, events: ResolvedEvents): HazardRuntime {
  const extraClosures = new Map<number, number>();
  if (events.culvert) for (const e of data.crossings[events.culvert.crossing].edges) extraClosures.set(e, events.culvert.hour);
  return {
    extraClosures,
    streamBoost: events.creekSurge ? new Map([[events.creekSurge.sid, events.creekSurge.hours]]) : undefined,
    sourceShift: events.surgeEarly ? new Map([[SRC.surge, events.surgeEarly.hours]]) : undefined,
    blackout: events.blackout,
    ignitions: events.ignitions,
    aftershock: events.aftershock ? { hour: events.aftershock.hour, seed: events.seed } : null,
  };
}
