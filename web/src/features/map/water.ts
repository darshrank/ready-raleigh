/**
 * Realistic flood water, ported from the sakhi/visual-overhaul branch (app/src/map/flood.ts):
 * native MapLibre layers from the FEMA flood zones, drawn above streets and below labels.
 *  - per class (floodway, 1%, 0.2%): a fill, a soft waterline and a night glow, with a slow shimmer;
 *  - 3D water when the camera tilts (6 / 3 / 1.5 m), rising out of the water already there;
 *  - the real streets under the water (clipped from the loaded vector tiles against a 15 m flood
 *    grid) as a dark band with flowing dashes, and road-closed barriers where streets enter it.
 *
 * Sakhi's version grew each step on a fixed storm clock. Here every part of the water arrives on the
 * simulation's own clock with the engine's formula (t0[class] + distance to earlier water / spread),
 * so pause, speed and scrubbing stay in sync with the agents and road closures.
 *
 * Animation only touches cheap paths (constant paint values, feature-state, filters, visibility),
 * so the map never re-tiles mid-storm.
 */
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon, Position } from "geojson";
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MaplibreMap, MapSourceDataEvent } from "maplibre-gl";

export const STEPS = [1, 2, 3] as const;
type Step = (typeof STEPS)[number];

const FLOOD = "rr-flood";
const SUBMERGED = "rr-submerged";
const CLOSURES = "rr-closures";
const BARRIER = "rr-road-closed";
/** Water is drawn under this layer (the first label layer of features/map/style.ts). */
const BEFORE = "road-label";

const DEPTH_M: Record<Step, number> = { 1: 6, 2: 3, 3: 1.5 };
const TILT_3D = 20;
/** A part fades in over this many simulated hours after its water arrives. */
const GROW_H = 0.8;

const emptyFc = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });
const byStep = (k: number): ExpressionSpecification => ["==", ["get", "step"], k];
const zoomed = (...stops: number[]): ExpressionSpecification => ["interpolate", ["exponential", 1.5], ["zoom"], ...stops] as ExpressionSpecification;
const revealed: ExpressionSpecification = ["coalesce", ["feature-state", "p"], 1];

// ---------------------------------------------------------------------------------------------- look

