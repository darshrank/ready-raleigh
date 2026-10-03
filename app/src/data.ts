import type { Cell } from '@shared/types';

/** Where the static data lives. Fixtures until the pipeline writes the real files to /data. */
export const DATA_BASE: string = import.meta.env.VITE_DATA_BASE ?? '/data/fixtures';

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const loadCells = () => getJson<Cell[]>('cells.json');
