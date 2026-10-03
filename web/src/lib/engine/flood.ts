import { gridDisk } from "h3-js";
import type { ScenarioParams } from "@/config/game";
import type { CityData } from "@/lib/data/city-data";
import { MinHeap } from "./heap";
import type { ShieldPlacement } from "./plan";

/** Hazard source ids shared with the data prep. */
export const SRC = { riverine: 0, surge: 1, rain: 2, canal: 3, heat: 4, fire: 5 } as const;

export interface HazardRuntime {
  /** Hours earlier that water arrives, per feature id (creek or canal). */
  streamBoost?: Map<number, number>;
  /** Hours earlier for every cell of a source (surge arriving early). */
  sourceShift?: Map<number, number>;
  /** Edges that never close (protected crossings). */
  protectedEdges?: Set<number>;
  /** Extra closures from events: edge -> hour. */
  extraClosures?: Map<number, number>;
  shields?: ShieldPlacement[];
  /** Shelter-site indices that keep running whatever happens (generators). */
  protectedSites?: Set<number>;
  blackout?: { zones: number[]; hour: number } | null;
  ignitions?: number[];
  /** Quake aftershock: extra closures among exposed edges, seeded. */
  aftershock?: { hour: number; seed: number } | null;
}

export interface FloodModel {
  /** Hour each hazard cell is hit (flood water, heat danger, or liquefaction damage). */
  cellArrival: Float32Array;
  /** Quake only: hour each cell burns. */
  cellFire: Float32Array | null;
  /** Hour each road edge closes, Infinity if never. */
  edgeClose: Float32Array;
  /** Hour staying home becomes dangerous at each at-risk origin, Infinity if never. */
  originFlood: Float32Array;
  /** Hour each shelter site stops working, Infinity if never. */
  shelterFlood: Float32Array;
  /** Quake: share of each origin's residents trapped by damage. */
  originTrapped: Float32Array | null;
  closureTimes: number[];
}

const M_PER_DEG = 111_320;

function shieldDelay(shields: ShieldPlacement[] | undefined, lon: number, lat: number, src: number): number {
  if (!shields?.length) return 0;
  let delay = 0;
  const kx = Math.cos((lat * Math.PI) / 180) * M_PER_DEG;
  for (const s of shields) {
    if (!s.sources.includes(src)) continue;
    const d = Math.hypot((lon - s.lon) * kx, (lat - s.lat) * M_PER_DEG);
    if (d <= s.radiusM) delay = Math.max(delay, s.delayH);
  }
  return delay;
}

export function floodArrival(cfg: ScenarioParams, cls: number, dist: number, sid: number, src: number, rt?: HazardRuntime): number {
  if (cls < 1 || cls > 3) return Infinity;
  const timing = cfg.hazard.sources[src] ?? cfg.hazard.sources[0];
  if (!timing) return Infinity;
  const c = cls as 1 | 2 | 3;
  const t = timing.t0[c] + dist / timing.spread[c] - (rt?.streamBoost?.get(sid) ?? 0) - (rt?.sourceShift?.get(src) ?? 0);
  return Math.max(0.5, t);
}

function hashUnit(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Fire spread over the H3 cell grid from seeded ignition cells. Fuel slows or stops it. */
function spreadFire(data: CityData, ignitions: number[], rt: HazardRuntime): Float32Array {
  const q = data.cfg.hazard.quake!;
  const { cells } = data;
  const n = cells.h3.length;
  const arrive = new Float32Array(n).fill(Infinity);
  const heap = new MinHeap(1024);
  const blocked = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (cells.b[i] / 100 < q.fire.minFuel || shieldDelay(rt.shields, cells.lon[i], cells.lat[i], 5) === Infinity) blocked[i] = 1;
  }
  for (const c of ignitions) {
    if (c < 0 || c >= n) continue;
    arrive[c] = q.fire.startHour;
    heap.push(q.fire.startHour, c);
  }
  const cellMeters = data.meta.h3Res >= 11 ? 50 : 130;
  while (heap.size) {
    const u = heap.pop();
    const tu = heap.lastKey;
    if (tu > arrive[u] || tu > q.fire.startHour + q.fire.maxHours) continue;
    for (const h of gridDisk(cells.h3[u], 1)) {
      const v = cells.index.get(h);
      if (v === undefined || v === u || blocked[v]) continue;
      const fuel = Math.max(0.05, cells.b[v] / 100);
      const tv = tu + cellMeters / (q.fire.spreadMph * fuel);
      if (tv < arrive[v]) {
        arrive[v] = tv;
        heap.push(tv, v);
      }
    }
  }
  return arrive;
}

