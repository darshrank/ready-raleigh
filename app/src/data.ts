import { useEffect, useState } from 'react';
import type { Cell, FloodRoad, Site } from '@shared/types';
import type { DataBundle, Hospital } from '@shared/data';
import { dataBase } from './story';

async function getJson<T>(base: string, file: string): Promise<T> {
  const res = await fetch(`${base}/${file}`);
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

// One fetch per city per page load, shared by every route.
const cache = new Map<string, Promise<MapData>>();

export function loadMapData(base = dataBase()): Promise<MapData> {
  let p = cache.get(base);
  if (!p) {
    p = Promise.all([
      getJson<Cell[]>(base, 'cells.json'),
      getJson<Site[]>(base, 'sites.json'),
      getJson<FloodRoad[]>(base, 'flood_roads.json'),
      getJson<Hospital[]>(base, 'hospitals.json'),
    ]).then(([cells, sites, floodRoads, hospitals]) => ({ cells, sites, floodRoads, hospitals }));
    p.catch(() => cache.delete(base)); // let a later mount retry
    cache.set(base, p);
  }
  return p;
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
