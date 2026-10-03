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

/**
 * Everything the engine reads, loaded from one data folder. The engine needs cells, sites and
 * flood roads; the rest is optional so the browser can pass only what it fetched.
 */
export interface DataBundle {
  cells: Cell[];
  sites: Site[];
  floodRoads: FloodRoad[];
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
