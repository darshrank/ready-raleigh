// Shapes of the static files in app/public/data/ that types.ts does not cover.
// Written from the "Static data files" table in AGENTS.md.
import type { Cell, FloodRoad, Mode, Plan, ScoreResult, Site } from './types';

/** roads_graph.json: nodes are [lon, lat]; edges are [from, to, seconds, floodStep | null]. */
export interface RoadsGraph {
  nodes: [number, number][];
  edges: [number, number, number, number | null][];
}

/** hospitals.json entry. `node` indexes RoadsGraph.nodes. */
export interface Hospital {
  name: string;
  lon: number;
  lat: number;
  node: number;
}

/** flood_steps.geojson: one or more polygons per step. */
export interface FloodStepsCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { step: number };
    geometry:
      | { type: 'Polygon'; coordinates: [number, number][][] }
      | { type: 'MultiPolygon'; coordinates: [number, number][][][] };
  }[];
}

/** flood_dots.json entry: a halftone dot on a ~120 m grid, tagged with the first step that reaches it. */
export type FloodDot = [lon: number, lat: number, step: number];

/**
 * meta.json, as the pipeline writes it. Only the fields the app may show are typed; the pipeline
 * also writes p2 / p3 build details (sanity counts, methods) that stay untyped here.
 */
export interface DataMeta {
  buildDate: string;
  task: string;
  fixture?: boolean;
  sources: Record<string, string>;
  p3?: {
    thresholds: { driveSeconds: number; floodSteps: Record<string, string> };
    limitations?: string[];
  };
}

/** An existing bus stop (transit_stops.json, from the agencies' GTFS). */
export interface BusStop {
  id: string;
  name: string;
  agency: string;
  lon: number;
  lat: number;
}

/** existing_shelters.json (npm run shelters): registered shelters that protect people already. */
export interface ExistingShelters {
  built: string;
  source: { name: string; url: string; retrieved: string };
  shelters: (Site & { capacity: number; address?: string; operator?: string | null })[];
}

/** transit_stops.json as written by python -m pipeline.transit. */
export interface TransitStopsFile {
  built: string;
  sources: { agency: string; url: string; feedStart: string | null; feedEnd: string | null; expired: boolean; stops: number }[];
  /** [lon, lat, name, index into sources, id]. */
  stops: [number, number, string, number, string][];
}

export const stopsFromTransit = (t: TransitStopsFile): BusStop[] =>
  t.stops.map(([lon, lat, name, src, id]) => ({ id, name, agency: t.sources[src]?.agency ?? '', lon, lat }));

/**
 * Everything the engine reads, loaded from one data folder. The engine needs cells, sites and
 * flood roads; the rest is optional so the browser can pass only what it fetched.
 */
export interface DataBundle {
  cells: Cell[];
  sites: Site[];
  floodRoads: FloodRoad[];
  /** Registered shelters already in place: counted as protection before any plan. */
  existingShelters?: Site[];
  /** Existing bus stops: a bus pickup there costs less (BUS_STOP_ACTIVATE_COST). */
  stops?: BusStop[];
  graph?: RoadsGraph;
  hospitals?: Hospital[];
  meta?: DataMeta;
}

/** optimal_flood.json / optimal_heat.json, written by `npm run optimize`. */
export interface OptimalPlan {
  mode: Mode;
  built: string;
  budget: number;
  plan: Plan;
  score: ScoreResult;
}
