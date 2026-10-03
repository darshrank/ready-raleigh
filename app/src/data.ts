import { useEffect, useState } from 'react';
import type { Cell, Site } from '@shared/types';
import type { FloodStepsCollection } from '@shared/data';

/** Where the static data lives. Fixtures until the pipeline writes the real files to /data. */
export const DATA_BASE: string = import.meta.env.VITE_DATA_BASE ?? '/data/fixtures';

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export interface MapData {
  cells: Cell[];
  sites: Site[];
  floodSteps: FloodStepsCollection;
}

// One fetch per page load, shared by every route.
let mapData: Promise<MapData> | null = null;

export function loadMapData(): Promise<MapData> {
  mapData ??= Promise.all([
    getJson<Cell[]>('cells.json'),
    getJson<Site[]>('sites.json'),
    getJson<FloodStepsCollection>('flood_steps.geojson'),
  ]).then(([cells, sites, floodSteps]) => ({ cells, sites, floodSteps }));
  mapData.catch(() => (mapData = null)); // let a later mount retry
  return mapData;
}

export function useMapData() {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadMapData().then(
      (d) => live && setData(d),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  return { data, error };
}
