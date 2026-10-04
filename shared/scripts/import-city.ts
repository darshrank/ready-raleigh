// Import a city pack built on the feat/ready-raleigh-adit branch (data-prep/build_city.py: real OSM
// drive network, ACS 2023 tracts, FEMA NFHL / USGS-ABAG liquefaction / NYC Heat Vulnerability) into
// this repo's static data contracts (AGENTS.md "Static data files"), so the same engine plays the
// other city packs. Hazards map onto the engine's three steps:
//   flood (Miami):          1 coastal high hazard (VE), 2 the 1% annual chance zone, 3 the 0.2% zone
//   quake (San Francisco):  High liquefaction ground only, failing in order of shaking (MMI 9.0,
//                           8.8, 8.6): the whole city shakes, the filled land is where people must leave
//   heat (New York City):   the highest heat vulnerability class only, hottest blocks first; cooling
//                           sites in the hottest blocks lose power at step 2 (the grid failure)
// Usage: npx tsx shared/scripts/import-city.ts <city> <packDir> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellsToMultiPolygon, cellToLatLng, cellToParent, getResolution, latLngToCell, polygonToCells } from 'h3-js';
import { SHELTER_DRIVE_LIMIT_S } from '../src/config';
import type { DataMeta, FloodDot, FloodStepsCollection, Hospital, RoadsGraph } from '../src/data';
import type { Cell, FloodRoad, Site } from '../src/types';

type Hazard = 'flood' | 'quake' | 'heat';
const HAZARD: Record<string, Hazard> = { miami: 'flood', 'san-francisco': 'quake', 'new-york': 'heat' };
const STEP_NAMES: Record<Hazard, Record<string, string>> = {
  flood: { 1: 'Coastal high hazard zone (FEMA VE)', 2: '1% annual chance flood zone', 3: '0.2% annual chance flood zone' },
  quake: { 1: 'High liquefaction, violent shaking (MMI 9)', 2: 'High liquefaction, MMI 8.8', 3: 'High liquefaction, MMI 8.6' },
  heat: { 1: 'Hottest blocks (heat score 0.86 and up)', 2: 'Very hot blocks (0.80 to 0.86)', 3: 'Hot blocks (0.75 to 0.80)' },
};
const RES = 9;
const MAX_ROADS = 50;
const MAX_SITES = 220;
/** A cell takes the first step at which this share of its area is in the hazard (as the Raleigh pipeline). */
const STEP_SHARE = 0.2;

const [city, packDir, outDir] = process.argv.slice(2);
if (!city || !packDir || !outDir || !HAZARD[city]) {
  console.error('usage: import-city.ts <miami|san-francisco|new-york> <packDir> <outDir>');
  process.exit(1);
}
const hazard = HAZARD[city]!;
const read = <T>(f: string): T => JSON.parse(readFileSync(join(packDir, f), 'utf8')) as T;
const round5 = (x: number) => Math.round(x * 1e5) / 1e5;
const log = (m: string) => console.log(`[${city}] ${m}`);

// ------------------------------------------------------------------ inputs
interface RoadsRaw {
  nodes: number[];
  edges: { u: number[]; v: number[]; tt: number[]; oneway: number[]; bridge?: number[]; name: number[] };
  geom: number[][];
  names: string[];
}
interface Zone {
  name: string;
  tract: string;
  pop: number;
  pop65: number;
  hhNoVeh: number;
  pov: number;
  lon: number;
  lat: number;
}
interface Facility {
  name: string;
  lon: number;
  lat: number;
  n: number;
  kind?: string;
}
interface Crossing {
  label: string;
  road: string;
  edges: number[];
  lon: number;
  lat: number;
}
type Geo = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

const roads = read<RoadsRaw>('roads.json');
const zonesFC = read<{ features: { properties: Zone; geometry: Geo }[] }>('zones.geojson');
const hazardCells = read<{ res: number; cells: (string | number)[][] }>('hazard_cells.json');
const hazardZones = read<{ features: { properties: { cls: number }; geometry: Geo }[] }>('hazard_zones.geojson');
const facilities = read<{ shelters: Facility[]; hospitals: Facility[] }>('facilities.json');
const crossingsRaw = read<Crossing[]>('crossings.json');
const oldMeta = read<{ sources: { name: string; url: string; publisher: string }[]; generatedAt: string }>('meta.json');

