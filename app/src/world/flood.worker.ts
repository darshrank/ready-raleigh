// Flood worker: builds the hazard's arrival textures (and, for floods, the water's geometry) off
// the main thread (world/floodData.ts), then the city's lights (world/cityLightsData.ts), and
// hands them over as transferable buffers. Every city runs it: in San Francisco and New York the
// steps are the quake and heat zones, and the lights' blackout follows them.
import { buildFlood } from './floodData';
import { buildLights, type LightCell, type LightGraph, type LightsData } from './cityLightsData';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export interface FloodWorkerRequest {
  base: string;
  /** The lights' budget (the quality tier's). */
  lights: number;
}

const json = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.split('/').pop()}: ${res.status}`);
  return res.json();
};

self.onmessage = async (e: MessageEvent<FloodWorkerRequest>) => {
  const { base, lights: budget } = e.data;
  try {
    const t0 = performance.now();
    const data = buildFlood((await json(`${base}/flood_steps.geojson`)) as FeatureCollection<Polygon | MultiPolygon, { step: number }>);
    const ms = Math.round(performance.now() - t0);
    // The lights are decoration: if they fail, the water still comes.
    let lights: LightsData | null = null;
    let lightsMs = 0;
    try {
      const [cells, graph] = (await Promise.all([json(`${base}/cells.json`), json(`${base}/roads_graph.json`)])) as [LightCell[], LightGraph];
      const t1 = performance.now();
      lights = buildLights(cells, graph, budget);
      lightsMs = Math.round(performance.now() - t1);
    } catch (err) {
      console.warn('City lights did not build:', err);
    }
    const transfer = [data.positions, data.positions64Low, data.info, data.steps, data.indices, data.arrival, data.extent].map((a) => a.buffer);
    if (lights) transfer.push(lights.positions.buffer, lights.positions64Low.buffer, lights.info.buffer);
    (self as unknown as Worker).postMessage({ data, lights, ms, lightsMs }, transfer as Transferable[]);
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
