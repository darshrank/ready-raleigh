// The world (DESIGN.md "Color direction"): the realistic 3D city and the storm water, drawn by
// deck.gl layers whose look changes through shader uniforms only.
//
// `frame` is the one place those uniforms come from. FloodView writes it once per animation
// frame; each world layer copies it into its shader module in draw(). No layer prop changes per
// frame, so deck.gl never diffs or rebuilds an attribute while the storm runs.

/**
 * Kill switch: `?realism=off` keeps the previous MapLibre 3D buildings and water. The realism
 * path is the default; the switch goes away once it has passed its last check (R7).
 */
export const REALISM = typeof location === 'undefined' || !/[?&]realism=off(&|$)/.test(location.search);

export const frame = {
  /** performance.now() ms of the frame being drawn. */
  now: 0,
  /** 0 = day palette, 1 = the storm's night, in between while it fades. */
  night: 0,
  /** 0 = the faint planning preview, 1 = the storm's full water. */
  level: 0,
  /** Each step's growth, 0..1, from FloodView's RevealFn ([1, 1, 1] with no storm). */
  stepP: [1, 1, 1] as [number, number, number],
  /** Storm clock (ms since the storm started), or -1 with no storm. */
  clock: -1,
  /** When each step starts on the storm clock (ms). */
  stepStart: [0, 0, 0] as [number, number, number],
  /** 0..1 once the storm clears: the 3D water drains and the foam fades. */
  ending: 0,
  /** Lightning, 0..1 (Weather.tsx strikes). */
  flash: 0,
  /** 0..1: the camera is tilted (3D water rises). */
  tilt: 0,
  /** prefers-reduced-motion: no creeping, waves, foam or rising; everything appears per step. */
  reduce: false,
};

/** Lightning strike times (performance.now() ms), written by Weather.tsx, read by FloodView. */
export const strikes: number[] = [];

/** The lightning flash at `now`: the same envelope as Weather.tsx's two-flash keyframes. */
export function flashAt(now: number): number {
  const keys: [number, number][] = [[0, 0], [0.08, 0.5], [0.25, 0.08], [0.4, 0.32], [1, 0]];
  let out = 0;
  for (const at of strikes) {
    const x = (now - at) / 520;
    if (x < 0 || x > 1) continue;
    for (let i = 1; i < keys.length; i++) {
      const [x0, y0] = keys[i - 1]!;
      const [x1, y1] = keys[i]!;
      if (x <= x1) {
        out = Math.max(out, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
        break;
      }
    }
  }
  return out;
}

/** Interleaved draw slot: above streets and buildings, below road barriers and every label. */
export const WORLD_BEFORE = 'road-closed';