// ------------------------------------------------------------------ hazard steps on the pack's fine cells
const fineRes = hazardCells.res;
const fineStep = new Map<string, number>();
for (const row of hazardCells.cells) {
  const [h, cls, , , , v] = row as [string, number, number, number, number, number];
  let step: number | null = null;
  // v is shaking (MMI x 100) for the quake and the heat score (x 1000) for heat.
  if (hazard === 'quake') step = cls === 1 ? (v >= 900 ? 1 : v >= 880 ? 2 : 3) : null;
  else if (hazard === 'heat') step = cls === 1 ? (v >= 856 ? 1 : v >= 798 ? 2 : 3) : null;
  else if (cls >= 1 && cls <= 3) step = cls;
  if (step !== null) fineStep.set(h, step);
}
const stepAtPoint = (lon: number, lat: number) => fineStep.get(latLngToCell(lat, lon, fineRes)) ?? null;
log(`${fineStep.size} hazard cells at res ${fineRes}`);

// ------------------------------------------------------------------ the drive graph
const nNodes = roads.nodes.length / 2;
const nodeLon = (k: number) => roads.nodes[2 * k]!;
const nodeLat = (k: number) => roads.nodes[2 * k + 1]!;
const m = roads.edges.u.length;
// A road closes at the first step that covers most of it. Raleigh's creek corridors are narrow, so
// "touches the zone" means "crosses the water" there; these zones are broad, and a street that only
// clips one stays passable.
const EDGE_SHARE = 0.5;
const edgeStep = new Array<number | null>(m).fill(null);
for (let e = 0; e < m; e++) {
  if (hazard === 'heat' || (hazard === 'flood' && roads.edges.bridge?.[e])) continue;
  const g = roads.geom[e]!;
  const samples: (number | null)[] = [];
  for (let k = 0; k + 1 < g.length; k += 2) {
    samples.push(stepAtPoint(g[k]!, g[k + 1]!));
    if (k + 3 < g.length) samples.push(stepAtPoint((g[k]! + g[k + 2]!) / 2, (g[k + 1]! + g[k + 3]!) / 2));
  }
  for (let step = 1; step <= 3; step++) {
    if (samples.filter((s) => s !== null && s <= step).length >= EDGE_SHARE * samples.length) {
      edgeStep[e] = step;
      break;
    }
  }
}

/** Directed arcs. A two-way street is two arcs. */
const arcs: { from: number; to: number; secs: number; edge: number }[] = [];
for (let e = 0; e < m; e++) {
  const secs = Math.max(0.5, roads.edges.tt[e]!);
  arcs.push({ from: roads.edges.u[e]!, to: roads.edges.v[e]!, secs, edge: e });
  if (!roads.edges.oneway[e]) arcs.push({ from: roads.edges.v[e]!, to: roads.edges.u[e]!, secs, edge: e });
}
/** Reverse adjacency: arcs that arrive at each node, so a search from a destination finds everyone who can drive to it. */
const revStart = new Int32Array(nNodes + 1);
for (const a of arcs) revStart[a.to + 1]!++;
for (let k = 0; k < nNodes; k++) revStart[k + 1]! += revStart[k]!;
const revArc = new Int32Array(arcs.length);
{
  const fill = revStart.slice(0, nNodes);
  arcs.forEach((a, i) => (revArc[fill[a.to]!++] = i));
}
const openAtEnd = (edge: number) => edgeStep[edge] === null;

/** Seconds from every node to the nearest of `targets`, over arcs `allowed`, up to `limit`. */
function driveTo(targets: number[], allowed: (edge: number) => boolean, limit = Infinity): Float64Array {
  const dist = new Float64Array(nNodes).fill(Infinity);
  const heap: [number, number][] = [];
  const push = (d: number, k: number) => {
    heap.push([d, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < heap.length && heap[l]![0] < heap[s]![0]) s = l;
        if (r < heap.length && heap[r]![0] < heap[s]![0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i]!, heap[s]!];
        i = s;
      }
    }
    return top;
  };
  for (const t of targets) {
    dist[t] = 0;
    push(0, t);
  }
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]! || d > limit) continue;
    for (let j = revStart[k]!; j < revStart[k + 1]!; j++) {
      const a = arcs[revArc[j]!]!;
      if (!allowed(a.edge)) continue;
      const nd = d + a.secs;
      if (nd < dist[a.from]! && nd <= limit) {
        dist[a.from] = nd;
        push(nd, a.from);
      }
    }
  }
  return dist;
}

