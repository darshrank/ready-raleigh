// Realistic flood water (DESIGN.md "Water"): native MapLibre layers from flood_steps.geojson, drawn
// above streets and buildings and below every label, plus the streets the water covers.
//
// Everything that animates goes through cheap paths only, so the map never re-tiles mid-animation:
// constant paint values (water color and its shimmer, layer opacities, dash phases), feature-state
// (each part's growth) and layout visibility.
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  MapSourceDataEvent,
  SourceSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon, Position } from 'geojson';
import { currentStory, dataBase } from '../story';
import { rgba, tint, type RGB, type Tokens } from '../tokens';
import type { Mood } from './basemap';
import { FX_TIMING } from '../dev/timing';
import { flashAt, frame as worldFrame, REALISM } from '../world/state';
import type { FloodData } from '../world/floodData';
import type { LightsData } from '../world/cityLightsData';
import type { FloodWorkerRequest } from '../world/flood.worker';
import { TIER } from '../world/quality';
import { World } from '../world/world';

export const STEPS = [1, 2, 3] as const;
const FLOOD = 'flood';
const SUBMERGED = 'submerged';
const CLOSURES = 'closures';
const BARRIER = 'road-closed';

/** Water depth in meters per step in 3D: the floodway is deepest. */
const DEPTH_M: Record<number, number> = { 1: 6, 2: 3, 3: 1.5 };
/** The camera counts as tilted (3D buildings and water) above this pitch. */
export const TILT_3D = 20;

/** A step grows in over GROW_MS: each part fades in over PART_MS, after a delay up to the rest. */
export const GROW_MS = 1500;
const PART_MS = 600;
/** Parts this far (meters) from the water already there arrive last. */
const SPREAD_M = 1500;

const emptyFc = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });
const byStep = (k: number): ExpressionSpecification => ['==', ['get', 'step'], k];
const zoomed = (...stops: number[]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], ...stops] as ExpressionSpecification;
const revealed: ExpressionSpecification = ['coalesce', ['feature-state', 'p'], 1];

// ---------------------------------------------------------------------------------------------
// Look: every water color per mood and strength.

type RGBA = [number, number, number, number];

interface Look {
  fill: RGBA[]; // per step (index 0 = step 1)
  edge: RGBA;
  glow: RGBA;
  extrude: RGBA[]; // alpha is the layer opacity
  under: RGBA;
  dash: RGBA;
}

/** 'preview' is the faint planning view; 'full' is the storm and its aftermath. */
export type WaterLevel = 'preview' | 'full';

const a = (c: RGB, alpha: number): RGBA => [c[0], c[1], c[2], alpha];

function look(mood: Mood, level: WaterLevel, t: Tokens): Look {
  const hazard = currentStory().hazard;
  return hazard === 'flood' ? waterLook(mood, level, t) : groundLook(mood, level, t, hazard);
}

/**
 * The other disasters in the same printed inks: failing ground in ochre (signal mixed with alarm),
 * heat in alarm, the colour DESIGN.md gives the heat halftone. Same steps, same growth and shimmer.
 */
function groundLook(mood: Mood, level: WaterLevel, { rgb }: Tokens, hazard: 'quake' | 'heat'): Look {
  const k = level === 'preview' ? 0.75 : 1;
  const base = hazard === 'quake' ? tint(rgb.signal, rgb.alarm, 0.3) : rgb.alarm;
  const light = tint(base, rgb.bond, 0.3);
  const deep = tint(base, rgb.ink, 0.25);
  const night = mood === 'storm' ? 1.1 : 1;
  return {
    fill: [a(deep, 0.62 * k * night), a(base, 0.46 * k * night), a(light, 0.34 * k * night)],
    edge: a(tint(base, rgb.ink, 0.5), 0.5 * k),
    glow: a(base, mood === 'storm' ? 0.18 * k : 0),
    extrude: [a(deep, 0.4), a(base, 0.4), a(light, 0.4)],
    under: a(tint(mood === 'storm' ? rgb['storm-land'] : rgb.ink, rgb.alarm, 0.4), 0.85),
    dash: a(mood === 'storm' ? rgb.signal : rgb.bond, 0.95),
  };
}

function waterLook(mood: Mood, level: WaterLevel, { rgb }: Tokens): Look {
  // Planning preview: faint, but strong enough to read under the coverage dots at the city view.
  const k = level === 'preview' ? 0.75 : 1;
  if (mood === 'storm') {
    const w = rgb['storm-water'];
    return {
      fill: [a(tint(w, rgb['flood-deep'], 0.3), 0.72 * k), a(w, 0.46 * k), a(w, 0.3 * k)],
      edge: a(rgb['storm-glow'], 0.3 * k),
      glow: a(rgb['storm-glow'], 0.2 * k),
      extrude: [a(tint(w, rgb['flood-deep'], 0.3), 0.36), a(w, 0.36), a(w, 0.36)],
      // A street under water: a deep band through the bright water, with glowing dashes.
      under: a(tint(rgb['storm-land'], rgb['flood-deep'], 0.45), 0.85),
      dash: a(rgb['storm-glow'], 1),
    };
  }
  return {
    fill: [a(rgb['flood-deep'], 0.6 * k), a(rgb.flood, 0.48 * k), a(tint(rgb.flood, rgb.bond, 0.25), 0.36 * k)],
    edge: a(rgb['flood-deep'], 0.5 * k),
    glow: a(rgb.flood, 0),
    extrude: [a(rgb['flood-deep'], 0.45), a(rgb.flood, 0.45), a(tint(rgb.flood, rgb.bond, 0.25), 0.45)],
    under: a(tint(rgb['flood-deep'], rgb.ink, 0.35), 0.8),
    dash: a(rgb.bond, 0.95),
  };
}

