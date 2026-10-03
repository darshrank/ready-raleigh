import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { cellToLatLng } from "h3-js";
import { CITY_SCENARIOS, type ScenarioParams } from "@/config/game";
import { RoadGraph, type RoadsRaw } from "@/lib/engine/graph";
import type { CityId } from "@/types";

export interface ZoneProps {
  id: number;
  geoid: string;
  name: string;
  tract: string;
  pop: number;
  pop65: number;
  popU18: number;
  hh: number;
  hhNoVeh: number;
  pov: number;
  povUniverse: number;
  disab: number;
  lep: number;
  hhNoNet: number;
  pop65Alone: number;
  atRisk: number;
  hazardShare: number;
  floodShare: number;
  areaKm2: number;
  hvi: number | null;
  lon: number;
  lat: number;
}

export type ZoneFeature = Feature<Polygon | MultiPolygon, ZoneProps>;

/** Hazard exposure shared by origins and sites: class, distance, feature, source, value, fuel, cell. */
interface Exposure {
  fcls: number;
  fdist: number;
  fsid?: number;
  fsrc?: number;
  fv?: number;
  fb?: number;
  cell?: number;
}

export interface Origin extends Exposure {
  id: number;
  z: number;
  n: number;
  lon: number;
  lat: number;
  pop: number;
  fsid: number;
}

export interface Anchor {
  z: number;
  n: number;
  pop: number;
}

export interface Crossing {
  id: number;
  kind: "floodplain" | "culvert" | "corridor";
  label: string;
  road: string;
  stream: number;
  edges: number[];
  cls: number;
  len: number;
  lon: number;
  lat: number;
}

export interface Site extends Exposure {
  id: number;
  name: string;
  lon: number;
  lat: number;
  n: number;
  kind?: "school" | "community" | "college" | "sports" | "library";
}

export interface BusStop {
  id: number;
  name: string;
  lon: number;
  lat: number;
  n: number;
}

export interface ShieldPoint {
  id: number;
  kind: "surge" | "rain";
  lon: number;
  lat: number;
  label: string;
}

export interface DataSource {
  id: string;
  name: string;
  publisher: string;
  url: string;
  retrieved: string;
  vintage?: string;
  license?: string;
  role: string;
  limitations: string;
}

export interface CityMeta {
  city: string;
  hazard: string;
  generatedAt: string;
  bbox: [number, number, number, number];
  h3Res: number;
  hazardBufferM: number;
  counts: Record<string, number>;
  floodAreaKm2: Record<string, number>;
  sources: DataSource[];
}

export interface HazardCells {
  h3: string[];
  cls: Uint8Array;
  dist: Float32Array;
  sid: Int16Array;
  src: Uint8Array;
  /** Heat score x1000 (heat) or shaking intensity x100 (quake). */
  v: Float32Array;
  /** Fire fuel 0-100 (quake). */
  b: Float32Array;
  zone: Int32Array;
  lon: Float64Array;
  lat: Float64Array;
  index: Map<string, number>;
}

export interface CityData {
  cityId: CityId;
  cfg: ScenarioParams;
  meta: CityMeta;
  graph: RoadGraph;
  zones: ZoneProps[];
  zoneFC: FeatureCollection<Polygon | MultiPolygon, ZoneProps>;
  hazardZones: FeatureCollection;
  features: FeatureCollection;
  cells: HazardCells;
  featureNames: string[];
  origins: Origin[];
  anchors: Anchor[];
  crossings: Crossing[];
  shelters: Site[];
  hospitals: Site[];
  fire: Site[];
  busStops: BusStop[];
  shieldPoints: ShieldPoint[];
  /** Crossing id for each edge, -1 if none. */
  edgeCrossing: Int32Array;
  /** Anchor nodes in neighbourhoods with little hazard exposure: where car evacuees head. */
  safeNodes: number[];
  zoneShares: { s65: number; spov: number; snv: number }[];
}

/** Divided roads come in as one crossing per carriageway. Protecting a crossing should cover both. */
function mergeSiblingCrossings(raw: Crossing[]): Crossing[] {
  const out: Crossing[] = [];
  for (const c of raw) {
    const sib = out.find(
      (o) => o.label === c.label && o.kind === c.kind && Math.hypot((o.lon - c.lon) * 90_000, (o.lat - c.lat) * 111_000) < 400,
    );
    if (sib) {
      sib.edges.push(...c.edges);
      sib.len += c.len;
      sib.cls = Math.min(sib.cls, c.cls);
    } else {
      out.push({ ...c, id: out.length, edges: [...c.edges] });
    }
  }
  return out;
}

