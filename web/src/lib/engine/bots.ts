import { ROUND, type InterventionSpec } from "@/config/game";
import type { CityData } from "@/lib/data/city-data";
import type { FloodModel } from "./flood";
import { metersBetween } from "./geo";
import { withAdd } from "./optimize";
import { EMPTY_PLAN, type EnginePlan } from "./plan";
import { createRng } from "./rng";

export interface BotPlayer {
  id: string;
  name: string;
  style: string;
  plan: EnginePlan;
}

type Pick = { lon: number; lat: number; target: number };

function nearest<T extends { lon: number; lat: number }>(items: T[], lon: number, lat: number, ok: (t: T, i: number) => boolean = () => true): number {
  let best = -1;
  let bestD = Infinity;
  items.forEach((t, i) => {
    if (!ok(t, i)) return;
    const d = metersBetween(t.lon, t.lat, lon, lat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * Simulated room players with simple, human-like strategies. They stand in
 * for real players until multiplayer rooms run on the backend, and are
 * always labelled as simulated.
 */
export function makeBots(data: CityData, flood: FloodModel, seed: number, center: [number, number]): BotPlayer[] {
  const rng = createRng(seed ^ 0xb07);
  const cfg = data.cfg;
  const spec = (effect: InterventionSpec["effect"]) => cfg.interventions.find((i) => i.effect === effect);
  const safe = (_: unknown, i: number) => flood.shelterFlood[i] > cfg.durationHours;
  const bigOrigins = [...data.origins].sort((a, b) => b.pop - a.pop);
  const majorCrossings = data.crossings.filter((c) => c.cls >= 2 && c.cls <= 3);

  const build = (picks: [InterventionSpec | undefined, Pick | null][]): EnginePlan => {
    let plan: EnginePlan = { ...EMPTY_PLAN };
    for (const [s, p] of picks) {
      if (!s || !p || p.target < 0 || plan.cost + s.cost > ROUND.budget) continue;
      plan = withAdd(plan, s, p.target, p.lon, p.lat);
    }
    return plan;
  };
  const site = (i: number): Pick | null => (i >= 0 ? { target: i, lon: data.shelters[i].lon, lat: data.shelters[i].lat } : null);
  const stop = (i: number): Pick | null => (i >= 0 ? { target: i, lon: data.busStops[i].lon, lat: data.busStops[i].lat } : null);
  const crossing = (c: (typeof data.crossings)[number] | undefined): Pick | null => (c ? { target: c.id, lon: c.lon, lat: c.lat } : null);
  const station = (i: number): Pick | null => (i >= 0 ? { target: i, lon: data.fire[i].lon, lat: data.fire[i].lat } : null);

  const s1 = nearest(data.shelters, ...center, safe);
  const s2 = nearest(data.shelters, ...center, (t, i) => safe(t, i) && i !== s1);
  const downtown = build([
    [spec("shelter"), site(s1)],
    [spec("shelter"), site(s2)],
    [spec("pickup"), stop(nearest(data.busStops, ...center))],
    [spec("protectRoad"), crossing(majorCrossings.length ? majorCrossings[nearest(majorCrossings, ...center)] : undefined)],
    [spec("medical"), site(nearest(data.shelters, ...center, (t, i) => i !== s1 && i !== s2))],
  ]);

  const w1 = bigOrigins[0] ? nearest(data.shelters, bigOrigins[0].lon, bigOrigins[0].lat) : -1;
  const w2 = bigOrigins[1] ? nearest(data.shelters, bigOrigins[1].lon, bigOrigins[1].lat, (_, i) => i !== w1) : -1;
  const water = build([
    [spec("shelter"), site(w1)],
    [spec("shelter"), site(w2)],
    [spec("protectRoad"), crossing([...majorCrossings].sort((a, b) => b.len - a.len)[0])],
    [spec("pickup"), bigOrigins[0] ? stop(nearest(data.busStops, bigOrigins[0].lon, bigOrigins[0].lat)) : null],
    [spec("rescue"), bigOrigins[0] ? station(nearest(data.fire, bigOrigins[0].lon, bigOrigins[0].lat)) : null],
  ]);

  const big = (t: (typeof data.shelters)[number], i: number) => (t.kind === "college" || t.kind === "sports" || t.kind === "library") && safe(t, i);
  const v1 = nearest(data.shelters, ...center, big);
  const v2 = nearest(data.shelters, center[0] - 0.05, center[1] + 0.02, (t, i) => big(t, i) && i !== v1);
  const venues = build([
    [spec("shelter"), site(v1)],
    [spec("shelter"), site(v2)],
    [spec("rescue"), station(nearest(data.fire, ...center))],
    [spec("protectSite"), site(v1)],
    [spec("pickup"), stop(nearest(data.busStops, center[0] + 0.02, center[1]))],
  ]);

  const stopsNear = [...data.busStops].map((b, i) => ({ i, d: metersBetween(b.lon, b.lat, ...center) })).sort((a, b) => a.d - b.d);
  const transitPicks: [InterventionSpec | undefined, Pick | null][] = [[spec("shelter"), site(s1)]];
  const chosen: number[] = [];
  for (const s of stopsNear) {
    if (chosen.length >= 7) break;
    const b = data.busStops[s.i];
    if (chosen.some((j) => metersBetween(b.lon, b.lat, data.busStops[j].lon, data.busStops[j].lat) < 700)) continue;
    chosen.push(s.i);
    transitPicks.push([spec("pickup") ?? spec("shelter"), spec("pickup") ? stop(s.i) : site(nearest(data.shelters, b.lon, b.lat))]);
  }
  const transit = build(transitPicks);

  const gutPicks: [InterventionSpec | undefined, Pick | null][] = [];
  for (let tries = 0; tries < 40; tries++) {
    const s = rng.pick(cfg.interventions);
    let p: Pick | null = null;
    if (s.snapsTo === "shelterSite") p = site(rng.int(0, data.shelters.length - 1));
    else if (s.snapsTo === "busStop" && data.busStops.length) p = stop(rng.int(0, data.busStops.length - 1));
    else if (s.snapsTo === "crossing" && majorCrossings.length) p = crossing(rng.pick(majorCrossings));
    else if (s.snapsTo === "fireStation" && data.fire.length) p = station(rng.int(0, data.fire.length - 1));
    else if (s.snapsTo === "shieldPoint") {
      const pts = data.shieldPoints.filter((x) => x.kind === s.shieldKind);
      if (pts.length) {
        const x = rng.pick(pts);
        p = { target: x.id, lon: x.lon, lat: x.lat };
      }
    } else if (s.snapsTo === "zone") {
      const z = rng.pick(data.zones);
      p = { target: z.id, lon: z.lon, lat: z.lat };
    }
    gutPicks.push([s, p]);
  }
  const gut = build(gutPicks);

  return [
    { id: "bot-downtown", name: "Unit Kestrel", style: "Protects downtown first", plan: downtown },
    { id: "bot-water", name: "Unit Heron", style: "Follows the hazard", plan: water },
    { id: "bot-venues", name: "Unit Granite", style: "Big, familiar venues", plan: venues },
    { id: "bot-transit", name: "Unit Transit", style: "Transit along core corridors", plan: transit },
    { id: "bot-gut", name: "Unit Wildcard", style: "Goes with gut instinct", plan: gut },
  ];
}