type RGB = [number, number, number];
type RGBA = [number, number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const C = {
  flood: hex("#0078bf"),
  floodDeep: hex("#00508a"),
  bond: hex("#f7f9f8"),
  ink: hex("#1e2a47"),
  stormLand: hex("#172440"),
  stormWater: hex("#2a9deb"),
  stormGlow: hex("#7ccbff"),
};
const tint = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const A = (c: RGB, alpha: number): RGBA => [c[0], c[1], c[2], alpha];
const css = (c: RGBA) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, c[3])).toFixed(3)})`;

interface Look {
  fill: RGBA[];
  edge: RGBA;
  glow: RGBA;
  extrude: RGBA[];
  under: RGBA;
  dash: RGBA;
}

/** 'preview' is the faint planning view; 'full' is the storm and its aftermath. */
export type WaterLevel = "preview" | "full";

function look(night: boolean, level: WaterLevel): Look {
  const k = level === "preview" ? 0.75 : 1;
  if (night) {
    const w = C.stormWater;
    return {
      fill: [A(tint(w, C.floodDeep, 0.3), 0.72 * k), A(w, 0.46 * k), A(w, 0.3 * k)],
      edge: A(C.stormGlow, 0.3 * k),
      glow: A(C.stormGlow, 0.2 * k),
      extrude: [A(tint(w, C.floodDeep, 0.3), 0.36), A(w, 0.36), A(w, 0.36)],
      under: A(tint(C.stormLand, C.floodDeep, 0.45), 0.85),
      dash: A(C.stormGlow, 1),
    };
  }
  return {
    fill: [A(C.floodDeep, 0.6 * k), A(C.flood, 0.48 * k), A(tint(C.flood, C.bond, 0.25), 0.36 * k)],
    edge: A(C.floodDeep, 0.5 * k),
    glow: A(C.flood, 0),
    extrude: [A(C.floodDeep, 0.45), A(C.flood, 0.45), A(tint(C.flood, C.bond, 0.25), 0.45)],
    under: A(tint(C.floodDeep, C.ink, 0.35), 0.8),
    dash: A(C.bond, 0.95),
  };
}

const mix = (x: RGBA, y: RGBA, t: number): RGBA => [
  Math.round(x[0] + (y[0] - x[0]) * t),
  Math.round(x[1] + (y[1] - x[1]) * t),
  Math.round(x[2] + (y[2] - x[2]) * t),
  x[3] + (y[3] - x[3]) * t,
];
/** Night (daylight 0) to day (1). */
function lookAt(daylight: number, level: WaterLevel): Look {
  const n = look(true, level);
  const d = look(false, level);
  return {
    fill: n.fill.map((c, i) => mix(c, d.fill[i], daylight)),
    edge: mix(n.edge, d.edge, daylight),
    glow: mix(n.glow, d.glow, daylight),
    extrude: n.extrude.map((c, i) => mix(c, d.extrude[i], daylight)),
    under: mix(n.under, d.under, daylight),
    dash: mix(n.dash, d.dash, daylight),
  };
}

// ---------------------------------------------------------------------------------------------- layers

const DASH_PHASES = 4;
const dashPattern = (j: number): number[] => (j === 0 ? [2, 6] : [0, 2 * j, 2, 6 - 2 * j]);

function layers(): LayerSpecification[] {
  const L = look(false, "preview");
  const water = STEPS.map(
    (k): LayerSpecification => ({
      id: `rr-water-${k}`,
      type: "fill",
      source: FLOOD,
      filter: byStep(k),
      paint: { "fill-color": css(L.fill[k - 1]), "fill-opacity": revealed, "fill-antialias": false },
    }),
  );
  const edges = STEPS.flatMap((k): LayerSpecification[] => [
    {
      id: `rr-water-glow-${k}`,
      type: "line",
      source: FLOOD,
      filter: byStep(k),
      layout: { "line-join": "round" },
      paint: { "line-color": css(L.glow), "line-width": zoomed(10, 4, 14, 12, 17, 26), "line-blur": zoomed(10, 4, 14, 12, 17, 26), "line-opacity": revealed },
    },
    {
      id: `rr-water-edge-${k}`,
      type: "line",
      source: FLOOD,
      filter: byStep(k),
      layout: { "line-join": "round" },
      paint: { "line-color": css(L.edge), "line-width": zoomed(10, 1.8, 13, 3, 17, 9), "line-blur": zoomed(10, 1.2, 13, 3, 17, 9), "line-opacity": revealed },
    },
  ]);
  const none: ExpressionSpecification = ["==", ["get", "step"], 0];
  const under: LayerSpecification = {
    id: "rr-submerged",
    type: "line",
    source: SUBMERGED,
    filter: none,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": css(L.under), "line-width": zoomed(10, 1.6, 13, 4, 17, 18) },
  };
  const dashes = Array.from(
    { length: DASH_PHASES },
    (_, j): LayerSpecification => ({
      id: `rr-submerged-flow-${j}`,
      type: "line",
      source: SUBMERGED,
      filter: none,
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": css(L.dash), "line-width": zoomed(10, 0.8, 13, 1.6, 17, 5.5), "line-dasharray": dashPattern(j), "line-opacity": j === 0 ? 1 : 0 },
    }),
  );
  const water3d = STEPS.map(
    (k): LayerSpecification => ({
      id: `rr-water-3d-${k}`,
      type: "fill-extrusion",
      source: FLOOD,
      filter: byStep(k),
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": css([...L.extrude[k - 1].slice(0, 3), 1] as RGBA),
        "fill-extrusion-height": ["*", DEPTH_M[k], revealed],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": L.extrude[k - 1][3],
        "fill-extrusion-vertical-gradient": false,
      },
    }),
  );
  const closures: LayerSpecification = {
    id: "rr-road-closed",
    type: "symbol",
    source: CLOSURES,
    minzoom: 12,
    filter: ["==", ["get", "k"], 0],
    layout: {
      "icon-image": BARRIER,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.55, 14, 0.75, 17, 1.05],
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "viewport",
      "icon-allow-overlap": false,
      "icon-padding": 1,
    },
  };
  return [...water, ...edges, under, ...dashes, ...water3d, closures];
}

/** The barrier: a white board with pink stripes and an ink edge, drawn at 2x. */
function barrierImage(): ImageData {
  const W = 52;
  const H = 22;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1e2a47";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#f7f9f8";
  g.fillRect(3, 3, W - 6, H - 6);
  g.save();
  g.beginPath();
  g.rect(3, 3, W - 6, H - 6);
  g.clip();
  g.fillStyle = "#ff48b0";
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

// ---------------------------------------------------------------------------------------------- parts

const M_PER_DEG = 111_320;
/** Distances are capped here: water that far from earlier water arrives with the last of its class. */
const SPREAD_CAP_M = 3000;

interface Parts {
  fc: FeatureCollection<Polygon, { step: number }>;
  step: Uint8Array;
  /** simulated hour at which each part's water arrives */
  arrive: Float32Array;
  ids: number[][];
}

class PointGrid {
  private cells = new Map<string, number[]>();
  constructor(private size: number) {}
  add(x: number, y: number) {
    const key = `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
    const list = this.cells.get(key);
    if (list) list.push(x, y);
    else this.cells.set(key, [x, y]);
  }
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
            const d = (list[q] - x) ** 2 + (list[q + 1] - y) ** 2;
            if (d < best) best = d;
          }
        }
    }
    return Math.sqrt(best);
  }
}

