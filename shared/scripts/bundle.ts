// Node-side loading of a data folder into a DataBundle (the engine itself does no I/O).
//
// Folder: DATA_DIR if set (a filesystem path), else app/public + VITE_DATA_BASE (the same URL path
// the app fetches from), else the fixtures. Reads the repo's .env if there is one.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataBundle, DataMeta, Hospital, RoadsGraph } from '../src/data';
import type { Cell, FloodRoad, Site } from '../src/types';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURES_DIR = join(ROOT, 'shared/fixtures');

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env === process.env && existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
  if (env.DATA_DIR) return env.DATA_DIR;
  if (!env.VITE_DATA_BASE) return FIXTURES_DIR;
  const base = env.VITE_DATA_BASE;
  if (/^[a-z]+:\/\//i.test(base)) {
    throw new Error(`VITE_DATA_BASE is a URL (${base}); set DATA_DIR to a local folder instead`);
  }
  return join(ROOT, 'app/public', base);
}

export function loadBundle(dir: string): DataBundle {
  const read = <T>(file: string): T => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
  const maybe = <T>(file: string): T | undefined => (existsSync(join(dir, file)) ? read<T>(file) : undefined);
  return {
    cells: read<Cell[]>('cells.json'),
    sites: read<Site[]>('sites.json'),
    floodRoads: read<FloodRoad[]>('flood_roads.json'),
    graph: maybe<RoadsGraph>('roads_graph.json'),
    hospitals: maybe<Hospital[]>('hospitals.json'),
    meta: maybe<DataMeta>('meta.json'),
  };
}
