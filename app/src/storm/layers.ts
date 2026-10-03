// deck.gl layers for the storm, rebuilt every animation frame from the storm clock `t` (ms).
//
// Per frame only cheap things change: a uniform (flood dot growth, TripsLayer time) or two
// double-buffered typed arrays (resident positions and colors). Everything else is cached and
// reused, so deck.gl skips it. With reduced motion every change is instant.
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions';
import { TripsLayer } from '@deck.gl/geo-layers';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { FINAL_FLOOD_STEP } from '@shared/config';
import type { FloodDot } from '@shared/data';
import type { FloodRoad } from '@shared/types';
import type { MapData } from '../data';
import { DOT_RADIUS_M, withAlpha } from '../map/layers';
import { tokens } from '../tokens';
import { DASH_MS, FATE_STAYS, FATE_STRANDED, FATE_TRAVELS, GROW_MS, stepStart, type Storm } from './sim';

const easeOut = (x: number) => 1 - (1 - x) ** 3;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Closed roads: 4 px --alarm, dashed while closing (DESIGN.md "Map"). */
const ROAD_PX = 4;
const DASH = new PathStyleExtension({ dash: true });
/** Short --safe trails behind travelling residents. */
const TRAIL_MS = 450;

export interface StormRenderer {
  /** Layers for storm time `t`, in draw order: water, roads, then residents (under the pieces). */
  water: (t: number) => Layer[];
  residents: (t: number) => Layer[];
  /** Nothing changes after this time; the last frame can be reused. */
  settled: (t: number) => boolean;
}