const css = (c: RGBA) => rgba([c[0], c[1], c[2]], Math.max(0, Math.min(1, c[3])));
const mix = (x: RGBA, y: RGBA, t: number): RGBA => [
  Math.round(x[0] + (y[0] - x[0]) * t),
  Math.round(x[1] + (y[1] - x[1]) * t),
  Math.round(x[2] + (y[2] - x[2]) * t),
  x[3] + (y[3] - x[3]) * t,
];
const mixLook = (x: Look, y: Look, t: number): Look => ({
  fill: x.fill.map((c, i) => mix(c, y.fill[i]!, t)),
  edge: mix(x.edge, y.edge, t),
  glow: mix(x.glow, y.glow, t),
  extrude: x.extrude.map((c, i) => mix(c, y.extrude[i]!, t)),
  under: mix(x.under, y.under, t),
  dash: mix(x.dash, y.dash, t),
});

// ---------------------------------------------------------------------------------------------
// Style: sources and layers (basemap.ts places them in the draw order).

export function floodSources(): Record<string, SourceSpecification> {
  return {
    [FLOOD]: { type: 'geojson', data: emptyFc() },
    [SUBMERGED]: { type: 'geojson', data: emptyFc() },
    [CLOSURES]: { type: 'geojson', data: emptyFc() },
  };
}

/** Flowing dash: 4 copies of one dash pattern, each a quarter period further on, crossfaded. */
const DASH_PHASES = 4;
const dashPattern = (j: number): number[] => (j === 0 ? [2, 6] : [0, 2 * j, 2, 6 - 2 * j]);

/** Water fills, waterline, night glow, then the streets under the water. Above streets, below labels. */
export function floodFlatLayers(t: Tokens): LayerSpecification[] {
  const L = look('day', 'preview', t);
  const water = STEPS.flatMap((k): LayerSpecification[] => [
    {
      id: `water-${k}`,
      type: 'fill',
      source: FLOOD,
      filter: byStep(k),
      // No antialiasing: its outline would draw a hard edge where parts meet.
      paint: { 'fill-color': css(L.fill[k - 1]!), 'fill-opacity': revealed, 'fill-antialias': false },
    },
  ]);
  const edges = STEPS.flatMap((k): LayerSpecification[] => [
    {
      id: `water-glow-${k}`,
      type: 'line',
      source: FLOOD,
      filter: byStep(k),
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': css(L.glow),
        'line-width': zoomed(10, 4, 14, 12, 17, 26),
        'line-blur': zoomed(10, 4, 14, 12, 17, 26),
        'line-opacity': revealed,
      },
    },
    {
      id: `water-edge-${k}`,
      type: 'line',
      source: FLOOD,
      filter: byStep(k),
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': css(L.edge),
        'line-width': zoomed(10, 1.8, 13, 3, 17, 9),
        'line-blur': zoomed(10, 1.2, 13, 3, 17, 9),
        'line-opacity': revealed,
      },
    },
  ]);
  const none: ExpressionSpecification = ['==', ['get', 'step'], 0];
  const under: LayerSpecification = {
    id: 'submerged',
    type: 'line',
    source: SUBMERGED,
    filter: none,
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': css(L.under), 'line-width': zoomed(10, 1.6, 13, 4, 17, 18) },
  };
  const dashes = Array.from({ length: DASH_PHASES }, (_, j): LayerSpecification => ({
    id: `submerged-flow-${j}`,
    type: 'line',
    source: SUBMERGED,
    filter: none,
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': css(L.dash),
      'line-width': zoomed(10, 0.8, 13, 1.6, 17, 5.5),
      'line-dasharray': dashPattern(j),
      'line-opacity': j === 0 ? 1 : 0,
    },
  }));
  return [...water, ...edges, under, ...dashes];
}

/** 3D water, one layer per step so each rises and fades on its own. Hidden until the camera tilts. */
export function flood3dLayers(t: Tokens): LayerSpecification[] {
  const L = look('day', 'preview', t);
  return STEPS.map((k) => ({
    id: `water-3d-${k}`,
    type: 'fill-extrusion',
    source: FLOOD,
    filter: byStep(k),
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': css([...L.extrude[k - 1]!.slice(0, 3), 1] as RGBA),
      'fill-extrusion-height': ['*', DEPTH_M[k]!, revealed],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': L.extrude[k - 1]![3],
      'fill-extrusion-vertical-gradient': false,
    },
  }));
}