async function getJson<T>(url: string, fallback?: T): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Failed to load ${url}: ${res.status}`);
  }
  return (await res.json()) as T;
}

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

export async function loadCityData(cityId: CityId, base = "/data"): Promise<CityData> {
  const root = `${base}/${cityId}`;
  const [meta, roads, cellsRaw, hazardZones, features, zoneFC, origins, anchors, crossingsRaw, facilities, shieldPoints] = await Promise.all([
    getJson<CityMeta>(`${root}/meta.json`),
    getJson<RoadsRaw>(`${root}/roads.json`),
    getJson<{ res: number; cells: (string | number)[][]; features: string[] }>(`${root}/hazard_cells.json`),
    getJson<FeatureCollection>(`${root}/hazard_zones.geojson`, EMPTY_FC),
    getJson<FeatureCollection>(`${root}/features.geojson`, EMPTY_FC),
    getJson<FeatureCollection<Polygon | MultiPolygon, ZoneProps>>(`${root}/zones.geojson`),
    getJson<Origin[]>(`${root}/origins.json`),
    getJson<Anchor[]>(`${root}/anchors.json`),
    getJson<Crossing[]>(`${root}/crossings.json`),
    getJson<{ shelters: Site[]; hospitals: Site[]; fire: Site[]; busStops: BusStop[] }>(`${root}/facilities.json`),
    getJson<ShieldPoint[]>(`${root}/shields.json`, []),
  ]);

  const graph = new RoadGraph(roads);
  const n = cellsRaw.cells.length;
  const cells: HazardCells = {
    h3: new Array(n),
    cls: new Uint8Array(n),
    dist: new Float32Array(n),
    sid: new Int16Array(n),
    src: new Uint8Array(n),
    v: new Float32Array(n),
    b: new Float32Array(n),
    zone: new Int32Array(n),
    lon: new Float64Array(n),
    lat: new Float64Array(n),
    index: new Map(),
  };
  cellsRaw.cells.forEach((c, i) => {
    const h = c[0] as string;
    cells.h3[i] = h;
    cells.cls[i] = c[1] as number;
    cells.dist[i] = c[2] as number;
    cells.sid[i] = c[3] as number;
    cells.src[i] = (c[4] as number) ?? 0;
    cells.v[i] = (c[5] as number) ?? 0;
    cells.b[i] = (c[6] as number) ?? 0;
    cells.zone[i] = (c[7] as number) ?? -1;
    const [lat, lon] = cellToLatLng(h);
    cells.lat[i] = lat;
    cells.lon[i] = lon;
    cells.index.set(h, i);
  });

  const crossings = mergeSiblingCrossings(crossingsRaw);
  const edgeCrossing = new Int32Array(graph.m).fill(-1);
  for (const c of crossings) for (const e of c.edges) edgeCrossing[e] = c.id;

  const zones = zoneFC.features.map((f) => f.properties);
  // big neighborhoods span several tracts: name unnamed tracts after the nearest named one
  const named = zones.filter((z) => !z.name.startsWith("Tract "));
  for (const z of zones) {
    if (!z.name.startsWith("Tract ") || !named.length) continue;
    let best = named[0];
    let bestD = Infinity;
    for (const n of named) {
      const d = Math.hypot((n.lon - z.lon) * 0.82, n.lat - z.lat);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (bestD < 0.035) z.name = `${best.name} · ${z.tract}`;
  }
  const zoneShares = zones.map((z) => ({
    s65: z.pop > 0 ? z.pop65 / z.pop : 0,
    spov: z.povUniverse > 0 ? z.pov / z.povUniverse : 0,
    snv: z.hh > 0 ? Math.min(1, z.hhNoVeh / z.hh) : 0,
  }));
  const shares = zones.map((z) => z.hazardShare).sort((a, b) => a - b);
  const safeCut = Math.max(0.08, shares[Math.floor(shares.length * 0.3)] ?? 0.08);
  const safeNodes = anchors.filter((a) => zones[a.z].hazardShare <= safeCut).map((a) => a.n);

  return {
    cityId,
    cfg: CITY_SCENARIOS[cityId],
    meta,
    graph,
    zones,
    zoneFC,
    hazardZones,
    features,
    cells,
    featureNames: cellsRaw.features ?? [],
    origins,
    anchors,
    crossings,
    shelters: facilities.shelters,
    hospitals: facilities.hospitals,
    fire: facilities.fire,
    busStops: facilities.busStops,
    shieldPoints,
    edgeCrossing,
    safeNodes,
    zoneShares,
  };
}