export function buildFloodModel(data: CityData, rt: HazardRuntime = {}): FloodModel {
  const { cells, graph, origins, shelters, cfg } = data;
  const H = cfg.hazard;
  const nc = cells.h3.length;
  const cellArrival = new Float32Array(nc).fill(Infinity);
  const edgeClose = new Float32Array(graph.m).fill(Infinity);
  const originFlood = new Float32Array(origins.length).fill(Infinity);
  const shelterFlood = new Float32Array(shelters.length).fill(Infinity);
  let cellFire: Float32Array | null = null;
  let originTrapped: Float32Array | null = null;
  const protectedSites = rt.protectedSites ?? new Set<number>();

  if (H.type === "flood" || H.type === "coastal") {
    for (let i = 0; i < nc; i++) {
      const src = cells.src[i];
      cellArrival[i] = floodArrival(cfg, cells.cls[i], cells.dist[i], cells.sid[i], src, rt) + shieldDelay(rt.shields, cells.lon[i], cells.lat[i], src);
    }
    for (let e = 0; e < graph.m; e++) {
      const c = graph.fcls[e];
      if (!c) continue;
      if (c === 3 && graph.fshare[e] < H.fringeRoadShare) continue;
      const freeboard = H.roadFreeboardHours[graph.cls[e]] ?? 0;
      if (!Number.isFinite(freeboard)) continue;
      const src = graph.fsrc[e];
      const [lon, lat] = graph.edgeMid(e);
      edgeClose[e] = floodArrival(cfg, c, graph.fdist[e], graph.fsid[e], src, rt) + H.closeDelayHours[c as 1 | 2 | 3] + freeboard + shieldDelay(rt.shields, lon, lat, src);
    }
    origins.forEach((o, i) => {
      const src = o.fsrc ?? 0;
      originFlood[i] = floodArrival(cfg, o.fcls, o.fdist, o.fsid, src, rt) + shieldDelay(rt.shields, o.lon, o.lat, src);
    });
    shelters.forEach((s, i) => {
      if (protectedSites.has(i)) return;
      const src = s.fsrc ?? 0;
      shelterFlood[i] = floodArrival(cfg, s.fcls, s.fdist, -1, src, rt) + shieldDelay(rt.shields, s.lon, s.lat, src);
    });
  } else if (H.type === "heat") {
    const p = H.heat!;
    const blackout = rt.blackout;
    const outZones = new Set(blackout?.zones ?? []);
    const danger = (heat: number, zone: number, lon: number, lat: number) => {
      let t = heat >= 0.4 ? p.dangerStart + (1 - heat) * p.dangerSpan : Infinity;
      if (blackout && outZones.has(zone) && heat >= 0.3) t = Math.min(t, blackout.hour + p.blackoutDangerDelay);
      return t + shieldDelay(rt.shields, lon, lat, 4);
    };
    for (let i = 0; i < nc; i++) cellArrival[i] = danger(cells.v[i] / 1000, cells.zone[i], cells.lon[i], cells.lat[i]);
    origins.forEach((o, i) => {
      originFlood[i] = danger((o.fv ?? 500) / 1000, o.z, o.lon, o.lat);
    });
    shelters.forEach((s, i) => {
      if (!blackout || protectedSites.has(i)) return;
      const z = s.cell !== undefined && s.cell >= 0 ? cells.zone[s.cell] : -1;
      if (outZones.has(z)) shelterFlood[i] = blackout.hour;
    });
  } else if (H.type === "quake") {
    const q = H.quake!;
    const fire = spreadFire(data, rt.ignitions ?? [], rt);
    cellFire = fire;
    for (let i = 0; i < nc; i++) {
      if (cells.cls[i] && shieldDelay(rt.shields, cells.lon[i], cells.lat[i], 1) !== Infinity) cellArrival[i] = q.damageHour;
    }
    for (let e = 0; e < graph.m; e++) {
      const c = graph.fcls[e];
      const [lon, lat] = graph.edgeMid(e);
      const retrofit = shieldDelay(rt.shields, lon, lat, 1) === Infinity;
      let t = Infinity;
      // damage is fixed per segment (not per seed) so planners can see which roads are expected to fail
      const damaged = (c === 1 && graph.cls[e] >= 1 && hashUnit(e, 7919) < q.highDamageShare) || (c >= 1 && graph.bridge[e] === 1);
      if (!retrofit && damaged) t = q.damageHour + H.closeDelayHours[1];
      if (!retrofit && rt.aftershock && c === 2 && hashUnit(e, rt.aftershock.seed) < q.aftershockCloseShare) t = Math.min(t, rt.aftershock.hour);
      const fc = graph.fcell[e];
      if (fc >= 0 && fire[fc] < Infinity) t = Math.min(t, fire[fc] + 0.1);
      edgeClose[e] = t;
    }
    originTrapped = new Float32Array(origins.length);
    origins.forEach((o, i) => {
      const fc = o.cell ?? -1;
      originFlood[i] = fc >= 0 ? fire[fc] : Infinity;
      const retrofit = shieldDelay(rt.shields, o.lon, o.lat, 1) === Infinity;
      if (!retrofit && (o.fcls === 1 || o.fcls === 2)) originTrapped![i] = q.trappedShare[o.fcls as 1 | 2];
    });
    shelters.forEach((s, i) => {
      if (protectedSites.has(i)) return;
      const retrofit = shieldDelay(rt.shields, s.lon, s.lat, 1) === Infinity;
      let t = Infinity;
      if (!retrofit && s.fcls === 1) t = q.damageHour;
      const fc = s.cell ?? -1;
      if (fc >= 0 && fire[fc] < Infinity) t = Math.min(t, fire[fc]);
      shelterFlood[i] = t;
    });
  }

  if (rt.extraClosures) for (const [e, h] of rt.extraClosures) edgeClose[e] = Math.min(edgeClose[e], h);
  if (rt.protectedEdges) for (const e of rt.protectedEdges) edgeClose[e] = Infinity;

  const set = new Set<number>();
  for (let e = 0; e < graph.m; e++) if (Number.isFinite(edgeClose[e])) set.add(Math.round(edgeClose[e] * 60) / 60);
  return { cellArrival, cellFire, edgeClose, originFlood, shelterFlood, originTrapped, closureTimes: [...set].sort((a, b) => a - b) };
}

/** Blocked-edge mask for a given hour. */
export function closedAt(model: FloodModel, hour: number, out?: Uint8Array): Uint8Array {
  const n = model.edgeClose.length;
  const mask = out ?? new Uint8Array(n);
  for (let e = 0; e < n; e++) mask[e] = model.edgeClose[e] <= hour ? 1 : 0;
  return mask;
}