/** Road-closed barriers where streets enter the water, turned across the street. Labels win collisions. */
export function closuresLayer(): LayerSpecification {
  return {
    id: 'road-closed',
    type: 'symbol',
    source: CLOSURES,
    // From street level only: at the city view hundreds of barriers would bury the creeks.
    minzoom: 12,
    filter: ['==', ['get', 'k'], 0],
    layout: {
      'icon-image': BARRIER,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 14, 0.75, 17, 1.05],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'viewport',
      'icon-allow-overlap': false,
      'icon-padding': 1,
      'symbol-sort-key': ['get', 'k'],
    },
  };
}

/** The barrier: a bond board with --alarm stripes and an ink edge, drawn at 2x. */
function barrierImage({ hex }: Tokens): ImageData {
  const W = 52;
  const H = 22;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = hex.ink;
  g.fillRect(0, 0, W, H);
  g.fillStyle = hex.bond;
  g.fillRect(3, 3, W - 6, H - 6);
  g.save();
  g.beginPath();
  g.rect(3, 3, W - 6, H - 6);
  g.clip();
  g.fillStyle = hex.alarm;
  for (let x = -H; x < W + H; x += 12) {
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + 6, H);
    g.lineTo(x + 6 + H, 0);
    g.lineTo(x + H, 0);
    g.closePath();
    g.fill();
  }
  g.restore();
  return g.getImageData(0, 0, W, H);
}

// ---------------------------------------------------------------------------------------------
// Data: flood_steps.geojson split into single polygons, each with a growth delay.

type LngLat = [number, number];
const M_PER_DEG = 111_320;

interface Parts {
  fc: FeatureCollection<Polygon, { step: number }>;
  step: Uint8Array;
  /** 0..1: when the part starts to grow within its step's GROW_MS. */
  delay: Float32Array;
  ids: number[][]; // part ids per step (index 0 = step 1)
}

