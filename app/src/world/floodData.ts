// The storm water's GPU data, built once at load from flood_steps.geojson (in flood.worker.ts).
//
// - Geometry: every flood polygon triangulated (its surface) plus a quad per edge (the sides
//   the water shows when it rises in 3D), positions as fp64-split longitude/latitude.
// - Arrival texture (RGBA8, ~30 m cells): for each step k, how late inside its step the water
//   reaches a point, 0..1 = sqrt(min(distance to the earlier water, SPREAD) / SPREAD). The
//   earlier water of step 1 is its main channels (the fifth of its parts with the most points),
//   as in map/flood.ts prepareParts. The water shader reveals each fragment at
//   P * GROW - delay * (GROW - PART), the same formula FloodView applies per part.
// - Band (CPU only): each grid cell's step, for the city lights' nearest zone (cityLightsData.ts).
// - Extent texture (RGBA8): signed distance (meters, clamped to +-RANGE_M, 128 = the edge) to the
//   water of steps <= 1, <= 2 and <= 3, so a building knows if and when it stands in water.
import { earcut } from '@math.gl/polygon';
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';

export const CELL_M = 30;
export const SPREAD_M = 1500;
export const RANGE_M = 120;
const M_PER_DEG = 111_320;

export interface FloodGrid {
  lng0: number;
  lat0: number;
  /** Degrees per cell. */
  dLng: number;
  dLat: number;
  w: number;
  h: number;
}

export interface FloodData {
  positions: Float32Array;
  positions64Low: Float32Array;
  /** Per vertex: outward normal x, y (sides), side flag, top flag; snorm8. */
  info: Int8Array;
  /** Per vertex: the flood step (1..3). */
  steps: Float32Array;
  indices: Uint32Array;
  grid: FloodGrid;
  arrival: Uint8Array;
  extent: Uint8Array;
  /** Per grid cell: the step whose zone covers it (1..3), 0 outside every zone. */
  band: Uint8Array;
}

type Raw = FeatureCollection<Polygon | MultiPolygon, { step: number }>;

/** Felzenszwalb's 1D squared distance transform (f: 0 at sites, INF elsewhere). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
}

/** Euclidean distance (in cells) from every cell to the nearest cell where `mask` is set. */
function edt(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const g = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? 0 : INF;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]!;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x]!;
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]!);
  }
  return out;
}

/** Even-odd scanline fill of a polygon (rings in lng/lat) into the grid, setting `value`. */
function fill(grid: Uint8Array, G: FloodGrid, rings: Position[][], value: number) {
  const edges: number[][] = [];
  let ymin = Infinity;
  let ymax = -Infinity;
  const gx = (lng: number) => (lng - G.lng0) / G.dLng;
  const gy = (lat: number) => (lat - G.lat0) / G.dLat;
  for (const ring of rings)
    for (let k = 0; k + 1 < ring.length; k++) {
      let x0 = gx(ring[k]![0]!), y0 = gy(ring[k]![1]!);
      let x1 = gx(ring[k + 1]![0]!), y1 = gy(ring[k + 1]![1]!);
      if (y0 === y1) continue;
      if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
      edges.push([y0, y1, x0, (x1 - x0) / (y1 - y0)]);
      ymin = Math.min(ymin, y0);
      ymax = Math.max(ymax, y1);
    }
  const xs: number[] = [];
  for (let r = Math.max(0, Math.floor(ymin)); r <= Math.min(G.h - 1, Math.ceil(ymax)); r++) {
    const yc = r + 0.5;
    xs.length = 0;
    for (const e of edges) if (e[0]! <= yc && e[1]! > yc) xs.push(e[2]! + (yc - e[0]!) * e[3]!);
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const c1 = Math.min(G.w - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let c = c0; c <= c1; c++) grid[r * G.w + c] = value;
    }
  }
}

