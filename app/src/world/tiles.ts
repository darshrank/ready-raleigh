// OpenFreeMap vector tiles for the deck.gl world layers: the same source the basemap draws.
// Tiles are fetched, parsed and turned into GPU buffers by a small pool of workers
// (world/tile.worker.ts), so a new tile costs the main thread only its upload.
import type { Solids } from './solids';
import type { TileReply, TileRequest } from './tile.worker';

/** OpenFreeMap's TileJSON: the basemap style (map/basemap.ts) and the world layers use it. */
export const TILES = 'https://tiles.openfreemap.org/planet';

let templates: Promise<string[]> | null = null;

/** The tile URL templates from the TileJSON (fetched once; the browser caches it for MapLibre too). */
export function tileTemplates(): Promise<string[]> {
  templates ??= fetch(TILES)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`TileJSON: ${r.status}`))))
    .then((j: { tiles?: string[] }) => j.tiles ?? []);
  return templates;
}

/** The highest zoom the tiles exist at; deck.gl over-zooms them past it, like MapLibre. */
export const TILE_MAX_ZOOM = 14;

// Finished tiles are handed to deck.gl at most one per animation frame, so several tiles landing
// together never stack their GPU uploads into one long frame.
const ready: (() => void)[] = [];
let draining = 0;
function drain() {
  draining = 0;
  ready.shift()?.();
  if (ready.length) draining = requestAnimationFrame(drain);
}
function handOver(fn: () => void) {
  ready.push(fn);
  if (!draining) draining = requestAnimationFrame(drain);
}

const workers: Worker[] = [];
let nextWorker = 0;
let nextId = 1;
const pending = new Map<number, (s: Solids | null) => void>();

function pool(): Worker[] {
  if (workers.length) return workers;
  const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<TileReply>) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.error) console.warn('Building tile:', e.data.error);
      if (done) handOver(() => done(e.data.solids));
    };
    workers.push(w);
  }
  return workers;
}

/** A tile's buildings as GPU-ready buffers (null if it has none, or the request was dropped). */
export function loadBuildings(url: string | null | undefined, index: { x: number; y: number; z: number }, signal?: AbortSignal): Promise<Solids | null> {
  if (!url) return Promise.resolve(null);
  const ws = pool();
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    signal?.addEventListener('abort', () => {
      pending.delete(id);
      resolve(null);
    });
    const req: TileRequest = { id, url, ...index };
    ws[nextWorker++ % ws.length]!.postMessage(req);
  });
}
