// Registered emergency shelters that already exist (FEMA National Shelter System), with the same
// drive-time catchments the pipeline computes for candidate sites, so the engine can count them as
// protection before the player spends anything.
//
//   npm run shelters               # writes existing_shelters.json into the data folder
//   npm run shelters -- --check    # compares this catchment method with the pipeline's sites.json
//
// Method (mirrors pipeline/flood.py cover_one): each cell center and each shelter snaps to its
// nearest road graph node; Dijkstra runs from the shelter over reversed arcs (cell -> shelter
// travel), parallel arcs at their minimum time, up to 900 s. The flooded graph drops arcs with a
// flood step of 3 or less. Only at-risk cells are kept, nearest first, times in integer ms.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { SHELTER_DRIVE_LIMIT_S } from '../src/config';
import type { FloodStepsCollection, RoadsGraph } from '../src/data';
import { atRiskMask } from '../src/engine';
import type { Site } from '../src/types';
import { dataDir, loadBundle } from './bundle';
import { readFileSync } from 'node:fs';

const NSS = 'https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/FeatureServer/5/query';
const M_PER_DEG = 111_320;

const dir = resolve(process.env.INIT_CWD ?? process.cwd(), dataDir());
const data = loadBundle(dir);
const graph: RoadsGraph = data.graph ?? (() => { throw new Error('roads_graph.json is required'); })();
const flood = JSON.parse(readFileSync(join(dir, 'flood_steps.geojson'), 'utf8')) as FloodStepsCollection;
const { cells } = data;
const atRisk = atRiskMask('flood', cells);

// ---- nearest graph node (grid buckets of ~1 km) ----
const CELL_DEG = 0.01;
const k0 = Math.cos((35.8 * Math.PI) / 180);
const bucketKey = (lon: number, lat: number) => `${Math.floor(lon / CELL_DEG)},${Math.floor(lat / CELL_DEG)}`;
const buckets = new Map<string, number[]>();
graph.nodes.forEach(([lon, lat], i) => {
  const key = bucketKey(lon, lat);
  (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(i);
});
function nearestNode(lon: number, lat: number): number {
  const bx = Math.floor(lon / CELL_DEG), by = Math.floor(lat / CELL_DEG);
  let best = -1, bestD = Infinity;
  for (let r = 0; r < 6 && (best < 0 || r < 2); r++) {
    for (let x = bx - r; x <= bx + r; x++) {
      for (let y = by - r; y <= by + r; y++) {
        if (Math.max(Math.abs(x - bx), Math.abs(y - by)) !== r) continue;
        for (const i of buckets.get(`${x},${y}`) ?? []) {
          const [nx, ny] = graph.nodes[i]!;
          const d = ((nx - lon) * k0) ** 2 + (ny - lat) ** 2;
          if (d < bestD) [best, bestD] = [i, d];
        }
      }
    }
  }
  return best;
}
const cellNodes = cells.map((c) => {
  const [lat, lon] = cellToLatLng(c.h3);
  return nearestNode(lon, lat);
});

// ---- reversed adjacency, dry and flooded ----
function reversed(dropFlooded: boolean) {
  const best = new Map<string, number>();
  for (const [u, v, seconds, step] of graph.edges) {
    if (dropFlooded && step !== null && step <= 3) continue;
    const key = `${v},${u}`;
    best.set(key, Math.min(seconds, best.get(key) ?? Infinity));
  }
  const adj: [number, number][][] = graph.nodes.map(() => []);
  for (const [key, seconds] of best) {
    const [from, to] = key.split(',').map(Number) as [number, number];
    adj[from]!.push([to, seconds]);
  }
  return adj;
}
const dryRev = reversed(false);
const floodRev = reversed(true);

/** Seconds from every node to `source` (on reversed arcs), up to `limit`. */
function dijkstra(adj: [number, number][][], source: number, limit: number): Map<number, number> {
  const dist = new Map<number, number>([[source, 0]]);
  const heap: [number, number][] = [[0, source]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const [v, w] of adj[u]!) {
      const nd = d + w;
      if (nd <= limit && nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        push([nd, v]);
      }
    }
  }
  return dist;
}

function catchment(lon: number, lat: number) {
  const node = nearestNode(lon, lat);
  const out: Pick<Site, 'coverDry' | 'driveDry' | 'coverFlood' | 'driveFlood'> = { coverDry: [], driveDry: [], coverFlood: [], driveFlood: [] };
  for (const [suffix, adj] of [['Dry', dryRev], ['Flood', floodRev]] as const) {
    const dist = dijkstra(adj, node, SHELTER_DRIVE_LIMIT_S);
    const hits: [number, number][] = [];
    cellNodes.forEach((n, i) => {
      const s = dist.get(n);
      if (s !== undefined && s <= SHELTER_DRIVE_LIMIT_S && atRisk[i]) hits.push([i, Math.round(s * 1000)]);
    });
    hits.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    out[`cover${suffix}`] = hits.map((h) => h[0]);
    out[`drive${suffix}`] = hits.map((h) => h[1]);
  }
  return out;
}

