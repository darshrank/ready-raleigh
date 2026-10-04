// The city's lights at night (DESIGN.md "The world"), generated once at load in the flood worker
// (world/flood.worker.ts) from data the game already ships: no new data files.
//
// - Building lights: points scattered inside each H3 cell, as many as its residents' share of the
//   budget (stochastic rounding, so small cells still get the odd light).
// - Street lights: a point every SPACING_M along the drive graph's roads, the fastest roads first
//   (arterials read as strings of light from the storm overview), until the street share of the
//   budget is used. Smaller cities light every road; Raleigh's 6,000 km fill the share sooner.
//
// - Blackout reference (O2): each light's nearest hazard zone cell on the flood worker's grid
//   (its own cell when it stands in a zone), within NEAR_M, as a texture coordinate and a distance.
//   The lights' shader reads the arrival textures there, so a light goes dark when its zone's
//   hazard arrives and the ones near it a little later.
//
// Everything is seeded, so a city gets the same lights on every load.
import { cellToBoundary } from 'h3-js';
import type { FloodGrid } from './floodData';

/** Most lights a city gets (the low quality tier halves it). */
export const LIGHTS_BUDGET = 60_000;
/** Street lights take at most this share of the budget; the buildings get the rest. */
const STREET_SHARE = 0.45;
/** Meters between street lights. */
export const SPACING_M = 60;
/** Lights this close to a hazard zone follow it into the dark. */
export const NEAR_M = 400;
const M_PER_DEG = 111_320;

export interface LightsData {
  /** Per light: longitude, latitude (float32), and what float32 loses of them. */
  positions: Float32Array;
  positions64Low: Float32Array;
  /** Per light: kind (0 building, 1 street), seed (0..1). */
  info: Float32Array;
  /**
   * Per light: texture coordinate (u, v) of its nearest zone cell and the distance to it in meters
   * (0 inside a zone); distance -1 with no zone within NEAR_M (it stays lit).
   */
  ref: Float32Array;
  count: number;
  streets: number;
}

export interface LightCell {
  h3: string;
  pop: number;
}

export interface LightGraph {
  nodes: [number, number][];
  /** [from, to, seconds, floodStep | null] */
  edges: [number, number, number, number | null][];
}

/** mulberry32: a small seeded generator, 0..1. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inside(x: number, y: number, ring: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The hazard zones on the flood worker's grid (floodData.ts). */
export interface LightZones {
  grid: FloodGrid;
  band: Uint8Array;
}

/** Cells per side of the coarse "any zone here" blocks that skip most of the nearest search. */
const BLOCK = 8;

/** Writes each light's nearest zone cell within NEAR_M into `ref` (see LightsData.ref). */
function nearestZones(lng: number[], lat: number[], z: LightZones | null, ref: Float32Array) {
  ref.fill(-1);
  if (!z) return;
  const G = z.grid;
  const bw = Math.ceil(G.w / BLOCK);
  const bh = Math.ceil(G.h / BLOCK);
  const any = new Uint8Array(bw * bh);
  for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (z.band[y * G.w + x]) any[((y / BLOCK) | 0) * bw + ((x / BLOCK) | 0)] = 1;
  // Grid cells are square in meters (floodData.ts): CELL_M = dLat in meters.
  const cellM = G.dLat * M_PER_DEG;
  const R = Math.ceil(NEAR_M / cellM);
  for (let i = 0; i < lng.length; i++) {
    const fx = (lng[i]! - G.lng0) / G.dLng;
    const fy = (lat[i]! - G.lat0) / G.dLat;
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    let best = Infinity;
    let bx = 0;
    let by = 0;
    if (cx >= 0 && cy >= 0 && cx < G.w && cy < G.h && z.band[cy * G.w + cx]) {
      [best, bx, by] = [0, cx, cy];
    } else {
      const x0 = Math.max(0, cx - R);
      const x1 = Math.min(G.w - 1, cx + R);
      const y0 = Math.max(0, cy - R);
      const y1 = Math.min(G.h - 1, cy + R);
      if (x0 > x1 || y0 > y1) continue;
      for (let qy = (y0 / BLOCK) | 0; qy <= ((y1 / BLOCK) | 0); qy++)
        for (let qx = (x0 / BLOCK) | 0; qx <= ((x1 / BLOCK) | 0); qx++) {
          if (!any[qy * bw + qx]) continue;
          for (let y = Math.max(y0, qy * BLOCK); y <= Math.min(y1, qy * BLOCK + BLOCK - 1); y++)
            for (let x = Math.max(x0, qx * BLOCK); x <= Math.min(x1, qx * BLOCK + BLOCK - 1); x++) {
              if (!z.band[y * G.w + x]) continue;
              const d2 = (x + 0.5 - fx) ** 2 + (y + 0.5 - fy) ** 2;
              if (d2 < best) [best, bx, by] = [d2, x, y];
            }
        }
      if (best === Infinity) continue;
      best = Math.sqrt(best) * cellM;
      if (best > NEAR_M) continue;
    }
    ref[3 * i] = (bx + 0.5) / G.w;
    ref[3 * i + 1] = (by + 0.5) / G.h;
    ref[3 * i + 2] = best;
  }
}

