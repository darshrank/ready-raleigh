// deck.gl layers for the storm, rebuilt every animation frame from the storm clock `t` (ms).
//
// The water and the submerged streets are MapLibre layers (map/flood.ts); this file draws the
// people on top: residents (glowing --safe as they evacuate, hollow --alarm rings when stranded),
// their trails, the crowd halos at shelters and pickups, and the roads the plan kept open.
//
// Per frame only cheap things change: a uniform (TripsLayer time) or double-buffered typed arrays
// (resident positions and colors). Everything else is cached and reused, so deck.gl skips it.
// With reduced motion every change is instant.
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { withAlpha } from '../map/layers';
import { protectedRoadsLayers } from '../plan/layers';
import { tokens } from '../tokens';
import { CLEAR_MS, FATE_STAYS, FATE_STRANDED, FATE_TRAVELS, STORM_MS, type Storm } from './sim';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Short --safe trails behind travelling residents. */
const TRAIL_MS = 450;
/** Drawn over everything, including 3D buildings and 3D water (deck.gl shares their depth buffer). */
const ON_TOP = { depthCompare: 'always' } as const;

export interface StormRenderer {
  /** Layers for storm time `t`: the roads the plan holds, then the residents (under the pieces). */
  layers: (t: number) => Layer[];
  /** Nothing changes after this time; the last frame can be reused. */
  settled: (t: number) => boolean;
}

export function stormRenderer(storm: Storm, reduce: boolean): StormRenderer {
  const { rgb } = tokens();

  // Roads the plan protects stay open: the same --safe road with an ink casing as in planning.
  const held = protectedRoadsLayers(storm.held).map((l) => l.clone({ id: `storm-${l.id}`, parameters: ON_TOP }));

  // Residents: positions and colors are written into one of two buffers per frame (deck.gl skips
  // an upload when it sees the same array again, so the arrays alternate).
  const res = storm.residents;
  const { n } = res;
  const pos = [new Float32Array(2 * n), new Float32Array(2 * n)];
  const fill = [new Uint8Array(4 * n), new Uint8Array(4 * n)];
  const glow = [new Uint8Array(4 * n), new Uint8Array(4 * n)];
  const ring = [new Uint8Array(4 * n), new Uint8Array(4 * n)];
  // Waiting residents are pale specks that read on the night map and on the day map after it.
  const pending = withAlpha(rgb['storm-label'], 0.45);
  const safe = withAlpha(rgb.safe, 1);
  const halo = withAlpha(rgb.safe, 0.28);
  const alarm = withAlpha(rgb.alarm, 1);
  const clear = [0, 0, 0, 0];
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
    getColor: withAlpha(rgb.safe, 0.7),
    getWidth: 1.5,
    widthUnits: 'pixels' as const,
    capRounded: true,
    fadeTrail: true,
    trailLength: TRAIL_MS,
    parameters: ON_TOP,
  };

  // Settled once everyone has arrived and the glow has faded with the clear.
  const settled = (t: number) => t > Math.max(storm.settledMs, STORM_MS + CLEAR_MS);

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
    parameters: ON_TOP,
  };

  const layers = (t: number): Layer[] => {
    if (last && lastSettled) return last;
    const b = frame++ % 2;
    const p = pos[b]!;
    const f = fill[b]!;
    const g = glow[b]!;
    const r = ring[b]!;
    // The glow is the storm's: it fades as daylight returns.
    const glowAlpha = Math.round(halo[3] * clamp01(1 - (t - STORM_MS) / CLEAR_MS));
    const glowNow = [halo[0], halo[1], halo[2], glowAlpha];
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
      const ok = gone && (fate === FATE_TRAVELS || fate === FATE_STAYS);
      f.set(!gone ? pending : ok ? safe : clear, 4 * k);
      g.set(ok ? glowNow : clear, 4 * k);
      r.set(gone && fate === FATE_STRANDED ? alarm : clear, 4 * k);
    }
    const out: Layer[] = [...held];
    if (!reduce && t < storm.settledMs) out.push(new TripsLayer<number>({ ...tripsProps, currentTime: t }));
    // (The glow layer below is dropped once it has faded.)
    out.push(
      // The glow: a wide, faint --safe disc under each resident who is getting out.
      new ScatterplotLayer({
        id: 'storm-glow',
        data: { length: n, attributes: { getPosition: { value: p, size: 2 }, getFillColor: { value: g, size: 4, normalized: true } } },
        getRadius: 60,
        radiusUnits: 'meters',
        radiusMinPixels: 4.5,
        radiusMaxPixels: 12,
        parameters: ON_TOP,
      }),
      // Stranded people stop where they are and become hollow --alarm rings.
      new ScatterplotLayer({
        id: 'storm-stranded',
        data: { length: n, attributes: { getPosition: { value: res.home, size: 2 }, getLineColor: { value: r, size: 4, normalized: true } } },
        getRadius: 24,
        radiusUnits: 'meters',
        radiusMinPixels: 2.8,
        radiusMaxPixels: 7,
        stroked: true,
        filled: false,
        lineWidthUnits: 'pixels',
        getLineWidth: 1.6,
        parameters: ON_TOP,
      }),
      new ScatterplotLayer({
        id: 'storm-residents',
        data: { length: n, attributes: { getPosition: { value: p, size: 2 }, getFillColor: { value: f, size: 4, normalized: true } } },
        getRadius: 16,
        radiusUnits: 'meters',
        radiusMinPixels: 1.4,
        radiusMaxPixels: 3.5,
        parameters: ON_TOP,
      }),
      new ScatterplotLayer({
        ...haloProps,
        // Starts just outside the 30 px disc and grows by the share of the busiest place's crowd.
        getRadius: (_: unknown, { index }: { index: number }) =>
          arrived[index]! > 0 ? 18 + 20 * Math.sqrt(arrived[index]! / most) : 0,
        updateTriggers: { getRadius: frame },
      }),
    );
    last = out;
    lastSettled = settled(t);
    return out;
  };

  return { layers, settled };
}

let warm: Layer[] | null = null;
/**
 * A hidden layer of the storm's one new type, added during planning so its shader compiles before
 * the storm starts (otherwise the storm's first frame stalls while the GPU links it).
 */
export function stormWarmLayers(): Layer[] {
  return (warm ??= [
    new TripsLayer<[number, number][]>({ id: 'warm-trails', data: [], visible: false, getPath: (d) => d, getTimestamps: () => [] }),
  ]);
}