/** Grid hash of points in meters, for nearest-point distances. */
class PointGrid {
  private cells = new Map<string, number[]>();
  constructor(private size: number) {}
  add(x: number, y: number) {
    const key = `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
    const list = this.cells.get(key);
    if (list) list.push(x, y);
    else this.cells.set(key, [x, y]);
  }
  /** Distance to the nearest point, or `max` if none is that close. */
  nearest(x: number, y: number, max: number): number {
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    let best = max * max;
    const rings = Math.ceil(max / this.size);
    for (let r = 0; r <= rings; r++) {
      if ((r - 1) * this.size > Math.sqrt(best)) break;
      for (let i = -r; i <= r; i++)
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const list = this.cells.get(`${cx + i},${cy + j}`);
          if (!list) continue;
          for (let q = 0; q < list.length; q += 2) {
            const d = (list[q]! - x) ** 2 + (list[q + 1]! - y) ** 2;
            if (d < best) best = d;
          }
        }
    }
    return Math.sqrt(best);
  }
}

function prepareParts(raw: FeatureCollection<Polygon | MultiPolygon, { step: number }>): Parts {
  const polys: { step: number; rings: Position[][] }[] = [];
  for (const f of raw.features) {
    const step = Number(f.properties.step);
    if (!STEPS.includes(step as 1)) continue;
    const list = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of list) polys.push({ step, rings });
  }
  const lat0 = polys[0]?.rings[0]?.[0]?.[1] ?? 35.8;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const xy = (p: Position): [number, number] => [p[0]! * kx, p[1]! * M_PER_DEG];

  const n = polys.length;
  const step = new Uint8Array(n);
  const delay = new Float32Array(n);
  const ids: number[][] = [[], [], []];
  polys.forEach((p, i) => {
    step[i] = p.step;
    ids[p.step - 1]!.push(i);
  });

  // The water grows out of what is already there: a part's delay is the distance from its nearest
  // vertex to the water of the earlier steps. The floodway grows out of its main channels (the
  // fifth of its parts with the most vertices) into the small tributaries.
  const sample = (ring: Position[]) => ring.filter((_, k) => k % Math.max(1, Math.floor(ring.length / 24)) === 0);
  const seeds = new PointGrid(250);
  const first = ids[0]!.map((i) => i).sort((x, y) => polys[y]!.rings[0]!.length - polys[x]!.rings[0]!.length);
  const main = new Set(first.slice(0, Math.max(1, Math.ceil(first.length / 5))));
  for (const i of main) for (const p of polys[i]!.rings[0]!) seeds.add(...xy(p));
  for (const k of STEPS) {
    for (const i of ids[k - 1]!) {
      if (k === 1 && main.has(i)) continue;
      let d = SPREAD_M;
      for (const p of sample(polys[i]!.rings[0]!)) d = Math.min(d, seeds.nearest(...xy(p), SPREAD_M));
      delay[i] = Math.sqrt(d / SPREAD_M);
    }
    // The next step grows out of this one.
    for (const i of ids[k - 1]!) if (!(k === 1 && main.has(i))) for (const p of polys[i]!.rings[0]!) seeds.add(...xy(p));
  }

  const fc: Parts['fc'] = {
    type: 'FeatureCollection',
    features: polys.map((p, i) => ({ type: 'Feature', id: i, properties: { step: p.step }, geometry: { type: 'Polygon', coordinates: p.rings } })),
  };
  return { fc, step, delay, ids };
}

/**
 * The flood steps as a grid of about 15 m cells (0 = dry, else the step), for clipping streets to
 * the water. Even-odd scanline fill per polygon, so holes stay dry.
 */
class FloodRaster {
  readonly cell = 15;
  private data: Uint8Array;
  /** Blocks of COARSE x COARSE cells: 1 if any cell in the block is under water. */
  private coarse: Uint8Array;
  private cw: number;
  private w: number;
  private h: number;
  private lon0: number;
  private lat0: number;
  private kx: number;

  private queue: Parts['fc']['features'];

  constructor(fc: Parts['fc']) {
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of fc.features)
      for (const p of f.geometry.coordinates[0]!) {
        w = Math.min(w, p[0]!); e = Math.max(e, p[0]!);
        s = Math.min(s, p[1]!); n = Math.max(n, p[1]!);
      }
    this.lon0 = w;
    this.lat0 = s;
    this.kx = M_PER_DEG * Math.cos((((s + n) / 2) * Math.PI) / 180);
    this.w = Math.max(1, Math.ceil(((e - w) * this.kx) / this.cell) + 1);
    this.h = Math.max(1, Math.ceil(((n - s) * M_PER_DEG) / this.cell) + 1);
    this.data = new Uint8Array(this.w * this.h);
    this.cw = Math.ceil(this.w / COARSE);
    this.coarse = new Uint8Array(this.cw * Math.ceil(this.h / COARSE));
    this.queue = [...fc.features];
  }

  get done() {
    return this.queue.length === 0;
  }

  /** Fill polygons until `until` (performance.now() ms), or all of them. Lets idle time build it. */
  build(until = Infinity) {
    while (this.queue.length && performance.now() < until) {
      const f = this.queue.pop()!;
      this.fill(f.geometry.coordinates, f.properties.step);
    }
    return this.done;
  }

  /** Whether any water lies within about one block (COARSE cells) of the segment a-b. */
  near(a: Position, b: Position): boolean {
    const c0 = Math.floor(this.gx(Math.min(a[0]!, b[0]!)) / COARSE) - 1;
    const c1 = Math.floor(this.gx(Math.max(a[0]!, b[0]!)) / COARSE) + 1;
    const r0 = Math.floor(this.gy(Math.min(a[1]!, b[1]!)) / COARSE) - 1;
    const r1 = Math.floor(this.gy(Math.max(a[1]!, b[1]!)) / COARSE) + 1;
    const rows = this.coarse.length / this.cw;
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(this.cw - 1, c1); c++) if (this.coarse[r * this.cw + c]) return true;
    return false;
  }

  private gx = (lon: number) => ((lon - this.lon0) * this.kx) / this.cell;
  private gy = (lat: number) => ((lat - this.lat0) * M_PER_DEG) / this.cell;

  private fill(rings: Position[][], step: number) {
    // Edges as [y0, y1, x at y0, dx/dy], sorted by y0; an active list sweeps the rows.
    const edges: number[][] = [];
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const ring of rings)
      for (let k = 0; k + 1 < ring.length; k++) {
        let x0 = this.gx(ring[k]![0]!), y0 = this.gy(ring[k]![1]!);
        let x1 = this.gx(ring[k + 1]![0]!), y1 = this.gy(ring[k + 1]![1]!);
        if (y0 === y1) continue;
        if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
        edges.push([y0, y1, x0, (x1 - x0) / (y1 - y0)]);
        ymin = Math.min(ymin, y0);
        ymax = Math.max(ymax, y1);
      }
    edges.sort((p, q) => p[0]! - q[0]!);
    let next = 0;
    let active: number[][] = [];
    const xs: number[] = [];
    for (let r = Math.max(0, Math.floor(ymin)); r <= Math.min(this.h - 1, Math.ceil(ymax)); r++) {
      const yc = r + 0.5;
      while (next < edges.length && edges[next]![0]! <= yc) active.push(edges[next++]!);
      active = active.filter((ed) => ed[1]! > yc);
      xs.length = 0;
      for (const ed of active) if (ed[0]! <= yc) xs.push(ed[2]! + (yc - ed[0]!) * ed[3]!);
      xs.sort((p, q) => p - q);
      const row = r * this.w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k]! - 0.5));
        const c1 = Math.min(this.w - 1, Math.floor(xs[k + 1]! - 0.5));
        for (let c = c0; c <= c1; c++) this.data[row + c] = step;
        if (c0 <= c1) {
          const cr = Math.floor(r / COARSE) * this.cw;
          for (let b = Math.floor(c0 / COARSE); b <= Math.floor(c1 / COARSE); b++) this.coarse[cr + b] = 1;
        }
      }
    }
  }

  at(lon: number, lat: number): number {
    const c = Math.floor(this.gx(lon));
    const r = Math.floor(this.gy(lat));
    return c < 0 || r < 0 || c >= this.w || r >= this.h ? 0 : this.data[r * this.w + c]!;
  }
}

/** Coarse blocks for skipping street segments far from any water: 16 cells, about 240 m. */
const COARSE = 16;

/** Streets that can go under: everything a car drives on. Motorway and trunk bridges stay dry. */
const STREETS: ExpressionSpecification = [
  'all',
  ['!=', ['get', 'brunnel'], 'tunnel'],
  ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
  ['!', ['all', ['==', ['get', 'brunnel'], 'bridge'], ['match', ['get', 'class'], ['motorway', 'trunk'], true, false]]],
];
/** Sample spacing along a street, meters. */
const SAMPLE_M = 6;
/** Barriers stand this far outside the water, on the dry side. */
const BARRIER_OUT_M = 8;

/**
 * Clip the streets in the loaded tiles to the water: the runs under water (with their step) and
 * the points where a street enters the water at each step (where the barriers go).
 */
function clipStreets(map: MapLibreMap, raster: FloodRaster) {
  const runs: Feature<LineString, { step: number }>[] = [];
  const closures: Feature<Point, { k: number; bearing: number }>[] = [];
  const seen = new Set<string>();
  const features = map.querySourceFeatures('omt', { sourceLayer: 'transportation', filter: STREETS });

  const lat0 = map.getCenter().lat;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);

  for (const f of features) {
    const g = f.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      let run: Position[] | null = null;
      let prev = line.length ? raster.at(line[0]![0]!, line[0]![1]!) : 0;
      if (prev > 0) run = [line[0]!];
      for (let s = 0; s + 1 < line.length; s++) {
        const A = line[s]!;
        const B = line[s + 1]!;
        const dx = (B[0]! - A[0]!) * kx;
        const dy = (B[1]! - A[1]!) * M_PER_DEG;
        const len = Math.hypot(dx, dy);
        // Far from any water (most of the city): nothing to sample, the street stays dry.
        if (prev === 0 && !raster.near(A, B)) {
          if (run) run.push(B);
          continue;
        }
        const n = Math.max(1, Math.ceil(len / SAMPLE_M));
        const at = (t: number): Position => [A[0]! + (B[0]! - A[0]!) * t, A[1]! + (B[1]! - A[1]!) * t];
        const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
        for (let i = 1; i <= n; i++) {
          const p = at(i / n);
          const cur = raster.at(p[0]!, p[1]!);
          if (cur === prev) continue;
          const tm = (i - 0.5) / n;
          const m = at(tm);
          if (run) {
            run.push(m);
            if (run.length > 1) runs.push({ type: 'Feature', properties: { step: prev }, geometry: { type: 'LineString', coordinates: run } });
          }
          run = cur > 0 ? [m] : null;
          // A barrier for each step at which one side is under water and the other is not.
          for (const k of STEPS) {
            const wetBefore = prev > 0 && prev <= k;
            const wetAfter = cur > 0 && cur <= k;
            if (wetBefore === wetAfter) continue;
            const out = len > 0 ? BARRIER_OUT_M / len : 0;
            const q = at(Math.min(1, Math.max(0, wetBefore ? tm + out : tm - out)));
            const key = `${k}:${q[0]!.toFixed(4)},${q[1]!.toFixed(4)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            closures.push({ type: 'Feature', properties: { k, bearing }, geometry: { type: 'Point', coordinates: q } });
          }
          prev = cur;
        }
        if (run) run.push(B);
      }
      if (run && run.length > 1) runs.push({ type: 'Feature', properties: { step: prev }, geometry: { type: 'LineString', coordinates: run } });
    }
  }
  return {
    runs: { type: 'FeatureCollection', features: runs } as FeatureCollection,
    closures: { type: 'FeatureCollection', features: closures } as FeatureCollection,
  };
}

