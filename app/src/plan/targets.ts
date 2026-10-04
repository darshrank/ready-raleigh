// Snapping: which site, cell or flood road a pointer (or the keyboard cursor) means.
// All distances are in screen pixels, so snapping feels the same at every zoom.
import type { Map as MapLibreMap } from 'maplibre-gl';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { engineIndex } from '@shared/engine';
import type { FloodRoad, Placement } from '@shared/types';
import type { MapData } from '../data';
import type { FloodPiece } from './pieces';
import type { Target } from './store';

type LngLat = [number, number];
type Px = { x: number; y: number };

const RES = 9;

/** How far a tap may land from a site or road and still snap to it. Fingers get more room. */
export const SNAP_PX = {
  mouse: { site: 36, road: 16 },
  touch: { site: 48, road: 26 },
  /** Keyboard: the cursor cell's center picks the nearest site or road within this distance. */
  key: { site: 160, road: 90 },
};
export type SnapKind = keyof typeof SNAP_PX;

const centersCache = new WeakMap<MapData, Float64Array>();

/** [lon, lat] of every cell center, flat. Built once per bundle. */
export function cellCenters(data: MapData): Float64Array {
  let out = centersCache.get(data);
  if (!out) {
    out = new Float64Array(data.cells.length * 2);
    data.cells.forEach((c, i) => {
      const [lat, lon] = cellToLatLng(c.h3);
      out![2 * i] = lon;
      out![2 * i + 1] = lat;
    });
    centersCache.set(data, out);
  }
  return out;
}

export const cellCenter = (data: MapData, i: number): LngLat => {
  const c = cellCenters(data);
  return [c[2 * i]!, c[2 * i + 1]!];
};

/** The bundle cell containing a point, or undefined outside the study area. */
export function cellAt(data: MapData, [lon, lat]: LngLat): number | undefined {
  return engineIndex(data).cellOfH3(latLngToCell(lat, lon, RES));
}

/** The bundle cell nearest a point (for starting the keyboard cursor anywhere). */
export function nearestCell(data: MapData, p: LngLat): number {
  const inside = cellAt(data, p);
  if (inside !== undefined) return inside;
  const c = cellCenters(data);
  const k = Math.cos((p[1] * Math.PI) / 180);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < data.cells.length; i++) {
    const d = ((c[2 * i]! - p[0]) * k) ** 2 + (c[2 * i + 1]! - p[1]) ** 2;
    if (d < bestD) [best, bestD] = [i, d];
  }
  return best;
}

/** Center spacing of res 9 cells in degrees of latitude (about 300 m). */
const STEP_DEG = 0.0027;

/**
 * The cell about `px` screen pixels from `i` in a screen direction, at least one cell away, so
 * one key press moves the cursor a visible distance at any zoom. Gaps in the study area are skipped.
 */
export function stepCell(map: MapLibreMap, data: MapData, i: number, dx: number, dy: number, px = 24): number {
  const [lon, lat] = cellCenter(data, i);
  const k = Math.cos((lat * Math.PI) / 180);
  const a = map.project([lon, lat]);
  const b = map.project([lon, lat + STEP_DEG]);
  const cells = Math.max(1, Math.round(px / Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y))));
  for (let mult = cells; mult <= cells + 3; mult++) {
    const j = cellAt(data, [lon + (dx * STEP_DEG * mult) / k, lat - dy * STEP_DEG * mult]);
    if (j !== undefined && j !== i) return j;
  }
  return i;
}

