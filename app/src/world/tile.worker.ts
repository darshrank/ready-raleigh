// Tile worker: fetches an OpenFreeMap vector tile, parses its buildings and turns them into GPU
// buffers (world/solids.ts), clipped to the tile, so the main thread only uploads them.
import { MVTLoader } from '@loaders.gl/mvt';
import type { BinaryFeatureCollection } from '@loaders.gl/schema';
import { buildSolids, seedOf, type SolidPart, type Solids } from './solids';

export interface TileRequest {
  id: number;
  url: string;
  x: number;
  y: number;
  z: number;
}
export type TileReply = { id: number; solids: Solids | null; error?: string };

/** Every building stands at least this tall (the tiles leave small ones at 0). */
const MIN_HEIGHT_M = 6;

const tileLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

function* parts(data: BinaryFeatureCollection, x: number, y: number, z: number): Generator<SolidPart> {
  const P = data.polygons;
  if (!P || !P.positions.value.length) return;
  const xy = P.positions.value;
  const size = P.positions.size;
  const polyStart = P.polygonIndices.value;
  const ringStart = P.primitivePolygonIndices.value;
  const tris = P.triangles?.value ?? new Uint32Array(0);
  const heights = P.numericProps.render_height?.value;
  const fid = P.featureIds.value;
  const props = P.properties as { hide_3d?: boolean }[];
  // Local tile coordinates (0..1, y down) to longitude and latitude, in doubles.
  const lng = (i: number) => tileLng(x + xy[i * size]!, z);
  const lat = (i: number) => tileLat(y + xy[i * size + 1]!, z);
  let r = 0;
  let t = 0;
  for (let p = 0; p + 1 < polyStart.length; p++) {
    const v0 = polyStart[p]!;
    const v1 = polyStart[p + 1]!;
    const rings: Float64Array[] = [];
    while (r + 1 < ringStart.length && ringStart[r]! < v1) {
      const a = ringStart[r]!;
      const b = ringStart[r + 1]!;
      if (a >= v0) {
        const ring = new Float64Array(2 * (b - a));
        for (let i = a; i < b; i++) {
          ring[2 * (i - a)] = lng(i);
          ring[2 * (i - a) + 1] = lat(i);
        }
        rings.push(ring);
      }
      r++;
    }
    // This polygon's triangles, as indices relative to its first vertex.
    const own: number[] = [];
    while (t + 2 < tris.length && tris[t]! < v1) {
      if (tris[t]! >= v0) own.push(tris[t]! - v0, tris[t + 1]! - v0, tris[t + 2]! - v0);
      t += 3;
    }
    if (props[fid[v0]!]?.hide_3d === true || !rings.length) continue;
    const h = Math.max(MIN_HEIGHT_M, heights ? heights[v0]! : 0);
    yield { rings, triangles: own, height: h, seed: seedOf(rings[0]![0]!, rings[0]![1]!) };
  }
}

self.onmessage = async (e: MessageEvent<TileRequest>) => {
  const { id, url, x, y, z } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
    const data = MVTLoader.parseSync!(await res.arrayBuffer(), {
      mvt: { shape: 'binary', coordinates: 'local', layers: ['building'] },
    } as never) as BinaryFeatureCollection | unknown[];
    if (Array.isArray(data)) {
      self.postMessage({ id, solids: null } satisfies TileReply);
      return;
    }
    const box = { w: tileLng(x, z), e: tileLng(x + 1, z), n: tileLat(y, z), s: tileLat(y + 1, z) };
    const solids = buildSolids(parts(data, x, y, z), box);
    const out: TileReply = { id, solids: solids.indices.length ? solids : null };
    const transfer = solids.indices.length
      ? [solids.positions.buffer, solids.positions64Low.buffer, solids.normals.buffer, solids.walls.buffer, solids.indices.buffer]
      : [];
    (self as unknown as Worker).postMessage(out, transfer as Transferable[]);
  } catch (err) {
    self.postMessage({ id, solids: null, error: String(err) } satisfies TileReply);
  }
};
