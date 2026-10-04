// Flood worker: builds the storm water's geometry and arrival textures off the main thread
// (world/floodData.ts) and hands them over as transferable buffers.
import { buildFlood } from './floodData';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

self.onmessage = async (e: MessageEvent<{ url: string }>) => {
  try {
    const res = await fetch(e.data.url);
    if (!res.ok) throw new Error(`flood_steps.geojson: ${res.status}`);
    const t0 = performance.now();
    const data = buildFlood((await res.json()) as FeatureCollection<Polygon | MultiPolygon, { step: number }>);
    const ms = Math.round(performance.now() - t0);
    const transfer = [data.positions, data.positions64Low, data.info, data.steps, data.indices, data.arrival, data.extent].map((a) => a.buffer);
    (self as unknown as Worker).postMessage({ data, ms }, transfer as Transferable[]);
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