// ---- first flood step that reaches a point ----
function inRing(lon: number, lat: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function floodStepAt(lon: number, lat: number): number | null {
  let step: number | null = null;
  for (const f of flood.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) {
      if (inRing(lon, lat, rings[0]!) && !rings.slice(1).some((h) => inRing(lon, lat, h))) {
        step = step === null ? f.properties.step : Math.min(step, f.properties.step);
      }
    }
  }
  return step;
}

const cellOfH3 = new Map(cells.map((c, i) => [c.h3, i]));
function cellAt(lon: number, lat: number): number {
  const i = cellOfH3.get(latLngToCell(lat, lon, 9));
  if (i !== undefined) return i;
  let best = 0, bestD = Infinity;
  cells.forEach((c, k) => {
    const [y, x] = cellToLatLng(c.h3);
    const d = ((x - lon) * k0) ** 2 + (y - lat) ** 2;
    if (d < bestD) [best, bestD] = [k, d];
  });
  return best;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bLds\b/, 'LDS');

if (process.argv.includes('--check')) {
  // Same method on the pipeline's own candidate sites: how close are the catchments?
  let jaccard = 0, n = 0;
  for (const site of data.sites.slice(0, 30)) {
    const mine = catchment(site.lon, site.lat);
    for (const key of ['coverDry', 'coverFlood'] as const) {
      const a = new Set(site[key]), b = new Set(mine[key]);
      const inter = [...a].filter((x) => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      jaccard += union ? inter / union : 1;
      n++;
    }
  }
  console.log(`catchment agreement with the pipeline on 30 sites: mean Jaccard ${(jaccard / n).toFixed(3)}`);
  process.exit(0);
}

let w = Infinity, s = Infinity, e = -Infinity, nth = -Infinity;
for (const c of cells) {
  const [lat, lon] = cellToLatLng(c.h3);
  w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); nth = Math.max(nth, lat);
}
const params = new URLSearchParams({
  where: 'evacuation_capacity > 0',
  geometry: [w, s, e, nth].map((v) => v.toFixed(5)).join(','),
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
  outFields: 'shelter_id,shelter_name,address_1,city,facility_usage_code,evacuation_capacity,latitude,longitude,org_organization_name',
  returnGeometry: 'false',
  f: 'json',
});
const res = await fetch(`${NSS}?${params}`, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) throw new Error(`FEMA NSS: HTTP ${res.status}`);
const body = (await res.json()) as { features?: { attributes: Record<string, string | number | null> }[]; error?: unknown };
if (!body.features) throw new Error(`FEMA NSS: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);

const shelters = body.features.map(({ attributes: a }) => {
  const lon = Number(a.longitude), lat = Number(a.latitude);
  return {
    id: `fema-${a.shelter_id}`,
    name: titleCase(String(a.shelter_name ?? 'Shelter')),
    kind: 'registered shelter',
    lon: Math.round(lon * 1e5) / 1e5,
    lat: Math.round(lat * 1e5) / 1e5,
    cell: cellAt(lon, lat),
    floodStep: floodStepAt(lon, lat),
    capacity: Number(a.evacuation_capacity),
    address: `${a.address_1 ?? ''}, ${titleCase(String(a.city ?? ''))}`.replace(/^, /, ''),
    operator: a.org_organization_name ? titleCase(String(a.org_organization_name)) : null,
    ...catchment(lon, lat),
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const out = {
  built: new Date().toISOString(),
  source: { name: 'FEMA National Shelter System (Shelter Locations)', url: NSS.replace('/query', ''), retrieved: new Date().toISOString().slice(0, 10) },
  note: 'Registered evacuation shelters with an evacuation capacity. Catchments mirror pipeline/flood.py (15 min, nearest road node).',
  shelters,
};
const file = join(dir, 'existing_shelters.json');
writeFileSync(file, JSON.stringify(out) + '\n');
for (const sh of shelters) {
  console.log(`${sh.name}: ${sh.capacity} people, ${sh.coverDry.length}/${sh.coverFlood.length} at-risk cells (dry/flood)${sh.floodStep ? `, floods at step ${sh.floodStep}` : ''}`);
}
console.log(`wrote ${shelters.length} shelters, ${shelters.reduce((t, x) => t + x.capacity, 0)} seats -> ${file}`);
