import { useEffect, useState } from 'react';
import type { Cell, FloodRoad, Site } from '@shared/types';
import type { DataBundle, Hospital } from '@shared/data';

/** Where the static data lives: the real pipeline output, or /data/fixtures for the small test set. */
export const DATA_BASE: string = import.meta.env.VITE_DATA_BASE || '/data';

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/**
 * Everything the map and the engine read. It is the engine's DataBundle too: the engine caches its
 * index by object identity, so this object is built once per page load and never changed.
 */
export interface MapData extends DataBundle {
  hospitals: Hospital[];
}

// One fetch per page load, shared by every route.
let mapData: Promise<MapData> | null = null;

export function loadMapData(): Promise<MapData> {
  mapData ??= Promise.all([
    getJson<Cell[]>('cells.json'),
    getJson<Site[]>('sites.json'),
    getJson<FloodRoad[]>('flood_roads.json'),
    getJson<Hospital[]>('hospitals.json'),
  ]).then(([cells, sites, floodRoads, hospitals]) => ({ cells, sites, floodRoads, hospitals }));
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
