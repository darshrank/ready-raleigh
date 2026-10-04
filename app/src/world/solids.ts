// Building geometry, ready for the GPU: flat roofs and wall quads with their normals and wall
// coordinates (meters along the wall, height, wall length) and a seed per building, so the
// shaders can light them and draw windows and stains with no per-frame work. Built in the tile
// worker (world/tile.worker.ts) for the city, and on the main thread for the shelter sites.
// Pure functions, no DOM.
//
// Positions are longitude/latitude split into a 32-bit high part and the remainder, so deck.gl
// projects them exactly (fp64) at any zoom; z is meters.

export interface Solids {
  /** Per vertex: lng, lat (high float32 part), z meters. */
  positions: Float32Array;
  /** Per vertex: lng, lat low parts (value minus its float32), 0. */
  positions64Low: Float32Array;
  /** Per vertex: outward normal (east, north, up) and a wall flag (127 wall, 0 roof), snorm8. */
  normals: Int8Array;
  /** Per vertex: meters along the wall, meters up, the wall's length, the building seed (0..1). */
  walls: Float32Array;
  indices: Uint32Array;
}

export interface SolidPart {
  /** Rings as flat [lng0, lat0, lng1, lat1, ...], each closed (last point = first). The first is the outline. */
  rings: ArrayLike<number>[];
  /** Roof triangles: indices into the rings' points (all rings in order). */
  triangles: ArrayLike<number> | null;
  height: number;
  /** 0..1, stable per building. */
  seed: number;
}

/** Keep geometry inside this lng/lat box (a tile): roofs and walls are clipped exactly to it. */
export interface Box {
  w: number;
  s: number;
  e: number;
  n: number;
}

export const M_PER_DEG = 111_320;
export const metersPerLng = (lat: number) => M_PER_DEG * Math.cos((lat * Math.PI) / 180);

/** Walls shorter than this are dropped (slivers). */
const MIN_WALL_M = 0.05;

class Grow<T extends Float32Array | Int8Array | Uint32Array> {
  n = 0;
  constructor(
    public a: T,
    private make: (len: number) => T,
  ) {}
  room(extra: number) {
    if (this.n + extra <= this.a.length) return;
    const b = this.make(Math.max(this.a.length * 2, this.n + extra));
    b.set(this.a.subarray(0, this.n) as never);
    this.a = b;
  }
  done() {
    return this.a.slice(0, this.n) as T;
  }
}

/** Signed area of a closed flat ring (positive = counter-clockwise, x east, y north). */
function ringArea(r: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i + 3 < r.length; i += 2) s += r[i]! * r[i + 3]! - r[i + 2]! * r[i + 1]!;
  return s / 2;
}

/** Clip a convex-or-not polygon (flat xy list) to a box (Sutherland-Hodgman, one side at a time). */
function clipPolygon(pts: number[], box: Box): number[] {
  let out = pts;
  const sides: [number, number, boolean][] = [
    [0, box.w, true],
    [0, box.e, false],
    [1, box.s, true],
    [1, box.n, false],
  ];
  for (const [axis, edge, min] of sides) {
    const inp = out;
    out = [];
    const inside = (k: number) => (min ? inp[k + axis]! >= edge : inp[k + axis]! <= edge);
    for (let k = 0; k < inp.length; k += 2) {
      const j = (k + 2) % inp.length;
      const a = inside(k);
      const b = inside(j);
      if (a) out.push(inp[k]!, inp[k + 1]!);
      if (a !== b) {
        const t = (edge - inp[k + axis]!) / (inp[j + axis]! - inp[k + axis]!);
        out.push(inp[k]! + (inp[j]! - inp[k]!) * t, inp[k + 1]! + (inp[j + 1]! - inp[k + 1]!) * t);
      }
    }
    if (!out.length) break;
  }
  return out;
}

/** The part of segment a-b inside the box, as [t0, t1] along it, or null (Liang-Barsky). */
function clipSegment(x0: number, y0: number, x1: number, y1: number, box: Box): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const test = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (test(-dx, x0 - box.w) && test(dx, box.e - x0) && test(-dy, y0 - box.s) && test(dy, box.n - y0) && t1 > t0) return [t0, t1];
  return null;
}