function distToSegment(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Existing bus stops where a pickup helps (in a bus cell), built once per bundle. */
const busStopsCache = new WeakMap<MapData, { id: string; cell: number; lon: number; lat: number }[]>();
export function busStops(data: MapData) {
  let out = busStopsCache.get(data);
  if (!out) {
    const idx = engineIndex(data);
    out = [...idx.stops.values()].filter(({ cell }) => idx.busOk[cell]).map(({ stop, cell }) => ({ id: stop.id, cell, lon: stop.lon, lat: stop.lat }));
    busStopsCache.set(data, out);
  }
  return out;
}

/** Usable candidate sites: a shelter in a building that floods helps no one, so it is not offered. */
const usableCache = new WeakMap<MapData, MapData['sites']>();
export const usableSites = (data: MapData) => {
  let out = usableCache.get(data);
  if (!out) usableCache.set(data, (out = data.sites.filter((s) => s.floodStep === null || s.floodStep > 3)));
  return out;
};

/**
 * The target for `piece` at screen point `p`. Shelters snap to the nearest usable site, roads to
 * the nearest flood road. Bus pickups snap to an existing bus stop nearby (cheaper), else take the
 * cell under the point if a bus helps there. Sites, stops and roads that already hold a piece are
 * skipped, except the one held by `movingId` (a piece may be dropped back in place).
 */
export function targetAt(
  piece: FloodPiece,
  map: MapLibreMap,
  data: MapData,
  p: Px,
  placements: Placement[],
  snap: SnapKind,
  movingId: string | null = null,
): Target | null {
  const others = placements.filter((q) => q.id !== movingId);
  if (piece === 'bus_pickup') {
    const taken = new Set(others.map((q) => q.stopId).filter(Boolean));
    let stop: ReturnType<typeof busStops>[number] | null = null;
    let bestD = SNAP_PX[snap].site * 0.6;
    for (const s of busStops(data)) {
      if (taken.has(s.id)) continue;
      const q = map.project([s.lon, s.lat]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) [stop, bestD] = [s, d];
    }
    if (stop) return { type: 'bus_pickup', cell: stop.cell, stopId: stop.id };
    const ll = map.unproject([p.x, p.y]);
    const cell = cellAt(data, [ll.lng, ll.lat]);
    return cell === undefined || !engineIndex(data).busOk[cell] ? null : { type: 'bus_pickup', cell };
  }
  if (piece === 'shelter') {
    const taken = new Set(others.filter((q) => q.type === 'shelter').map((q) => q.siteId));
    let best: string | null = null;
    let bestD = SNAP_PX[snap].site;
    for (const s of usableSites(data)) {
      if (taken.has(s.id)) continue;
      const q = map.project([s.lon, s.lat]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) [best, bestD] = [s.id, d];
    }
    return best === null ? null : { type: 'shelter', siteId: best };
  }
  const taken = new Set(others.filter((q) => q.type === 'road_protection').map((q) => q.roadId));
  let best: string | null = null;
  let bestD = SNAP_PX[snap].road;
  for (const r of data.floodRoads) {
    if (taken.has(r.id)) continue;
    const pts = r.coords.map((c) => map.project(c));
    for (let k = 0; k + 1 < pts.length; k++) {
      const d = distToSegment(p, pts[k]!, pts[k + 1]!);
      if (d < bestD) [best, bestD] = [r.id, d];
    }
  }
  return best === null ? null : { type: 'road_protection', roadId: best };
}

/** Where a piece's disc sits on the map. */
export function anchorOf(data: MapData, t: Target): LngLat | null {
  const idx = engineIndex(data);
  if (t.type === 'shelter') {
    const s = idx.sites.get(t.siteId);
    return s ? [s.lon, s.lat] : null;
  }
  if (t.type === 'bus_pickup') {
    const stop = t.stopId !== undefined ? idx.stops.get(t.stopId)?.stop : undefined;
    if (stop) return [stop.lon, stop.lat];
    return t.cell >= 0 && t.cell < data.cells.length ? cellCenter(data, t.cell) : null;
  }
  const r = idx.roads.get(t.roadId);
  return r ? roadMidpoint(r) : null;
}

/** The point halfway along a road, by length. */
export function roadMidpoint(r: FloodRoad): LngLat {
  const seg = r.coords.slice(1).map((b, k) => Math.hypot(b[0] - r.coords[k]![0], b[1] - r.coords[k]![1]));
  let half = seg.reduce((t, d) => t + d, 0) / 2;
  for (let k = 0; k < seg.length; k++) {
    if (half <= seg[k]! && seg[k]! > 0) {
      const [a, b] = [r.coords[k]!, r.coords[k + 1]!];
      const t = half / seg[k]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    half -= seg[k]!;
  }
  return r.coords[0]!;
}

/** Road names from OSM can be "Unnamed road <osm ids>"; name those by their neighborhood. */
export function roadLabel(data: MapData, r: FloodRoad): string {
  if (!/^unnamed road/i.test(r.name) && r.name.trim()) return r.name;
  const cell = cellAt(data, roadMidpoint(r));
  return cell === undefined ? 'Unnamed road' : `Unnamed road in ${data.cells[cell]!.hood}`;
}

/** A plain name for a target, for the status line and the plan list. */
export function targetLabel(data: MapData, t: Target): string {
  const idx = engineIndex(data);
  if (t.type === 'shelter') return idx.sites.get(t.siteId)?.name ?? 'Unknown site';
  if (t.type === 'road_protection') {
    const r = idx.roads.get(t.roadId);
    return r ? roadLabel(data, r) : 'Unknown road';
  }
  const stop = t.stopId !== undefined ? idx.stops.get(t.stopId)?.stop : undefined;
  if (stop) return `${stop.agency} stop ${stop.name}`;
  return `New stop in ${data.cells[t.cell]?.hood ?? 'an unknown place'}`;
}