// ---------------------------------------------------------------------------------------------
// The animator.

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Shimmer: the water's alpha drifts a few percent, each step out of phase. */
const SHIMMER = 0.07;
const SHIMMER_MS = 3200;
/** One dash phase every this many ms: a slow flow. */
const FLOW_MS = 260;

/**
 * Growth of each step, 0..1, at a given time (performance.now()). An optional fourth value is the
 * storm clock (ms since the storm started); the realistic water uses it to rise and drain.
 */
export type RevealFn = (now: number) => readonly number[];

/** MapLibre's water layers, which the realistic water (world/water.ts) replaces. */
const MAPLIBRE_WATER = [
  ...STEPS.flatMap((k) => [`water-${k}`, `water-glow-${k}`, `water-edge-${k}`, `water-3d-${k}`]),
  'submerged',
  ...Array.from({ length: 4 }, (_, j) => `submerged-flow-${j}`),
];
/** The realistic water drains over at most this long when the storm clears. */
const DRAIN_MS = 1500;

const views = new WeakMap<MapLibreMap, FloodView>();
/** The water on a map, once its style has loaded (MapView creates it). */
export const floodViewOf = (map: MapLibreMap | null) => (map ? views.get(map) ?? null : null);

export class FloodView {
  private parts: Parts | null = null;
  private raster: FloodRaster | null = null;
  private current: Look;
  private from: Look;
  private to: Look;
  private fadeStart = 0;
  private fadeMs = 0;
  private reveal: RevealFn | null = null;
  /** Each part's growth as last written to feature-state (1 = full, the default). */
  private p = new Float32Array(0);
  private stepP = [1, 1, 1];
  private submergedStep = 0;
  private threeD = false;
  private raf = 0;
  private lastPaint = 0;
  private clipTimer = 0;
  private sent = new Map<string, string | number>();
  /** The day/night mix (0 day, 1 storm night), fading with setLook. */
  private night = 0;
  private nightFrom = 0;
  private nightTo = 0;
  /** Realistic water: preview (0) to full (1), and the drain once the storm clears (0..1). */
  private level = 0;
  private levelFrom = 0;
  private levelTo = 0;
  private ending = 0;
  private stepStarts: readonly number[] = [0, 0, 0];
  private runs: FeatureCollection = emptyFc();
  readonly ready: Promise<void>;
  /** The realistic 3D city (app/src/world/); null with ?realism=off. */
  readonly world: World | null;
  /**
   * The realistic water (world/water.ts) draws this city's hazard: floods only. An earthquake or a
   * heat wave keeps the MapLibre layers in their ground colors (look()), over the same 3D city.
   */
  private readonly realWater: boolean;
  private drainFrom = 0;
  private drainTo = 0;
  private drainStart = 0;
  private drainMs = 0;