export function stormRenderer(storm: Storm, data: MapData, reduce: boolean): StormRenderer {
  const { rgb } = tokens();

  // Water: one dot layer per step, growing from 0 when the step begins.
  const dotsByStep: FloodDot[][] = [];
  for (const d of data.floodDots) (dotsByStep[d[2]] ??= []).push(d);
  const floodColor = withAlpha(rgb.flood, 0.75);
  const fullDots: (Layer | undefined)[] = [];
  const dotsLayer = (k: number, p: number) =>
    new ScatterplotLayer<FloodDot>({
      id: `storm-flood-${k}`,
      data: dotsByStep[k] ?? [],
      getPosition: (d) => [d[0], d[1]],
      getRadius: DOT_RADIUS_M[k] ?? 20,
      getFillColor: floodColor,
      radiusUnits: 'meters',
      // The pixel clamps scale too, so the growth shows at the city-wide zoom as well.
      radiusScale: p,
      radiusMinPixels: 1.2 * p,
      radiusMaxPixels: 10 * p,
    });
  const water = (t: number): Layer[] => {
    const out: Layer[] = [];
    for (let k = 1; k <= FINAL_FLOOD_STEP; k++) {
      const since = t - stepStart(k);
      if (since < 0) continue;
      const p = reduce ? 1 : easeOut(clamp01(since / GROW_MS));
      out.push(p >= 1 ? (fullDots[k] ??= dotsLayer(k, 1)) : dotsLayer(k, p));
    }
    return out;
  };

  // Roads: protected ones stay ink; each step's roads close dashed, then solid --alarm.
  const roadProps = {
    getPath: (r: FloodRoad) => r.coords,
    widthUnits: 'pixels' as const,
    getWidth: ROAD_PX,
    capRounded: true,
    jointRounded: true,
  };
  const heldLayer = new PathLayer<FloodRoad>({ id: 'storm-roads-held', data: storm.held, getColor: rgb.ink, ...roadProps });
  const roadCache = new Map<string, Layer[]>();
  const roads = (t: number): Layer[] => {
    const stages = [1, 2, 3].map((k) => (t < stepStart(k) ? 0 : t < stepStart(k) + DASH_MS ? 1 : 2));
    const key = stages.join('');
    let layers = roadCache.get(key);
    if (!layers) {
      const pick = (stage: number) => stages.flatMap((s, j) => (s === stage ? (storm.closing[j + 1] ?? []) : []));
      layers = [
        heldLayer,
        new PathLayer<FloodRoad, PathStyleExtensionProps<FloodRoad>>({
          id: 'storm-roads-closing',
          data: pick(1),
          getColor: rgb.alarm,
          ...roadProps,
          capRounded: false,
          getDashArray: [2.5, 1.5],
          dashJustified: true,
          extensions: [DASH],
        }),
        new PathLayer<FloodRoad>({ id: 'storm-roads-closed', data: pick(2), getColor: rgb.alarm, ...roadProps }),
      ];
      roadCache.set(key, layers);
    }
    return layers;
  };

  // Residents: positions and colors are written into one of two buffers per frame (deck.gl skips
  // an upload when it sees the same array again, so the arrays alternate).
  const res = storm.residents;
  const { n } = res;
  const pos = [new Float32Array(2 * n), new Float32Array(2 * n)];
  const fill = [new Uint8Array(4 * n), new Uint8Array(4 * n)];
  const ring = [new Uint8Array(4 * n), new Uint8Array(4 * n)];
  const pending = withAlpha(rgb.ink, 0.55);
  const safe = withAlpha(rgb.safe, 1);
  const alarm = withAlpha(rgb.alarm, 1);
  let frame = 0;
  let last: Layer[] | null = null;
  let lastSettled = false;

  const travellerPath = (k: number): [number, number][] => [
    [res.home[2 * k]!, res.home[2 * k + 1]!],
    [res.dest[2 * k]!, res.dest[2 * k + 1]!],
  ];
  const tripsData = Array.from(storm.travellers);
  const tripsProps = {
    id: 'storm-trails',
    data: tripsData,
    getPath: travellerPath,
    getTimestamps: (k: number) => [res.leave[k]!, res.arrive[k]!],
    getColor: rgb.safe,
    getWidth: 2,
    widthUnits: 'pixels' as const,
    capRounded: true,
    fadeTrail: true,
    trailLength: TRAIL_MS,
  };

  const settled = (t: number) => t > storm.settledMs;

  // Halos: a --safe disc behind each shelter and pickup that grows as its people arrive, so the
  // crowd reads at the city view too, where it would hide under the piece.
  const arrived = new Int32Array(storm.places.length);
  const most = Math.max(1, ...storm.places.map((p) => p.total));
  const haloProps = {
    id: 'storm-halos',
    data: storm.places,
    getPosition: (p: Storm['places'][number]) => p.at,
    radiusUnits: 'pixels' as const,
    getFillColor: withAlpha(rgb.safe, 0.85),
    stroked: true,
    getLineColor: rgb.ink,
    lineWidthUnits: 'pixels' as const,
    getLineWidth: 2,
  };

  const residents = (t: number): Layer[] => {
    if (last && lastSettled) return last;
    const b = frame++ % 2;
    const p = pos[b]!;
    const f = fill[b]!;
    const r = ring[b]!;
    arrived.fill(0);
    for (let k = 0; k < n; k++) {
      const gone = t >= res.leave[k]!;
      const fate = res.fate[k]!;
      let x = res.home[2 * k]!;
      let y = res.home[2 * k + 1]!;
      if (gone && fate === FATE_TRAVELS) {
        const span = res.arrive[k]! - res.leave[k]!;
        const q = reduce || span <= 0 ? 1 : clamp01((t - res.leave[k]!) / span);
        x += (res.dest[2 * k]! - x) * q;
        y += (res.dest[2 * k + 1]! - y) * q;
        if (q >= 1) arrived[res.to[k]!]!++;
      }
      p[2 * k] = x;
      p[2 * k + 1] = y;
      const c = !gone ? pending : fate === FATE_TRAVELS || fate === FATE_STAYS ? safe : null;
      f.set(c ?? [0, 0, 0, 0], 4 * k);
      r.set(gone && fate === FATE_STRANDED ? alarm : [0, 0, 0, 0], 4 * k);
    }
    const layers: Layer[] = [];
    if (!reduce && t < storm.settledMs) layers.push(new TripsLayer<number>({ ...tripsProps, currentTime: t }));
    layers.push(
      // Stranded people stop where they are and become hollow --alarm rings.
      new ScatterplotLayer({
        id: 'storm-stranded',
        data: { length: n, attributes: { getPosition: { value: res.home, size: 2 }, getLineColor: { value: r, size: 4, normalized: true } } },
        getRadius: 22,
        radiusUnits: 'meters',
        radiusMinPixels: 2.4,
        radiusMaxPixels: 6,
        stroked: true,
        filled: false,
        lineWidthUnits: 'pixels',
        getLineWidth: 1.2,
      }),
      new ScatterplotLayer({
        id: 'storm-residents',
        data: { length: n, attributes: { getPosition: { value: p, size: 2 }, getFillColor: { value: f, size: 4, normalized: true } } },
        getRadius: 16,
        radiusUnits: 'meters',
        radiusMinPixels: 1.6,
        radiusMaxPixels: 4,
      }),
      new ScatterplotLayer({
        ...haloProps,
        // Starts just outside the 30 px disc and grows by the share of the busiest place's crowd.
        getRadius: (_: unknown, { index }: { index: number }) =>
          arrived[index]! > 0 ? 18 + 20 * Math.sqrt(arrived[index]! / most) : 0,
        updateTriggers: { getRadius: frame },
      }),
    );
    last = layers;
    lastSettled = settled(t);
    return layers;
  };

  return { water: (t) => [...water(t), ...roads(t)], residents, settled };
}

let warm: Layer[] | null = null;
/**
 * Hidden layers of the storm's new types, added during planning so their shaders compile before
 * the storm starts (otherwise its first frame stalls ~600 ms while the GPU links them).
 */
export function stormWarmLayers(): Layer[] {
  return (warm ??= [
    new TripsLayer<[number, number][]>({ id: 'warm-trails', data: [], visible: false, getPath: (d) => d, getTimestamps: () => [] }),
    new PathLayer<FloodRoad, PathStyleExtensionProps<FloodRoad>>({
      id: 'warm-dashes',
      data: [],
      visible: false,
      getPath: (r) => r.coords,
      extensions: [DASH],
    }),
  ]);
}
