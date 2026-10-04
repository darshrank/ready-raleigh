// Dev only: counts what changes on the map each animation frame, so a script can check that the
// storm animates through uniforms only (docs/DESIGN.md "Performance floor").
//
// Counted per frame: MapLibre setData / setFeatureState / setPaintProperty / setLayoutProperty /
// setFilter, and deck.gl attribute uploads (by layer id). window.__fx.summary(sinceMs) returns
// the totals and the frames that had any, with times relative to the storm start when one runs.
import { Attribute, AttributeManager } from '@deck.gl/core';
import { GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
// performance.measure() timings are opt-in (?fxtime): they cost real time.
import { FX_TIMING as TIMING } from './timing';

type Counts = Record<string, number>;
interface Frame {
  t: number;
  c: Counts;
}

let current: Counts = {};
const frames: Frame[] = [];
let frameCount = 0;
let layerId = '';
let installed = false;

const bump = (k: string) => {
  current[k] = (current[k] ?? 0) + 1;
};

function stormClock(now: number): number {
  const plan = (window as unknown as { __plan?: { getState: () => { stormAt: number | null } } }).__plan;
  const at = plan?.getState().stormAt;
  return at == null ? now : now - at;
}

function patchDeck() {
  const update = AttributeManager.prototype.update;
  if (!TIMING) {
    AttributeManager.prototype.update = function (this: AttributeManager & { id: string }, ...args: Parameters<typeof update>) {
      layerId = this.id;
      try {
        return update.apply(this, args);
      } finally {
        layerId = '';
      }
    };
  } else
  AttributeManager.prototype.update = function (this: AttributeManager & { id: string }, ...args: Parameters<typeof update>) {
    layerId = this.id;
    const a = performance.now();
    try {
      return update.apply(this, args);
    } finally {
      layerId = '';
      // Per-layer attribute update time (CPU, including the GPU buffer writes it issues).
      const ms = performance.now() - a;
      if (TIMING && ms > 0.02) performance.measure(`attrs ${this.id.replace(/-(hexagon-cell|polygons-fill).*$/, '')}`, { start: a, end: a + ms });
    }
  };
  // Binary values (setBinaryValue -> setData) and accessor updates (updateBuffer) both upload.
  const A = Attribute.prototype as unknown as {
    setData: (...a: unknown[]) => unknown;
    updateBuffer: (...a: unknown[]) => boolean;
  };
  const setData = A.setData;
  A.setData = function (this: { id: string }, ...a: unknown[]) {
    if (layerId) bump(`attr:${layerId}/${this.id}`);
    return setData.apply(this, a);
  };
  const updateBuffer = A.updateBuffer;
  A.updateBuffer = function (this: { id: string }, ...a: unknown[]) {
    const changed = updateBuffer.apply(this, a);
    if (changed && layerId) bump(`attr:${layerId}/${this.id}`);
    return changed;
  };
}

function patchMap(map: MapLibreMap) {
  const m = map as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ['setPaintProperty', 'setLayoutProperty', 'setFilter', 'setFeatureState']) {
    const orig = m[name]!.bind(map);
    m[name] = (...a: unknown[]) => {
      const target = typeof a[0] === 'string' ? a[0] : (a[0] as { source?: string })?.source ?? '';
      bump(`${name}:${target}`);
      return orig(...a);
    };
  }
  // MapLibre's render, for the trace (performance.measure 'map-render').
  if (!TIMING) return;
  const r = m as unknown as { _render: (t?: number) => unknown };
  const render = r._render.bind(map);
  r._render = (t?: number) => {
    const a = performance.now();
    const out = render(t);
    performance.measure('map-render', { start: a, end: performance.now() });
    return out;
  };
}

export function installFx(map: MapLibreMap) {
  patchMap(map);
  if (installed) return;
  installed = true;
  patchDeck();
  const proto = GeoJSONSource.prototype as unknown as { setData: (...a: unknown[]) => unknown };
  const setData = proto.setData;
  proto.setData = function (this: GeoJSONSource, ...a: unknown[]) {
    bump(`setData:${this.id}`);
    return setData.apply(this, a);
  };
  const tick = (now: number) => {
    frameCount++;
    // The trace has already recorded them; an unbounded timeline buffer makes measure() slow.
    if (TIMING) performance.clearMeasures();
    if (Object.keys(current).length) frames.push({ t: Math.round(stormClock(now)), c: current });
    current = {};
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  (window as unknown as { __fx: unknown }).__fx = {
    reset() {
      frames.length = 0;
      frameCount = 0;
    },
    /** Totals and the frames with any change after storm time `since` (ms). */
    summary(since = -Infinity) {
      const hits = frames.filter((f) => f.t >= since);
      const totals: Counts = {};
      for (const f of hits) for (const [k, v] of Object.entries(f.c)) totals[k] = (totals[k] ?? 0) + v;
      return { frames: frameCount, framesWithChanges: hits.length, totals, first: hits.slice(0, 40) };
    },
  };
}
