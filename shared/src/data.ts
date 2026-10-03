// Shapes of the static files in app/public/data/ that types.ts does not cover.
// Written from the "Static data files" table in AGENTS.md.

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

/** meta.json */
export interface DataMeta {
  built: string;
  fixture: boolean;
  sources: string[];
  thresholds: Record<string, number>;
}