export function buildSolids(parts: Iterable<SolidPart>, box: Box | null = null): Solids {
  const pos = new Grow(new Float32Array(3 * 8192), (l) => new Float32Array(l));
  const low = new Grow(new Float32Array(3 * 8192), (l) => new Float32Array(l));
  const nrm = new Grow(new Int8Array(4 * 8192), (l) => new Int8Array(l));
  const wal = new Grow(new Float32Array(4 * 8192), (l) => new Float32Array(l));
  const idx = new Grow(new Uint32Array(6 * 8192), (l) => new Uint32Array(l));
  let v = 0;
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number, wall: boolean, u: number, h: number, len: number, seed: number) => {
    pos.room(3);
    low.room(3);
    nrm.room(4);
    wal.room(4);
    const fx = Math.fround(x);
    const fy = Math.fround(y);
    pos.a[pos.n++] = fx;
    pos.a[pos.n++] = fy;
    pos.a[pos.n++] = z;
    low.a[low.n++] = x - fx;
    low.a[low.n++] = y - fy;
    low.a[low.n++] = 0;
    nrm.a[nrm.n++] = Math.round(nx * 127);
    nrm.a[nrm.n++] = Math.round(ny * 127);
    nrm.a[nrm.n++] = Math.round(nz * 127);
    nrm.a[nrm.n++] = wall ? 127 : 0;
    wal.a[wal.n++] = u;
    wal.a[wal.n++] = h;
    wal.a[wal.n++] = len;
    wal.a[wal.n++] = seed;
    return v++;
  };
  const tri = (a: number, b: number, c: number) => {
    idx.room(3);
    idx.a[idx.n++] = a;
    idx.a[idx.n++] = b;
    idx.a[idx.n++] = c;
  };
  const inBox = (x: number, y: number) => !box || (x >= box.w && x <= box.e && y >= box.s && y <= box.n);

  for (const part of parts) {
    const { rings, height: h, seed } = part;
    const outline = rings[0];
    if (!outline || outline.length < 8) continue;
    const kx = metersPerLng(outline[1]!);
    // Roof: the given triangles; any that cross the box edge are clipped to it.
    const t = part.triangles;
    if (t && t.length) {
      const flat: number[] = [];
      for (const r of rings) for (let i = 0; i < r.length; i++) flat.push(r[i]!);
      const ids = new Map<number, number>();
      const at = (k: number) => {
        let id = ids.get(k);
        if (id === undefined) ids.set(k, (id = vertex(flat[2 * k]!, flat[2 * k + 1]!, h, 0, 0, 1, false, 0, h, 0, seed)));
        return id;
      };
      for (let i = 0; i + 2 < t.length; i += 3) {
        const a = t[i]!, b = t[i + 1]!, c = t[i + 2]!;
        const ins = [a, b, c].filter((k) => inBox(flat[2 * k]!, flat[2 * k + 1]!)).length;
        if (ins === 3) {
          tri(at(a), at(b), at(c));
          continue;
        }
        const poly = clipPolygon([flat[2 * a]!, flat[2 * a + 1]!, flat[2 * b]!, flat[2 * b + 1]!, flat[2 * c]!, flat[2 * c + 1]!], box!);
        if (poly.length < 6) continue;
        const first = vertex(poly[0]!, poly[1]!, h, 0, 0, 1, false, 0, h, 0, seed);
        let prev = vertex(poly[2]!, poly[3]!, h, 0, 0, 1, false, 0, h, 0, seed);
        for (let k = 4; k < poly.length; k += 2) {
          const cur = vertex(poly[k]!, poly[k + 1]!, h, 0, 0, 1, false, 0, h, 0, seed);
          tri(first, prev, cur);
          prev = cur;
        }
      }
    }
    // Walls: a quad per ring edge (clipped to the box), facing out of the building.
    rings.forEach((r, k) => {
      const ccw = ringArea(r) > 0;
      const flip = (k === 0) !== ccw ? -1 : 1;
      for (let i = 0; i + 3 < r.length; i += 2) {
        const x0 = r[i]!, y0 = r[i + 1]!, x1 = r[i + 2]!, y1 = r[i + 3]!;
        const mx = (x1 - x0) * kx;
        const my = (y1 - y0) * M_PER_DEG;
        const len = Math.hypot(mx, my);
        if (len < MIN_WALL_M) continue;
        const span = box ? clipSegment(x0, y0, x1, y1, box) : ([0, 1] as [number, number]);
        if (!span) continue;
        const [t0, t1] = span;
        if ((t1 - t0) * len < MIN_WALL_M) continue;
        const ax = x0 + (x1 - x0) * t0, ay = y0 + (y1 - y0) * t0;
        const bx = x0 + (x1 - x0) * t1, by = y0 + (y1 - y0) * t1;
        const nx = (flip * my) / len;
        const ny = (-flip * mx) / len;
        const ua = t0 * len, ub = t1 * len;
        const a = vertex(ax, ay, 0, nx, ny, 0, true, ua, 0, len, seed);
        const b = vertex(bx, by, 0, nx, ny, 0, true, ub, 0, len, seed);
        const c = vertex(bx, by, h, nx, ny, 0, true, ub, h, len, seed);
        const d = vertex(ax, ay, h, nx, ny, 0, true, ua, h, len, seed);
        tri(a, b, c);
        tri(a, c, d);
      }
    });
  }
  return { positions: pos.done(), positions64Low: low.done(), normals: nrm.done(), walls: wal.done(), indices: idx.done() };
}

/** A stable 0..1 hash of a point (rounded to ~1 m), for per-building seeds. */
export function seedOf(lng: number, lat: number): number {
  let h = Math.imul(Math.round(lng * 1e5) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(lat * 1e5) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