export interface WaterTiming {
  /** hour each class starts (the engine's t0) */
  t0: Record<Step, number>;
  /** metres per hour each class spreads (the engine's spread) */
  spread: Record<Step, number>;
}

function prepareParts(raw: FeatureCollection<Polygon | MultiPolygon, { cls: number }>, timing: WaterTiming): Parts {
  const polys: { step: Step; rings: Position[][] }[] = [];
  for (const f of raw.features) {
    const step = Number(f.properties.cls) as Step;
    if (!STEPS.includes(step)) continue;
    const list = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of list) polys.push({ step, rings });
  }
  const lat0 = polys[0]?.rings[0]?.[0]?.[1] ?? 35.8;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const xy = (p: Position): [number, number] => [p[0] * kx, p[1] * M_PER_DEG];

  const n = polys.length;
  const step = new Uint8Array(n);
  const arrive = new Float32Array(n);
  const ids: number[][] = [[], [], []];
  polys.forEach((p, i) => {
    step[i] = p.step;
    ids[p.step - 1].push(i);
  });

  // The floodway grows out of its main channels (the fifth of its parts with the most vertices) into
  // the tributaries; each later class grows out of the water already there.
  const sample = (ring: Position[]) => ring.filter((_, k) => k % Math.max(1, Math.floor(ring.length / 24)) === 0);
  const seeds = new PointGrid(250);
  const first = [...ids[0]].sort((x, y) => polys[y].rings[0].length - polys[x].rings[0].length);
  const main = new Set(first.slice(0, Math.max(1, Math.ceil(first.length / 5))));
  for (const i of main) for (const p of polys[i].rings[0]) seeds.add(...xy(p));
  for (const k of STEPS) {
    for (const i of ids[k - 1]) {
      let d = 0;
      if (!(k === 1 && main.has(i))) {
        d = SPREAD_CAP_M;
        for (const p of sample(polys[i].rings[0])) d = Math.min(d, seeds.nearest(...xy(p), SPREAD_CAP_M));
      }
      arrive[i] = timing.t0[k] + d / Math.max(1, timing.spread[k]);
    }
    for (const i of ids[k - 1]) if (!(k === 1 && main.has(i))) for (const p of polys[i].rings[0]) seeds.add(...xy(p));
  }
  const fc: Parts["fc"] = {
    type: "FeatureCollection",
    features: polys.map((p, i) => ({ type: "Feature", id: i, properties: { step: p.step }, geometry: { type: "Polygon", coordinates: p.rings } })),
  };
  return { fc, step, arrive, ids };
}