export function buildFlood(raw: Raw): FloodData {
  const polys: { step: number; rings: Position[][] }[] = [];
  for (const f of raw.features) {
    const step = Number(f.properties.step);
    if (step < 1 || step > 3) continue;
    const list = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of list) polys.push({ step, rings });
  }

  // Grid over the water's extent, with a margin for the distance fields.
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys)
    for (const q of p.rings[0]!) {
      w = Math.min(w, q[0]!);
      e = Math.max(e, q[0]!);
      s = Math.min(s, q[1]!);
      n = Math.max(n, q[1]!);
    }
  const lat = (s + n) / 2;
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const margin = 300;
  const G: FloodGrid = {
    lng0: w - margin / kx,
    lat0: s - margin / M_PER_DEG,
    dLng: CELL_M / kx,
    dLat: CELL_M / M_PER_DEG,
    w: 0,
    h: 0,
  };
  G.w = Math.ceil((e - G.lng0) / G.dLng + margin / CELL_M) + 1;
  G.h = Math.ceil((n - G.lat0) / G.dLat + margin / CELL_M) + 1;
  const size = G.w * G.h;

  // Rasters: each step's band, and the main channels of step 1.
  const band = new Uint8Array(size);
  const seeds = new Uint8Array(size);
  const first = polys.map((p, i) => [p, i] as const).filter(([p]) => p.step === 1);
  first.sort((a, b) => b[0].rings[0]!.length - a[0].rings[0]!.length);
  const main = new Set(first.slice(0, Math.max(1, Math.ceil(first.length / 5))).map(([, i]) => i));
  polys.forEach((p, i) => {
    fill(band, G, p.rings, p.step);
    if (main.has(i)) fill(seeds, G, p.rings, 1);
  });
  const upTo = (k: number) => {
    const m = new Uint8Array(size);
    for (let i = 0; i < size; i++) m[i] = band[i]! > 0 && band[i]! <= k ? 1 : 0;
    return m;
  };
  const m1 = upTo(1);
  const m2 = upTo(2);
  const m3 = upTo(3);
  const not = (m: Uint8Array) => m.map((x) => 1 - x);

  // Arrival delays: distance to the earlier water.
  const near = [edt(seeds, G.w, G.h), edt(m1, G.w, G.h), edt(m2, G.w, G.h)];
  const arrival = new Uint8Array(4 * size);
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < 3; k++) {
      const d = near[k]![i]! * CELL_M;
      arrival[4 * i + k] = Math.round(255 * Math.sqrt(Math.min(d, SPREAD_M) / SPREAD_M));
    }
    arrival[4 * i + 3] = 255;
  }

  // Extent: signed distance to the water of steps <= k (negative inside).
  const extent = new Uint8Array(4 * size);
  [m1, m2, m3].forEach((m, k) => {
    const out = near[k + 1] ?? edt(m, G.w, G.h); // distance to water (0 inside)
    const inside = edt(not(m), G.w, G.h); // distance to dry land (0 outside)
    for (let i = 0; i < size; i++) {
      const sd = m[i] ? -(inside[i]! * CELL_M - CELL_M / 2) : out[i]! * CELL_M - CELL_M / 2;
      extent[4 * i + k] = Math.max(0, Math.min(255, Math.round(128 + (127 * sd) / RANGE_M)));
    }
  });
  for (let i = 0; i < size; i++) extent[4 * i + 3] = 255;

  // Geometry: surfaces (earcut) and side quads, longitude/latitude split for fp64.
  let verts = 0;
  let tris = 0;
  for (const p of polys) {
    const pts = p.rings.reduce((a, r) => a + r.length, 0);
    verts += pts + 4 * pts;
    tris += pts + 2 * pts;
  }
  const positions = new Float32Array(3 * verts);
  const low = new Float32Array(3 * verts);
  const info = new Int8Array(4 * verts);
  const steps = new Float32Array(verts);
  const indices = new Uint32Array(3 * tris);
  let v = 0;
  let t = 0;
  const vertex = (lng: number, latv: number, step: number, nx: number, ny: number, side: boolean, top: boolean) => {
    const fx = Math.fround(lng);
    const fy = Math.fround(latv);
    positions[3 * v] = fx;
    positions[3 * v + 1] = fy;
    low[3 * v] = lng - fx;
    low[3 * v + 1] = latv - fy;
    info[4 * v] = Math.round(nx * 127);
    info[4 * v + 1] = Math.round(ny * 127);
    info[4 * v + 2] = side ? 127 : 0;
    info[4 * v + 3] = top ? 127 : 0;
    steps[v] = step;
    return v++;
  };
  for (const p of polys) {
    const flat: number[] = [];
    const holes: number[] = [];
    p.rings.forEach((r, k) => {
      if (k) holes.push(flat.length / 2);
      for (const q of r) flat.push(q[0]!, q[1]!);
    });
    const base = v;
    for (let i = 0; i < flat.length; i += 2) vertex(flat[i]!, flat[i + 1]!, p.step, 0, 0, false, true);
    for (const k of earcut(flat, holes, 2)) indices[t++] = base + k;
    // Sides: outward normals (outline counter-clockwise, holes clockwise).
    p.rings.forEach((r, k) => {
      let area = 0;
      for (let i = 0; i + 1 < r.length; i++) area += r[i]![0]! * r[i + 1]![1]! - r[i + 1]![0]! * r[i]![1]!;
      const flip = (k === 0) !== area > 0 ? -1 : 1;
      for (let i = 0; i + 1 < r.length; i++) {
        const [x0, y0] = r[i]!;
        const [x1, y1] = r[i + 1]!;
        const mx = (x1! - x0!) * kx;
        const my = (y1! - y0!) * M_PER_DEG;
        const len = Math.hypot(mx, my);
        if (len < 0.01) continue;
        const nx = (flip * my) / len;
        const ny = (-flip * mx) / len;
        const a = vertex(x0!, y0!, p.step, nx, ny, true, false);
        const b = vertex(x1!, y1!, p.step, nx, ny, true, false);
        const c = vertex(x1!, y1!, p.step, nx, ny, true, true);
        const d = vertex(x0!, y0!, p.step, nx, ny, true, true);
        indices[t++] = a;
        indices[t++] = b;
        indices[t++] = c;
        indices[t++] = a;
        indices[t++] = c;
        indices[t++] = d;
      }
    });
  }
  return {
    positions: positions.slice(0, 3 * v),
    positions64Low: low.slice(0, 3 * v),
    info: info.slice(0, 4 * v),
    steps: steps.slice(0, v),
    indices: indices.slice(0, t),
    grid: G,
    arrival,
    extent,
    band,
  };
}

