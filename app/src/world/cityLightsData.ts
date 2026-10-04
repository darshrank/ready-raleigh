// The city's lights at night (DESIGN.md "The world"), generated once at load in the flood worker
// (world/flood.worker.ts) from data the game already ships: no new data files.
//
// - Building lights: points scattered inside each H3 cell, as many as its residents' share of the
//   budget (stochastic rounding, so small cells still get the odd light).
// - Street lights: a point every SPACING_M along the drive graph's roads, the fastest roads first
//   (arterials read as strings of light from the storm overview), until the street share of the
//   budget is used. Smaller cities light every road; Raleigh's 6,000 km fill the share sooner.
//
// Everything is seeded, so a city gets the same lights on every load.
import { cellToBoundary } from 'h3-js';

/** Most lights a city gets (the low quality tier halves it). */
export const LIGHTS_BUDGET = 60_000;
/** Street lights take at most this share of the budget; the buildings get the rest. */
const STREET_SHARE = 0.45;
/** Meters between street lights. */
export const SPACING_M = 60;
const M_PER_DEG = 111_320;

export interface LightsData {
  /** Per light: longitude, latitude (float32), and what float32 loses of them. */
  positions: Float32Array;
  positions64Low: Float32Array;
  /** Per light: kind (0 building, 1 street), seed (0..1). */
  info: Float32Array;
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

export function buildLights(cells: LightCell[], graph: LightGraph, budget = LIGHTS_BUDGET): LightsData {
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
  return { positions, positions64Low, info, count, streets };
}