  constructor(
    private map: MapLibreMap,
    private t: Tokens,
    private reduce: boolean,
  ) {
    views.set(map, this);
    this.world = REALISM ? new World(t) : null;
    this.realWater = !!this.world && currentStory().hazard === 'flood';
    // Dev only: scripts and the console can inspect the world (lights, layers).
    if (import.meta.env.DEV) (window as unknown as { __world?: World | null }).__world = this.world;
    this.current = this.from = this.to = look('day', 'preview', t);
    if (!map.hasImage(BARRIER)) map.addImage(BARRIER, barrierImage(t), { pixelRatio: 2 });
    if (this.realWater) for (const id of MAPLIBRE_WATER) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    if (this.world) this.loadWorld();
    this.ready = fetch(`${dataBase()}/flood_steps.geojson`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`flood_steps.geojson: ${r.status}`))))
      .then((raw: FeatureCollection<Polygon | MultiPolygon, { step: number }>) => {
        if (!this.raf) return; // destroyed while loading
        this.parts = prepareParts(raw);
        this.p = new Float32Array(this.parts.step.length).fill(1);
        (map.getSource(FLOOD) as GeoJSONSource | undefined)?.setData(this.parts.fc);
        this.buildRaster();
      });
    this.ready.catch((e: unknown) => console.warn('Flood water did not load:', e));
    map.on('pitch', this.onPitch);
    map.on('sourcedata', this.onSourceData);
    this.onPitch();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.clipTimer);
    this.map.off('pitch', this.onPitch);
    this.map.off('sourcedata', this.onSourceData);
    this.world?.destroy();
    views.delete(this.map);
  }

  /** Day or night water, faint (planning) or full, fading over `ms`. */
  /**
   * The storm is over (`on`): the realistic 3D water drains and the foam fades over `ms`, while the
   * water stays at its final extent. Off for another round. The storm's end calls it (director.ts),
   * not the light: in Light mode the city's clock brings the day back while the storm still runs.
   */
  drain(on: boolean, ms: number) {
    this.drainFrom = this.ending;
    this.drainTo = on ? 1 : 0;
    this.drainStart = performance.now();
    this.drainMs = this.reduce ? 0 : Math.min(ms, DRAIN_MS);
  }

  setLook(mood: Mood, level: WaterLevel, ms: number) {
    this.from = this.current;
    this.to = look(mood, level, this.t);
    this.nightFrom = this.night;
    this.nightTo = mood === 'storm' ? 1 : 0;
    this.levelFrom = this.level;
    this.levelTo = level === 'full' ? 1 : 0;
    this.fadeStart = performance.now();
    this.fadeMs = this.reduce ? 0 : ms;
  }

  /**
   * Drive each step's growth from a clock; null shows every step in full. `stepStartsMs` (when
   * each step begins on the storm clock) lets the realistic water rise after it arrives.
   */
  setReveal(fn: RevealFn | null, stepStartsMs?: readonly number[]) {
    this.reveal = fn;
    if (stepStartsMs) this.stepStarts = stepStartsMs;
    if (!fn && !this.realWater) this.writeReveal([1, 1, 1]);
  }

  /** Show the streets under water up to step `k` (0 hides them), clipped from the loaded tiles. */
  showSubmerged(k: number) {
    if (k === this.submergedStep) return;
    const was = this.submergedStep;
    this.submergedStep = k;
    const filter: ExpressionSpecification = ['all', ['>', ['get', 'step'], 0], ['<=', ['get', 'step'], k]];
    for (const id of ['submerged', ...Array.from({ length: DASH_PHASES }, (_, j) => `submerged-flow-${j}`)])
      this.map.setFilter(id, filter);
    this.map.setFilter('road-closed', ['==', ['get', 'k'], k]);
    if (k > 0 && was === 0) this.clipSoon(0);
    if (this.realWater) this.world?.setSubmerged(k ? this.runs : emptyFc(), k);
    if (k === 0) {
      this.runs = emptyFc();
      (this.map.getSource(SUBMERGED) as GeoJSONSource | undefined)?.setData(emptyFc());
      (this.map.getSource(CLOSURES) as GeoJSONSource | undefined)?.setData(emptyFc());
    }
  }

  /** Build the street-clipping grid in idle time, a few milliseconds at a time (about 100 ms in all). */
  private buildRaster() {
    if (!this.parts) return;
    const raster = (this.raster = new FloodRaster(this.parts.fc));
    const idle = (fn: (d: { timeRemaining: () => number }) => void) =>
      typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(() => fn({ timeRemaining: () => 8 }), 50);
    const step = (d: { timeRemaining: () => number }) => {
      if (!this.raf || raster.done) return;
      if (!raster.build(performance.now() + Math.min(8, Math.max(2, d.timeRemaining())))) idle(step);
    };
    idle(step);
  }

  private onPitch = () => {
    const on = this.map.getPitch() > TILT_3D;
    if (on === this.threeD) return;
    this.threeD = on;
    const vis = on ? 'visible' : 'none';
    // The realistic city draws its own 3D buildings (world/buildings.ts); MapLibre's stay off.
    this.map.setLayoutProperty('buildings-3d', 'visibility', on && !this.world ? 'visible' : 'none');
    this.world?.setThreeD(on);
    this.map.setLayoutProperty('buildings', 'visibility', on ? 'none' : 'visible');
    if (!this.realWater) for (const k of STEPS) this.map.setLayoutProperty(`water-3d-${k}`, 'visibility', vis);
    this.lastPaint = 0;
  };

  /**
   * The hazard's arrival textures (and, for floods, the water's geometry) and the city's lights,
   * built in a worker (world/flood.worker.ts). Every city: the lights' blackout follows its steps.
   */
  private loadWorld() {
    const worker = new Worker(new URL('../world/flood.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ data?: FloodData; lights?: LightsData | null; ms?: number; lightsMs?: number; error?: string }>) => {
      worker.terminate();
      if (e.data.error || !e.data.data) {
        console.warn('Flood water did not load:', e.data.error);
        return;
      }
      if (!this.raf) return; // destroyed while loading
      if (import.meta.env.DEV) Object.assign(window, { __floodWorkerMs: e.data.ms, __lightsMs: e.data.lightsMs, __lightsCount: e.data.lights?.count ?? 0 });
      if (this.realWater) this.world?.setWater(e.data.data);
      if (e.data.lights) this.world?.setLights(e.data.lights, e.data.data, currentStory().hazard);
    };
    const request: FloodWorkerRequest = { base: new URL(dataBase(), location.href).href, lights: TIER.lights };
    worker.postMessage(request);
  }

  /** Re-clip when new street tiles arrive while the submerged streets are showing. */
  private onSourceData = (e: MapSourceDataEvent) => {
    if (this.submergedStep > 0 && e.sourceId === 'omt' && e.tile) this.clipSoon(350);
  };

  private clipSoon(ms: number) {
    clearTimeout(this.clipTimer);
    this.clipTimer = window.setTimeout(() => {
      if (!this.submergedStep || !this.parts) return;
      const t0 = performance.now();
      if (!this.raster) this.raster = new FloodRaster(this.parts.fc);
      this.raster.build(); // finishes the idle-time build if the storm came first
      const { runs, closures } = clipStreets(this.map, this.raster);
      // Dev only: how long clipping takes, for frame-rate checks (app/scripts/drive.mjs).
      if (import.meta.env.DEV)
        ((window as unknown as { __clips?: number[][] }).__clips ??= []).push([
          Math.round(t0),
          Math.round(performance.now() - t0),
          runs.features.length,
          closures.features.length,
        ]);
      this.runs = runs;
      if (this.realWater) this.world?.setSubmerged(runs, this.submergedStep);
      else (this.map.getSource(SUBMERGED) as GeoJSONSource | undefined)?.setData(runs);
      (this.map.getSource(CLOSURES) as GeoJSONSource | undefined)?.setData(closures);
    }, ms);
  }

  /**
   * The realistic world's uniforms for this frame (world/state.ts `frame`): nothing else changes
   * per frame. Repaints at the display rate while the storm runs or the mood fades, else 20 Hz
   * for the water's slow motion.
   */
  private worldFrame(now: number, f: number, shown: readonly number[] | undefined) {
    const w = worldFrame;
    w.now = now;
    w.night = this.night;
    this.level = this.levelFrom + (this.levelTo - this.levelFrom) * f;
    const fd = this.drainMs > 0 ? clamp01((now - this.drainStart) / this.drainMs) : 1;
    this.ending = this.drainFrom + (this.drainTo - this.drainFrom) * smooth(fd);
    w.level = this.level;
    w.ending = this.ending;
    w.stepP = [clamp01(shown?.[0] ?? 1), clamp01(shown?.[1] ?? 1), clamp01(shown?.[2] ?? 1)];
    w.clock = shown && shown.length > 3 ? shown[3]! : -1;
    w.stepStart = [this.stepStarts[0] ?? 0, this.stepStarts[1] ?? 0, this.stepStarts[2] ?? 0];
    w.flash = this.reduce ? 0 : flashAt(now);
    w.tilt = this.threeD ? 1 : 0;
    w.reduce = this.reduce;
    this.world?.lights.set(this.night);
    const busy = (this.fadeMs > 0 && now - this.fadeStart < this.fadeMs) || !!this.reveal;
    if (busy || now - this.lastPaint >= 50) {
      this.lastPaint = now;
      this.map.triggerRepaint();
    }
  }

  private paint(layer: string, prop: string, value: string | number) {
    const key = `${layer}|${prop}`;
    if (this.sent.get(key) === value) return;
    this.sent.set(key, value);
    this.map.setPaintProperty(layer, prop, value);
  }

  /** Write each part's growth to feature-state, only where it changed. */
  private writeReveal(stepP: readonly number[]) {
    const parts = this.parts;
    if (!parts) return;
    for (const k of STEPS) {
      const P = clamp01(stepP[k - 1] ?? 1);
      if (P === this.stepP[k - 1] && (P === 0 || P === 1)) continue;
      this.stepP[k - 1] = P;
      for (const i of parts.ids[k - 1]!) {
        // Twelfths: smooth to the eye, and a twelfth of the feature-state writes of a per-frame value.
        const v =
          P >= 1 ? 1 : P <= 0 ? 0 : Math.round(12 * smooth((P * GROW_MS - parts.delay[i]! * (GROW_MS - PART_MS)) / PART_MS)) / 12;
        if (v === this.p[i]) continue;
        this.p[i] = v;
        this.map.setFeatureState({ source: FLOOD, id: i }, { p: v });
      }
    }
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const a = performance.now();
    this.paintFrame(now);
    // Dev: the water's per-frame cost, for the trace scripts.
    if (import.meta.env.DEV && FX_TIMING) performance.measure('flood-frame', { start: a, end: performance.now() });
  };

  private paintFrame(now: number) {
    const shown = this.reveal?.(now);
    if (shown && !this.realWater) this.writeReveal(shown);

    const fading = this.fadeMs > 0 && now - this.fadeStart < this.fadeMs;
    const f = fading ? smooth((now - this.fadeStart) / this.fadeMs) : 1;
    this.current = fading ? mixLook(this.from, this.to, f) : this.to;
    this.night = this.nightFrom + (this.nightTo - this.nightFrom) * f;
    if (this.world) {
      this.worldFrame(now, f, shown);
      if (this.realWater) return;
    }

    // Paint at 60 Hz while something moves (the storm), 20 Hz for the idle shimmer.
    const busy = fading || !!this.reveal || this.submergedStep > 0;
    if (!busy && now - this.lastPaint < 50) return;
    this.lastPaint = now;

    const L = this.current;
    for (const k of STEPS) {
      const c = L.fill[k - 1]!;
      const s = this.reduce ? 1 : 1 + SHIMMER * Math.sin((2 * Math.PI * now) / SHIMMER_MS + k * 2.1);
      this.paint(`water-${k}`, 'fill-color', css([c[0], c[1], c[2], Math.round(c[3] * s * 1000) / 1000]));
      this.paint(`water-edge-${k}`, 'line-color', css(L.edge));
      this.paint(`water-glow-${k}`, 'line-color', css(L.glow));
      if (this.threeD) {
        const e = L.extrude[k - 1]!;
        this.paint(`water-3d-${k}`, 'fill-extrusion-color', css([e[0], e[1], e[2], 1]));
        // The extrusion fades in behind the spreading fill, so it rises out of water already there.
        const P = this.stepP[k - 1]!;
        this.paint(`water-3d-${k}`, 'fill-extrusion-opacity', Math.round(e[3] * smooth((P - 0.25) / 0.75) * 100) / 100);
      }
    }
    if (this.submergedStep > 0) {
      this.paint('submerged', 'line-color', css(L.under));
      // Crossfade the dash phases: the dashes slide along each street's direction.
      const c = this.reduce ? 0 : (now / FLOW_MS) % DASH_PHASES;
      for (let j = 0; j < DASH_PHASES; j++) {
        let d = Math.abs(c - j);
        d = Math.min(d, DASH_PHASES - d);
        const o = Math.max(0, 1 - d);
        this.paint(`submerged-flow-${j}`, 'line-color', css(L.dash));
        this.paint(`submerged-flow-${j}`, 'line-opacity', Math.round(o * 50) / 50);
      }
    }
  }
}