// ---------------------------------------------------------------------------------------------- street clipping

/** Coarse blocks for skipping street segments far from any water: 16 cells, about 240 m. */
const COARSE = 16;

/** The flood classes as a grid of about 15 m cells (0 = dry, else the class), filled even-odd per polygon. */
class FloodRaster {
  readonly cell = 15;
  private data: Uint8Array;
  private coarse: Uint8Array;
  private cw: number;
  private w: number;
  private h: number;
  private lon0: number;
  private lat0: number;
  private kx: number;
  private queue: Parts["fc"]["features"];

  constructor(fc: Parts["fc"]) {
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of fc.features)
      for (const p of f.geometry.coordinates[0]) {
        w = Math.min(w, p[0]);
        e = Math.max(e, p[0]);
        s = Math.min(s, p[1]);
        n = Math.max(n, p[1]);
      }
    this.lon0 = w;
    this.lat0 = s;
    this.kx = M_PER_DEG * Math.cos((((s + n) / 2) * Math.PI) / 180);
    this.w = Math.max(1, Math.ceil(((e - w) * this.kx) / this.cell) + 1);
    this.h = Math.max(1, Math.ceil(((n - s) * M_PER_DEG) / this.cell) + 1);
    this.data = new Uint8Array(this.w * this.h);
    this.cw = Math.ceil(this.w / COARSE);
    this.coarse = new Uint8Array(this.cw * Math.ceil(this.h / COARSE));
    // fill the most severe class last so it wins where classes overlap
    this.queue = [...fc.features].sort((a, b) => a.properties.step - b.properties.step);
  }

  get done() {
    return this.queue.length === 0;
  }

  build(until = Infinity) {
    while (this.queue.length && performance.now() < until) {
      const f = this.queue.pop()!;
      this.fill(f.geometry.coordinates, f.properties.step);
    }
    return this.done;
  }

  near(a: Position, b: Position): boolean {
    const c0 = Math.floor(this.gx(Math.min(a[0], b[0])) / COARSE) - 1;
    const c1 = Math.floor(this.gx(Math.max(a[0], b[0])) / COARSE) + 1;
    const r0 = Math.floor(this.gy(Math.min(a[1], b[1])) / COARSE) - 1;
    const r1 = Math.floor(this.gy(Math.max(a[1], b[1])) / COARSE) + 1;
    const rows = this.coarse.length / this.cw;
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(this.cw - 1, c1); c++) if (this.coarse[r * this.cw + c]) return true;
    return false;
  }

  private gx = (lon: number) => ((lon - this.lon0) * this.kx) / this.cell;
  private gy = (lat: number) => ((lat - this.lat0) * M_PER_DEG) / this.cell;

  private fill(rings: Position[][], step: number) {
    const edges: number[][] = [];
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const ring of rings)
      for (let k = 0; k + 1 < ring.length; k++) {
        let x0 = this.gx(ring[k][0]),
          y0 = this.gy(ring[k][1]);
        let x1 = this.gx(ring[k + 1][0]),
          y1 = this.gy(ring[k + 1][1]);
        if (y0 === y1) continue;
        if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
        edges.push([y0, y1, x0, (x1 - x0) / (y1 - y0)]);
        ymin = Math.min(ymin, y0);
        ymax = Math.max(ymax, y1);
      }
    edges.sort((p, q) => p[0] - q[0]);
    let next = 0;
    let active: number[][] = [];
    const xs: number[] = [];
    for (let r = Math.max(0, Math.floor(ymin)); r <= Math.min(this.h - 1, Math.ceil(ymax)); r++) {
      const yc = r + 0.5;
      while (next < edges.length && edges[next][0] <= yc) active.push(edges[next++]);
      active = active.filter((ed) => ed[1] > yc);
      xs.length = 0;
      for (const ed of active) if (ed[0] <= yc) xs.push(ed[2] + (yc - ed[0]) * ed[3]);
      xs.sort((p, q) => p - q);
      const row = r * this.w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
        const c1 = Math.min(this.w - 1, Math.floor(xs[k + 1] - 0.5));
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
    return c < 0 || r < 0 || c >= this.w || r >= this.h ? 0 : this.data[r * this.w + c];
  }
}