/** Nearest graph node to a point (a coarse grid of node buckets). */
const GRID = 0.004;
const buckets = new Map<string, number[]>();
for (let k = 0; k < nNodes; k++) {
  const key = `${Math.floor(nodeLon(k) / GRID)},${Math.floor(nodeLat(k) / GRID)}`;
  (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(k);
}
function nearestNode(lon: number, lat: number): number {
  const gx = Math.floor(lon / GRID);
  const gy = Math.floor(lat / GRID);
  for (let r = 1; r <= 12; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (const k of buckets.get(`${gx + dx},${gy + dy}`) ?? []) {
          const d = ((nodeLon(k) - lon) * Math.cos((lat * Math.PI) / 180)) ** 2 + (nodeLat(k) - lat) ** 2;
          if (d < bestD) [best, bestD] = [k, d];
        }
    if (best >= 0) return best;
  }
  return 0;
}

// ------------------------------------------------------------------ cells: tracts spread over res-9 cells
const zones = zonesFC.features;
const named = zones.filter((z) => !z.properties.name.startsWith('Tract '));
const baseName = (n: string) => n.replace(/ · .*$/, '');
function hoodOf(z: Zone): string {
  if (!z.name.startsWith('Tract ')) return baseName(z.name);
  let best: Zone | null = null;
  let bestD = Infinity;
  for (const o of named) {
    const d = Math.hypot((o.properties.lon - z.lon) * 0.85, o.properties.lat - z.lat);
    if (d < bestD) [best, bestD] = [o.properties, d];
  }
  return best && bestD < 0.06 ? baseName(best.name) : z.name;
}

const polys = (g: Geo) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const cellZone = new Map<string, number>();
const zoneCells: string[][] = zones.map(() => []);
zones.forEach((z, zi) => {
  for (const poly of polys(z.geometry)) {
    for (const h of polygonToCells(poly as number[][][], RES, true)) {
      if (cellZone.has(h)) continue;
      cellZone.set(h, zi);
      zoneCells[zi]!.push(h);
    }
  }
  if (!zoneCells[zi]!.length && z.properties.pop > 0) {
    const h = latLngToCell(z.properties.lat, z.properties.lon, RES);
    if (!cellZone.has(h)) cellZone.set(h, zi);
    zoneCells[zi]!.push(h);
  }
});

// Hazard share per res-9 cell from its fine children.
const childCount = 7 ** (fineRes - RES);
const stepCounts = new Map<string, [number, number, number]>();
for (const [h, s] of fineStep) {
  const p = cellToParent(h, RES);
  const c = stepCounts.get(p) ?? [0, 0, 0];
  c[s - 1]!++;
  stepCounts.set(p, c);
}

const h3List = [...cellZone.keys()].sort();
const cellIndex = new Map(h3List.map((h, i) => [h, i]));
const cells: Cell[] = h3List.map((h, i) => {
  const zi = cellZone.get(h)!;
  const z = zones[zi]!.properties;
  const share = 1 / Math.max(1, zoneCells[zi]!.length);
  const counts = stepCounts.get(h) ?? [0, 0, 0];
  let cum = 0;
  let floodStep: number | null = null;
  for (let k = 0; k < 3; k++) {
    cum += counts[k]! / childCount;
    if (floodStep === null && cum >= STEP_SHARE - 1e-9) floodStep = k + 1;
  }
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return {
    i,
    h3: h,
    hood: hoodOf(z),
    pop: r6(z.pop * share),
    pop65: r6(Math.min(z.pop65, z.pop) * share),
    lowInc: r6(z.pov * share),
    noCarHH: r6(z.hhNoVeh * share),
    floodStep,
    floodFrac: Math.min(1, r6(cum)),
    cutOff: false,
    heatC: 0,
    treePct: 0,
  };
});
const cellNode = cells.map((c) => {
  const [lat, lon] = cellToLatLng(c.h3);
  return nearestNode(lon, lat);
});
log(`${cells.length} cells, ${Math.round(cells.reduce((s, c) => s + c.pop, 0)).toLocaleString()} residents`);

// Cut off: a dry route to a hospital exists, none is left at the final step.
const hospitalNodes = facilities.hospitals.map((h) => h.n);
const dryReach = driveTo(hospitalNodes, () => true);
const endReach = driveTo(hospitalNodes, openAtEnd);
if (hazard !== 'heat')
  cells.forEach((c, i) => {
    c.cutOff = Number.isFinite(dryReach[cellNode[i]!]!) && !Number.isFinite(endReach[cellNode[i]!]!);
  });
const atRisk = (i: number) => cells[i]!.floodStep !== null || cells[i]!.cutOff;
const atRiskList = cells.map((_, i) => i).filter(atRisk);
log(`${atRiskList.length} at-risk cells, ${cells.filter((c) => c.cutOff).length} cut off`);

// ------------------------------------------------------------------ shelter sites with drive catchments
function catchment(node: number, allowed: (edge: number) => boolean) {
  const dist = driveTo([node], allowed, SHELTER_DRIVE_LIMIT_S);
  const hits = atRiskList
    .map((i) => ({ i, t: dist[cellNode[i]!]! }))
    .filter((x) => Number.isFinite(x.t) && x.t <= SHELTER_DRIVE_LIMIT_S)
    .sort((a, b) => a.t - b.t || a.i - b.i);
  return { cells: hits.map((x) => x.i), ms: hits.map((x) => Math.min(SHELTER_DRIVE_LIMIT_S * 1000, Math.round(x.t * 1000))) };
}
let sites: Site[] = [];
facilities.shelters.forEach((f, k) => {
  const cell = cellIndex.get(latLngToCell(f.lat, f.lon, RES));
  if (cell === undefined) return;
  let floodStep = stepAtPoint(f.lon, f.lat);
  // Heat: the hottest blocks lose power in the grid failure, and so do their cooling sites.
  if (hazard === 'heat') floodStep = floodStep === 1 ? 2 : null;
  const dry = catchment(f.n, () => true);
  if (!dry.cells.length) return;
  const wet = hazard === 'heat' ? dry : catchment(f.n, openAtEnd);
  sites.push({
    id: `${city}-site-${k}`,
    name: f.name,
    kind: f.kind ?? 'building',
    lon: round5(f.lon),
    lat: round5(f.lat),
    cell,
    floodStep,
    coverDry: dry.cells,
    coverFlood: wet.cells,
    driveDry: dry.ms,
    driveFlood: wet.ms,
  });
});
if (sites.length > MAX_SITES) sites = [...sites].sort((a, b) => b.coverDry.length - a.coverDry.length).slice(0, MAX_SITES);
log(`${sites.length} shelter sites (${sites.filter((s) => s.floodStep !== null).length} in the hazard)`);

// ------------------------------------------------------------------ road protection candidates
const weighted = (c: Cell) => c.pop + c.pop65 + c.lowInc + 2.5 * c.noCarHH;
const merged: Crossing[] = [];
for (const c of crossingsRaw) {
  const sib = merged.find((o) => o.label === c.label && Math.hypot((o.lon - c.lon) * 90_000, (o.lat - c.lat) * 111_000) < 400);
  if (sib) sib.edges.push(...c.edges);
  else merged.push({ ...c, edges: [...c.edges] });
}
const cutCells = cells.map((c, i) => (c.cutOff ? i : -1)).filter((i) => i >= 0);
const candidates: (FloodRoad & { w: number })[] = [];
for (const c of merged) {
  const steps = c.edges.map((e) => edgeStep[e]).filter((s): s is number => s !== null);
  if (!steps.length) continue;
  const held = new Set(c.edges);
  const reach = driveTo(hospitalNodes, (e) => openAtEnd(e) || held.has(e));
  const unlocks = cutCells.filter((i) => Number.isFinite(reach[cellNode[i]!]!));
  if (!unlocks.length) continue;
  const longest = c.edges.reduce((a, b) => (roads.geom[b]!.length > roads.geom[a]!.length ? b : a));
  const g = roads.geom[longest]!;
  const coords: [number, number][] = [];
  for (let k = 0; k + 1 < g.length; k += 2) coords.push([round5(g[k]!), round5(g[k + 1]!)]);
  if (coords.length < 2) continue;
  candidates.push({ id: '', name: c.road || c.label, floodStep: Math.min(...steps), coords, unlocks, w: unlocks.reduce((s, i) => s + weighted(cells[i]!), 0) });
}
const floodRoads: FloodRoad[] = candidates
  .sort((a, b) => b.w - a.w)
  .slice(0, MAX_ROADS)
  .map(({ w: _w, ...r }, k) => ({ ...r, id: `road-${String(k).padStart(4, '0')}` }));
log(`${floodRoads.length} road protection candidates of ${merged.length} crossings`);

// ------------------------------------------------------------------ the other files
const hospitals: Hospital[] = facilities.hospitals.map((h) => ({ name: h.name, lon: round5(h.lon), lat: round5(h.lat), node: h.n }));
const graph: RoadsGraph = {
  nodes: Array.from({ length: nNodes }, (_, k) => [round5(nodeLon(k)), round5(nodeLat(k))]),
  edges: arcs.map((a) => [a.from, a.to, Math.round(a.secs * 10) / 10, edgeStep[a.edge]!]),
};

const stepsFC: FloodStepsCollection = { type: 'FeatureCollection', features: [] };
const round = (rings: number[][][]) => rings.map((r) => r.map(([x, y]) => [round5(x!), round5(y!)] as [number, number]));
// The pack's FEMA polygons are smoother than cell outlines; the quake and heat steps split classes, so they use cells.
for (const f of hazard === 'flood' ? hazardZones.features : []) {
  const step = f.properties.cls >= 1 && f.properties.cls <= 3 ? f.properties.cls : null;
  if (step === null) continue;
  if (f.geometry.type === 'Polygon') stepsFC.features.push({ type: 'Feature', properties: { step }, geometry: { type: 'Polygon', coordinates: round(f.geometry.coordinates) } });
  else stepsFC.features.push({ type: 'Feature', properties: { step }, geometry: { type: 'MultiPolygon', coordinates: f.geometry.coordinates.map(round) } });
}
// Steps the pack has no polygons for (shaking, heat): the fine hazard cells, outlined.
for (const step of [1, 2, 3]) {
  if (stepsFC.features.some((f) => f.properties.step === step)) continue;
  const hs = [...fineStep].filter(([, s]) => s === step).map(([h]) => h);
  if (!hs.length) continue;
  const mp = cellsToMultiPolygon(hs, true) as number[][][][];
  stepsFC.features.push({ type: 'Feature', properties: { step }, geometry: { type: 'MultiPolygon', coordinates: mp.map(round) } });
}

const dots: FloodDot[] = cells.filter((c) => c.floodStep !== null).map((c) => {
  const [lat, lon] = cellToLatLng(c.h3);
  return [round5(lon), round5(lat), c.floodStep!];
});

const meta: DataMeta & Record<string, unknown> = {
  buildDate: new Date().toISOString(),
  task: `import-city ${city}: pack from feat/ready-raleigh-adit (built ${oldMeta.generatedAt}) mapped onto the engine's contracts`,
  sources: Object.fromEntries(oldMeta.sources.map((s) => [s.name, `${s.publisher}: ${s.url}`])),
  p3: {
    thresholds: { driveSeconds: SHELTER_DRIVE_LIMIT_S, floodSteps: STEP_NAMES[hazard] },
    limitations: [
      'Census tract counts are spread evenly over the H3 cells of each tract.',
      `Hazard steps are a game mapping of the source layers (${hazard}); they are not a forecast.`,
    ],
  },
  city,
  hazard,
};

mkdirSync(outDir, { recursive: true });
const write = (f: string, v: unknown) => writeFileSync(join(outDir, f), JSON.stringify(v));
write('cells.json', cells);
write('sites.json', sites);
write('flood_roads.json', floodRoads);
write('hospitals.json', hospitals);
write('roads_graph.json', graph);
write('flood_steps.geojson', stepsFC);
write('flood_dots.json', dots);
write('meta.json', meta);
log(`written to ${outDir}; check res ${getResolution(cells[0]!.h3)}`);
