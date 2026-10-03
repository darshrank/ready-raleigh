// Camera framing: show every loaded cell and site, at any screen size and pitch.
import type { Map as MapLibreMap } from 'maplibre-gl';
import { cellToBoundary } from 'h3-js';
import { atRiskCells, engineIndex } from '@shared/engine';
import type { MapData } from '../data';

type LngLat = [number, number];

/**
 * What the camera must show: every cell's corners and every site, the places people act on.
 * Flood polygons are left out on purpose: they can run far along a creek, and fitting them pushed
 * the phone view below zoom 13, where street names and buildings disappear. Water past the
 * edge of the screen reads naturally on a map.
 */
export function dataPoints({ cells, sites }: MapData): LngLat[] {
  const pts: LngLat[] = [];
  for (const c of cells) pts.push(...(cellToBoundary(c.h3, true) as LngLat[]));
  for (const s of sites) pts.push([s.lon, s.lat]);
  // Real data has tens of thousands of vertices; a few thousand frame just as well.
  const stride = Math.ceil(pts.length / 4000);
  return stride > 1 ? pts.filter((_, k) => k % stride === 0) : pts;
}

/** Rings around a cell that make up a "street level" area: about 2 km across, z13+ on a phone. */
const FOCUS_RINGS = 3;

/**
 * Phones open at street level, not on the whole city (DESIGN.md "Map"): the corners of the cells
 * around the at-risk cell whose neighborhood holds the most at-risk weighted people.
 */
export function riskFocusPoints(data: MapData): LngLat[] {
  const idx = engineIndex(data);
  const m = idx.mode.flood;
  let best = -1;
  let bestW = -1;
  for (const i of atRiskCells('flood', data)) {
    let w = 0;
    for (const j of idx.disk(i, FOCUS_RINGS)) if (m.atRisk[j]) w += idx.weight[j]!;
    if (w > bestW) [best, bestW] = [i, w];
  }
  if (best < 0) return dataPoints(data);
  const pts: LngLat[] = [];
  for (const j of idx.disk(best, FOCUS_RINGS)) pts.push(...(cellToBoundary(data.cells[j]!.h3, true) as LngLat[]));
  return pts;
}

/**
 * The convex hull of `points` (monotone chain). A camera projects straight lines to straight lines,
 * so the hull's corners have the same screen extent as all the points, at a fraction of the cost.
 */
export function hull(points: LngLat[]): LngLat[] {
  if (points.length < 4) return points;
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: LngLat, a: LngLat, b: LngLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: LngLat[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: LngLat[] = [];
  for (let k = p.length - 1; k >= 0; k--) {
    const q = p[k]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Room to keep clear around framed data, in px: a number for all sides, or per side (HUD plates). */
export type Pad = number | { top: number; right: number; bottom: number; left: number };
const sides = (p: Pad) => (typeof p === 'number' ? { top: p, right: p, bottom: p, left: p } : p);

/**
 * Fit `points` at `pitch`. A pitched camera turns the data's bounding box into a trapezoid, so
 * instead of fitting the box, binary-search the largest zoom at which every point projects inside
 * the padded viewport, re-centering the projected extent in the padded box at each step.
 */
export function framePoints(map: MapLibreMap, all: LngLat[], pitch: number, padding: Pad) {
  if (all.length === 0) return;
  const points = hull(all);
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const pad = sides(padding);
  if (w - pad.left - pad.right < 40 || h - pad.top - pad.bottom < 40) return;

  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  const start = map.cameraForBounds([[west, south], [east, north]], { padding: pad, bearing: 0 });
  if (!start?.zoom) return;
  const center: LngLat = [(west + east) / 2, (south + north) / 2];
  // The middle of the padded box, where the data's projected extent should sit.
  const cx = (pad.left + w - pad.right) / 2;
  const cy = (pad.top + h - pad.bottom) / 2;

  const extent = () => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of points) {
      const { x, y } = map.project(p);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  };
  const fitsAt = (zoom: number) => {
    map.jumpTo({ center, zoom, pitch, bearing: 0 });
    for (let k = 0; k < 3; k++) {
      const e = extent();
      map.setCenter(map.unproject([w / 2 + (e.x0 + e.x1) / 2 - cx, h / 2 + (e.y0 + e.y1) / 2 - cy]));
    }
    const e = extent();
    return e.x0 >= pad.left && e.x1 <= w - pad.right && e.y0 >= pad.top && e.y1 <= h - pad.bottom;
  };

  let lo = start.zoom - 3;
  let hi = start.zoom + 3;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    if (fitsAt(mid)) lo = mid;
    else hi = mid;
  }
  fitsAt(lo);
}

export interface Camera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Where framePoints would put the camera, without moving the map (for flying there instead). */
export function cameraForPoints(map: MapLibreMap, points: LngLat[], pitch: number, padding: Pad): Camera | null {
  const before = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  framePoints(map, points, pitch, padding);
  const c = map.getCenter();
  const out: Camera = { center: [c.lng, c.lat], zoom: map.getZoom(), pitch, bearing: 0 };
  map.jumpTo(before);
  return points.length ? out : null;
}

/** Padding around framed data: 5% of the width, at most 40 px. */
export const framePadding = (map: MapLibreMap) => Math.round(Math.min(40, map.getContainer().clientWidth * 0.05));