/** Streets that can go under: everything a car drives on. Motorway and trunk bridges stay dry. */
const STREETS: ExpressionSpecification = [
  "all",
  ["!=", ["get", "brunnel"], "tunnel"],
  ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"], true, false],
  ["!", ["all", ["==", ["get", "brunnel"], "bridge"], ["match", ["get", "class"], ["motorway", "trunk"], true, false]]],
];
const SAMPLE_M = 6;
const BARRIER_OUT_M = 8;

function clipStreets(map: MaplibreMap, raster: FloodRaster) {
  const runs: Feature<LineString, { step: number }>[] = [];
  const closures: Feature<Point, { k: number; bearing: number }>[] = [];
  const seen = new Set<string>();
  if (!map.getSource("omt")) return { runs: emptyFc(), closures: emptyFc() };
  const features = map.querySourceFeatures("omt", { sourceLayer: "transportation", filter: STREETS });
  const kx = M_PER_DEG * Math.cos((map.getCenter().lat * Math.PI) / 180);

  for (const f of features) {
    const g = f.geometry;
    const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    for (const line of lines) {
      let run: Position[] | null = null;
      let prev = line.length ? raster.at(line[0][0], line[0][1]) : 0;
      if (prev > 0) run = [line[0]];
      for (let s = 0; s + 1 < line.length; s++) {
        const a = line[s];
        const b = line[s + 1];
        const dx = (b[0] - a[0]) * kx;
        const dy = (b[1] - a[1]) * M_PER_DEG;
        const len = Math.hypot(dx, dy);
        if (prev === 0 && !raster.near(a, b)) {
          if (run) run.push(b);
          continue;
        }
        const n = Math.max(1, Math.ceil(len / SAMPLE_M));
        const at = (t: number): Position => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
        for (let i = 1; i <= n; i++) {
          const p = at(i / n);
          const cur = raster.at(p[0], p[1]);
          if (cur === prev) continue;
          const tm = (i - 0.5) / n;
          const m = at(tm);
          if (run) {
            run.push(m);
            if (run.length > 1) runs.push({ type: "Feature", properties: { step: prev }, geometry: { type: "LineString", coordinates: run } });
          }
          run = cur > 0 ? [m] : null;
          for (const k of STEPS) {
            const wetBefore = prev > 0 && prev <= k;
            const wetAfter = cur > 0 && cur <= k;
            if (wetBefore === wetAfter) continue;
            const out = len > 0 ? BARRIER_OUT_M / len : 0;
            const q = at(Math.min(1, Math.max(0, wetBefore ? tm + out : tm - out)));
            const key = `${k}:${q[0].toFixed(4)},${q[1].toFixed(4)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            closures.push({ type: "Feature", properties: { k, bearing }, geometry: { type: "Point", coordinates: q } });
          }
          prev = cur;
        }
        if (run) run.push(b);
      }
      if (run && run.length > 1) runs.push({ type: "Feature", properties: { step: prev }, geometry: { type: "LineString", coordinates: run } });
    }
  }
  return { runs: { type: "FeatureCollection", features: runs } as FeatureCollection, closures: { type: "FeatureCollection", features: closures } as FeatureCollection };
}

// ---------------------------------------------------------------------------------------------- the animator

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const SHIMMER = 0.07;
const SHIMMER_MS = 3200;
const FLOW_MS = 260;

/** What the water should show right now. */
export interface WaterState {
  /** null: every part full (planning preview, results); else the simulated hour */
  hour: number | null;
  level: WaterLevel;
  /** 0 night .. 1 day */
  daylight: number;
  /** show streets under water up to this class (0 hides them) */
  submerged: number;
  visible: boolean;
}

export class FloodWater {
  private parts: Parts | null = null;
  private raster: FloodRaster | null = null;
  private state: WaterState = { hour: null, level: "preview", daylight: 1, submerged: 0, visible: true };
  private p = new Float32Array(0);
  private submergedStep = 0;
  private threeD = false;
  private raf = 0;
  private lastPaint = 0;
  private clipTimer = 0;
  private sent = new Map<string, string | number>();
  private alive = true;

  constructor(
    private map: MaplibreMap,
    zones: FeatureCollection<Polygon | MultiPolygon, { cls: number }>,
    timing: WaterTiming,
    private reduce: boolean,
  ) {
    if (!map.hasImage(BARRIER)) map.addImage(BARRIER, barrierImage(), { pixelRatio: 2 });
    // idempotent, so a retry after a half-loaded style picks up where it stopped
    for (const id of [FLOOD, SUBMERGED, CLOSURES]) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: emptyFc() });
    const before = map.getLayer(BEFORE) ? BEFORE : undefined;
    for (const l of layers()) if (!map.getLayer(l.id)) map.addLayer(l, before);
    this.parts = prepareParts(zones, timing);
    this.p = new Float32Array(this.parts.step.length).fill(1);
    (map.getSource(FLOOD) as GeoJSONSource).setData(this.parts.fc);
    this.buildRaster();
    map.on("pitch", this.onPitch);
    map.on("sourcedata", this.onSourceData);
    this.onPitch();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.clipTimer);
    this.map.off("pitch", this.onPitch);
    this.map.off("sourcedata", this.onSourceData);
    try {
      for (const l of layers()) if (this.map.getLayer(l.id)) this.map.removeLayer(l.id);
      for (const s of [FLOOD, SUBMERGED, CLOSURES]) if (this.map.getSource(s)) this.map.removeSource(s);
    } catch {
      // the map is already gone
    }
  }

  set(next: Partial<WaterState>) {
    const prev = this.state;
    this.state = { ...prev, ...next };
    if (prev.visible !== this.state.visible) {
      const vis = this.state.visible ? "visible" : "none";
      for (const l of layers()) if (!l.id.startsWith("rr-water-3d")) this.map.setLayoutProperty(l.id, "visibility", vis);
      this.threeD = false;
      this.onPitch();
    }
    if (prev.level !== this.state.level) this.onPitch();
    if (this.state.submerged !== this.submergedStep) this.showSubmerged(this.state.submerged);
    this.writeReveal();
    this.lastPaint = 0;
  }

  private showSubmerged(k: number) {
    const was = this.submergedStep;
    this.submergedStep = k;
    const filter: ExpressionSpecification = ["all", [">", ["get", "step"], 0], ["<=", ["get", "step"], k]];
    for (const id of ["rr-submerged", ...Array.from({ length: DASH_PHASES }, (_, j) => `rr-submerged-flow-${j}`)]) this.map.setFilter(id, filter);
    this.map.setFilter("rr-road-closed", ["==", ["get", "k"], k]);
    if (k > 0 && was === 0) this.clipSoon(0);
    if (k === 0) {
      (this.map.getSource(SUBMERGED) as GeoJSONSource | undefined)?.setData(emptyFc());
      (this.map.getSource(CLOSURES) as GeoJSONSource | undefined)?.setData(emptyFc());
    }
  }

  private buildRaster() {
    if (!this.parts) return;
    const raster = (this.raster = new FloodRaster(this.parts.fc));
    const idle = (fn: (d: { timeRemaining: () => number }) => void) =>
      typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(() => fn({ timeRemaining: () => 8 }), 50);
    const step = (d: { timeRemaining: () => number }) => {
      if (!this.alive || raster.done) return;
      if (!raster.build(performance.now() + Math.min(8, Math.max(2, d.timeRemaining())))) idle(step);
    };
    idle(step);
  }

  private onPitch = () => {
    // 3D water belongs to the storm; the planning preview stays flat and calm
    const on = this.state.visible && this.state.level === "full" && this.map.getPitch() > TILT_3D;
    if (on === this.threeD) return;
    this.threeD = on;
    for (const k of STEPS) this.map.setLayoutProperty(`rr-water-3d-${k}`, "visibility", on ? "visible" : "none");
    this.lastPaint = 0;
  };

  private onSourceData = (e: MapSourceDataEvent) => {
    if (this.submergedStep > 0 && e.sourceId === "omt" && e.tile) this.clipSoon(350);
  };

  private clipSoon(ms: number) {
    clearTimeout(this.clipTimer);
    this.clipTimer = window.setTimeout(() => {
      if (!this.alive || !this.submergedStep || !this.parts) return;
      if (!this.raster) this.raster = new FloodRaster(this.parts.fc);
      this.raster.build();
      const { runs, closures } = clipStreets(this.map, this.raster);
      (this.map.getSource(SUBMERGED) as GeoJSONSource | undefined)?.setData(runs);
      (this.map.getSource(CLOSURES) as GeoJSONSource | undefined)?.setData(closures);
    }, ms);
  }

  private paint(layer: string, prop: string, value: string | number) {
    const key = `${layer}|${prop}`;
    if (this.sent.get(key) === value) return;
    this.sent.set(key, value);
    this.map.setPaintProperty(layer, prop, value);
  }

  /** Each part's growth from the simulated hour, written to feature-state only where it changed. */
  private writeReveal() {
    const parts = this.parts;
    if (!parts) return;
    const h = this.state.hour;
    for (let i = 0; i < parts.arrive.length; i++) {
      const v = h === null || this.reduce ? (h === null || h >= parts.arrive[i] ? 1 : 0) : Math.round(12 * smooth((h - parts.arrive[i]) / GROW_H)) / 12;
      if (v === this.p[i]) continue;
      this.p[i] = v;
      this.map.setFeatureState({ source: FLOOD, id: i }, { p: v });
    }
  }

  /** Share of each class's water that is in, for the 3D rise. */
  private classShare(): number[] {
    const parts = this.parts;
    if (!parts) return [1, 1, 1];
    return STEPS.map((k) => {
      const list = parts.ids[k - 1];
      if (!list.length) return 0;
      let s = 0;
      for (const i of list) s += this.p[i];
      return s / list.length;
    });
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.state.visible) return;
    const busy = this.state.hour !== null || this.submergedStep > 0;
    if (!busy && now - this.lastPaint < 50) return;
    this.lastPaint = now;

    const L = lookAt(this.state.daylight, this.state.level);
    const share = this.threeD ? this.classShare() : null;
    for (const k of STEPS) {
      const c = L.fill[k - 1];
      const s = this.reduce ? 1 : 1 + SHIMMER * Math.sin((2 * Math.PI * now) / SHIMMER_MS + k * 2.1);
      this.paint(`rr-water-${k}`, "fill-color", css([c[0], c[1], c[2], Math.round(c[3] * s * 1000) / 1000]));
      this.paint(`rr-water-edge-${k}`, "line-color", css(L.edge));
      this.paint(`rr-water-glow-${k}`, "line-color", css(L.glow));
      if (share) {
        const e = L.extrude[k - 1];
        this.paint(`rr-water-3d-${k}`, "fill-extrusion-color", css([e[0], e[1], e[2], 1]));
        // the extrusion fades in behind the spreading fill, so it rises out of water already there
        this.paint(`rr-water-3d-${k}`, "fill-extrusion-opacity", Math.round(e[3] * smooth((share[k - 1] - 0.25) / 0.75) * 100) / 100);
      }
    }
    if (this.submergedStep > 0) {
      this.paint("rr-submerged", "line-color", css(L.under));
      const c = this.reduce ? 0 : (now / FLOW_MS) % DASH_PHASES;
      for (let j = 0; j < DASH_PHASES; j++) {
        let d = Math.abs(c - j);
        d = Math.min(d, DASH_PHASES - d);
        this.paint(`rr-submerged-flow-${j}`, "line-color", css(L.dash));
        this.paint(`rr-submerged-flow-${j}`, "line-opacity", Math.round(Math.max(0, 1 - d) * 50) / 50);
      }
    }
  };
}