export function buildLights(cells: LightCell[], graph: LightGraph, budget = LIGHTS_BUDGET, zones: LightZones | null = null): LightsData {
  const lng: number[] = [];
  const lat: number[] = [];
  const kind: number[] = [];
  const rand = rng(0x5eed);

  // Streets: unique road segments (the graph has both directions), fastest first.
  const nodes = graph.nodes;
  const lat0 = nodes.length ? nodes[0]![1] : 0;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const seen = new Set<number>();
  const roads: { a: number; b: number; len: number; speed: number }[] = [];
  for (const [a, b, seconds] of graph.edges) {
    const key = Math.min(a, b) * 0x200000 + Math.max(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    const p = nodes[a];
    const q = nodes[b];
    if (!p || !q) continue;
    const len = Math.hypot((q[0] - p[0]) * kx, (q[1] - p[1]) * M_PER_DEG);
    if (len < 1) continue;
    roads.push({ a, b, len, speed: len / Math.max(seconds, 0.1) });
  }
  roads.sort((x, y) => y.speed - x.speed);
  const streetCap = Math.floor(budget * STREET_SHARE);
  // Each road carries its leftover distance into the next light, so short segments still get some.
  for (const r of roads) {
    if (lng.length >= streetCap) break;
    const p = nodes[r.a]!;
    const q = nodes[r.b]!;
    for (let d = rand() * SPACING_M; d < r.len && lng.length < streetCap; d += SPACING_M) {
      const t = d / r.len;
      lng.push(p[0] + (q[0] - p[0]) * t);
      lat.push(p[1] + (q[1] - p[1]) * t);
      kind.push(1);
    }
  }
  const streets = lng.length;

  // Buildings: the rest of the budget, by residents.
  const left = budget - streets;
  const people = cells.reduce((s, c) => s + Math.max(0, c.pop), 0);
  const per = people > 0 ? left / people : 0;
  for (const c of cells) {
    const want = Math.max(0, c.pop) * per;
    let n = Math.floor(want) + (rand() < want - Math.floor(want) ? 1 : 0);
    if (n <= 0) continue;
    if (lng.length + n > budget) n = budget - lng.length;
    if (n <= 0) break;
    const ring = cellToBoundary(c.h3, true) as [number, number][];
    let [w, s, e, nn] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of ring) [w, s, e, nn] = [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(nn, y)];
    for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
      const x = w + (e - w) * rand();
      const y = s + (nn - s) * rand();
      if (!inside(x, y, ring)) continue;
      lng.push(x);
      lat.push(y);
      kind.push(0);
      k++;
    }
  }

  const count = lng.length;
  const positions = new Float32Array(2 * count);
  const positions64Low = new Float32Array(2 * count);
  const info = new Float32Array(2 * count);
  for (let i = 0; i < count; i++) {
    positions[2 * i] = Math.fround(lng[i]!);
    positions[2 * i + 1] = Math.fround(lat[i]!);
    positions64Low[2 * i] = lng[i]! - positions[2 * i]!;
    positions64Low[2 * i + 1] = lat[i]! - positions[2 * i + 1]!;
    info[2 * i] = kind[i]!;
    info[2 * i + 1] = rand();
  }
  const ref = new Float32Array(3 * count);
  nearestZones(lng, lat, zones, ref);
  return { positions, positions64Low, info, ref, count, streets };
}
