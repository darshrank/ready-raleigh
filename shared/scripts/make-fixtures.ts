// Builds small, internally consistent fixture files around NC State's main campus so the engine
// and UI can run before the real pipeline lands. Deterministic: same output every run.
//
//   npm run fixtures
//
// Model: Rocky Branch creek is a polyline; flood steps are nested bands around it. A 6 x 6 drive
// grid plus a link to UNC Rex Hospital gives cut-off, shelter coverage and road unlocks.
// Names and coordinates are approximate. This is fake data with the real file shapes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { FINAL_FLOOD_STEP, SHELTER_DRIVE_LIMIT_S } from '../src/config';
import type { DataMeta, FloodStepsCollection, Hospital, RoadsGraph } from '../src/data';
import type { Cell, FloodRoad, Site } from '../src/types';

type LonLat = [number, number];

const OUT_DIR = fileURLToPath(new URL('../../app/public/data/fixtures/', import.meta.url));
const CENTER: LonLat = [-78.674, 35.784]; // Talley Student Union
const RES = 9;

// ---------- helpers ----------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2026);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const at = <T>(arr: T[], i: number): T => {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range`);
  return v;
};

function meters(a: LonLat, b: LonLat): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointInRing(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = at(ring, i);
    const [xj, yj] = at(ring, j);
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- flood steps: nested bands around Rocky Branch ----------
const CREEK: LonLat[] = [
  [-78.692, 35.7802],
  [-78.684, 35.7812],
  [-78.677, 35.7822],
  [-78.671, 35.7818],
  [-78.665, 35.7806],
  [-78.656, 35.7795],
];
const HALF_WIDTH_M: Record<number, number> = { 1: 90, 2: 170, 3: 290 };
const M_PER_DEG_LAT = 111_320;

function band(halfWidthM: number): LonLat[] {
  const d = halfWidthM / M_PER_DEG_LAT;
  const north = CREEK.map(([x, y]): LonLat => [r5(x), r5(y + d)]);
  const south = CREEK.map(([x, y]): LonLat => [r5(x), r5(y - d)]).reverse();
  const ring = [...north, ...south];
  ring.push(at(ring, 0));
  return ring;
}
const STEPS = [1, 2, 3];
const bands = new Map(STEPS.map((step) => [step, band(HALF_WIDTH_M[step] ?? 0)]));
const bandFor = (step: number): LonLat[] => {
  const b = bands.get(step);
  if (!b) throw new Error(`no band for step ${step}`);
  return b;
};

function floodStepAt(p: LonLat): number | null {
  for (const step of STEPS) if (pointInRing(p, bandFor(step))) return step;
  return null;
}

function creekLatAt(lon: number): number {
  for (let k = 0; k < CREEK.length - 1; k++) {
    const [x0, y0] = at(CREEK, k);
    const [x1, y1] = at(CREEK, k + 1);
    if (lon >= x0 && lon <= x1) return y0 + ((lon - x0) / (x1 - x0)) * (y1 - y0);
  }
  return lon < at(CREEK, 0)[0] ? at(CREEK, 0)[1] : at(CREEK, CREEK.length - 1)[1];
}

// Step 1 is the innermost band. A ring that is inside step 1 is also inside steps 2 and 3, so each
// feature is drawn as its full band; renderers paint step 3 first, then 2, then 1.
const floodSteps: FloodStepsCollection = {
  type: 'FeatureCollection',
  features: [3, 2, 1].map((step) => ({
    type: 'Feature' as const,
    properties: { step },
    geometry: { type: 'Polygon' as const, coordinates: [bandFor(step)] },
  })),
};

// ---------- cells ----------
const centerH3 = latLngToCell(CENTER[1], CENTER[0], RES);
const h3s = gridDisk(centerH3, 3).sort();
const centroid = (h: string): LonLat => {
  const [lat, lon] = cellToLatLng(h);
  return [lon, lat];
};

function hoodFor(p: LonLat): string {
  const north = p[1] > creekLatAt(p[0]);
  const west = p[0] < CENTER[0];
  if (north) return west ? 'West Raleigh' : 'Hillsborough Street';
  return west ? 'Central Campus' : 'Mission Valley';
}

const cells: Cell[] = h3s.map((h3, i) => {
  const p = centroid(h3);
  const pop = Math.round(between(200, 1400));
  const households = pop / 2.2;
  const treePct = Math.round(between(5, 45));
  return {
    i,
    h3,
    hood: hoodFor(p),
    pop,
    pop65: Math.round(pop * between(0.04, 0.15)),
    lowInc: Math.round(pop * between(0.1, 0.4)),
    noCarHH: Math.round(households * between(0.05, 0.3)),
    floodStep: floodStepAt(p),
    cutOff: false, // filled in after the graph is built
    heatC: Math.round((41 - treePct * 0.18 + between(-1.5, 1.5)) * 10) / 10,
    treePct,
  };
});

// ---------- drive graph: 6 x 6 grid plus a hospital link ----------
const GRID = 6;
const BBOX = { w: -78.687, e: -78.661, s: 35.7755, n: 35.7925 };
const SPEED_MS = 11.2; // about 25 mph
const nodes: LonLat[] = [];
for (let r = 0; r < GRID; r++) {
  for (let c = 0; c < GRID; c++) {
    nodes.push([
      r5(BBOX.w + ((BBOX.e - BBOX.w) * c) / (GRID - 1)),
      r5(BBOX.s + ((BBOX.n - BBOX.s) * r) / (GRID - 1)),
    ]);
  }
}
const nodeId = (r: number, c: number) => r * GRID + c;

function edgeFloodStep(a: LonLat, b: LonLat): number | null {
  let first: number | null = null;
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    const s = floodStepAt([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (s !== null && (first === null || s < first)) first = s;
  }
  return first;
}

const edges: RoadsGraph['edges'] = [];
function addEdge(from: number, to: number, speed = SPEED_MS, detour = 1) {
  const a = at(nodes, from);
  const b = at(nodes, to);
  edges.push([from, to, Math.round((meters(a, b) * detour) / speed), edgeFloodStep(a, b)]);
}
for (let r = 0; r < GRID; r++) {
  for (let c = 0; c < GRID; c++) {
    if (c + 1 < GRID) addEdge(nodeId(r, c), nodeId(r, c + 1));
    if (r + 1 < GRID) addEdge(nodeId(r, c), nodeId(r + 1, c));
  }
}
// UNC Rex Hospital, northwest of campus, reached from the grid's northwest corner.
const hospitalNode = nodes.length;
nodes.push([-78.7027, 35.8176]);
addEdge(nodeId(GRID - 1, 0), hospitalNode, 13.4, 1.3);

const graph: RoadsGraph = { nodes, edges };
const hospitals: Hospital[] = [
  { name: 'UNC Rex Hospital', lon: -78.7027, lat: 35.8176, node: hospitalNode },
];

function nearestNode(p: LonLat): number {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < hospitalNode; k++) {
    const d = meters(p, at(nodes, k));
    if (d < bestD) [best, bestD] = [k, d];
  }
  return best;
}
const cellNode = cells.map((c) => nearestNode(centroid(c.h3)));

/** Shortest drive time from `src` to every node. Edges in `closed` (by index) are skipped. */
function driveTimes(src: number, closed: (edgeIdx: number) => boolean): number[] {
  const adj: [number, number, number][][] = nodes.map(() => []);
  edges.forEach(([a, b, s], k) => {
    adj[a]!.push([b, s, k]);
    adj[b]!.push([a, s, k]);
  });
  const dist = nodes.map(() => Infinity);
  const done = nodes.map(() => false);
  dist[src] = 0;
  for (;;) {
    let u = -1;
    for (let k = 0; k < nodes.length; k++) if (!done[k] && (u < 0 || dist[k]! < dist[u]!)) u = k;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (const [v, s, k] of adj[u]!) {
      if (closed(k)) continue;
      if (dist[u]! + s < dist[v]!) dist[v] = dist[u]! + s;
    }
  }
  return dist;
}

const closedAtFinal = (k: number) => {
  const step = at(edges, k)[3];
  return step !== null && step <= FINAL_FLOOD_STEP;
};
const toHospitalFlooded = driveTimes(hospitalNode, closedAtFinal);
cells.forEach((c, i) => {
  c.cutOff = toHospitalFlooded[at(cellNode, i)] === Infinity;
});

// ---------- flood roads: the flooded stretch of two north-south streets ----------
function floodRoadForColumn(id: string, name: string, col: number): FloodRoad {
  const roadEdges: number[] = [];
  edges.forEach(([a, b, , step], k) => {
    const vertical = a % GRID === col && b === a + GRID && b < hospitalNode;
    if (vertical && step !== null) roadEdges.push(k);
  });
  if (roadEdges.length === 0) throw new Error(`column ${col} has no flooded edges`);
  const first = at(edges, at(roadEdges, 0));
  const coords: LonLat[] = [at(nodes, first[0])];
  for (const k of roadEdges) coords.push(at(nodes, at(edges, k)[1]));
  const open = new Set(roadEdges);
  const withRoad = driveTimes(hospitalNode, (k) => !open.has(k) && closedAtFinal(k));
  const unlocks = cells
    .filter((c, i) => c.cutOff && withRoad[at(cellNode, i)] !== Infinity)
    .map((c) => c.i);
  const floodStep = Math.min(...roadEdges.map((k) => at(edges, k)[3] ?? Infinity));
  return { id, name, floodStep, coords, unlocks };
}
const floodRoads: FloodRoad[] = [
  floodRoadForColumn('road-dan-allen', 'Dan Allen Drive at Rocky Branch', 2),
  floodRoadForColumn('road-pullen', 'Pullen Road at Rocky Branch', 4),
];

// ---------- shelter candidate sites ----------
function cellIndexFor(p: LonLat): number {
  const h = latLngToCell(p[1], p[0], RES);
  const hit = cells.find((c) => c.h3 === h);
  if (hit) return hit.i;
  let best = 0;
  let bestD = Infinity;
  cells.forEach((c) => {
    const d = meters(p, centroid(c.h3));
    if (d < bestD) [best, bestD] = [c.i, d];
  });
  return best;
}

function makeSite(id: string, name: string, kind: string, lon: number, lat: number): Site {
  const p: LonLat = [lon, lat];
  const node = nearestNode(p);
  const dry = driveTimes(node, () => false);
  const wet = driveTimes(node, closedAtFinal);
  const within = (dist: number[]) =>
    cells.filter((_, i) => dist[at(cellNode, i)]! <= SHELTER_DRIVE_LIMIT_S).map((c) => c.i);
  return {
    id,
    name,
    kind,
    lon,
    lat,
    cell: cellIndexFor(p),
    floodStep: floodStepAt(p),
    coverDry: within(dry),
    coverFlood: within(wet),
  };
}
const sites: Site[] = [
  makeSite('site-dh-hill', 'D. H. Hill Jr. Library', 'library', -78.6697, 35.7874),
  makeSite('site-west-raleigh-pres', 'West Raleigh Presbyterian Church', 'place_of_worship', -78.6806, 35.7893),
  makeSite('site-pullen-cc', 'Pullen Community Center', 'community_centre', -78.6652, 35.7801),
  // South of the creek and dry: the one shelter that can reach the cut-off side.
  makeSite('site-avent-ferry', 'Avent Ferry Road Church', 'place_of_worship', -78.6795, 35.7768),
];

const meta: DataMeta = {
  built: '2026-10-03',
  fixture: true,
  sources: ['Hand-made fixture around NC State main campus. Not real data.'],
  thresholds: { heatPercentile: 80, shelterDriveLimitS: SHELTER_DRIVE_LIMIT_S, finalFloodStep: FINAL_FLOOD_STEP },
};

// ---------- write ----------
mkdirSync(OUT_DIR, { recursive: true });
const files: Record<string, unknown> = {
  'cells.json': cells,
  'sites.json': sites,
  'flood_roads.json': floodRoads,
  'flood_steps.geojson': floodSteps,
  'roads_graph.json': graph,
  'hospitals.json': hospitals,
  'meta.json': meta,
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(OUT_DIR + name, JSON.stringify(data) + '\n');
}

const flooded = cells.filter((c) => c.floodStep !== null).length;
const cut = cells.filter((c) => c.cutOff).length;
console.log(`fixtures -> ${OUT_DIR}`);
console.log(`cells ${cells.length} (flooded ${flooded}, cut off ${cut}), nodes ${nodes.length}, edges ${edges.length}`);
for (const s of sites) console.log(`site ${s.id}: floodStep ${s.floodStep}, dry ${s.coverDry.length}, flood ${s.coverFlood.length}`);
for (const r of floodRoads) console.log(`road ${r.id}: step ${r.floodStep}, unlocks ${r.unlocks.length}`);
