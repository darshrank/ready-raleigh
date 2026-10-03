// The storm's direction on the map (DESIGN.md "Motion", storm and end): the night palette, the
// water growing step by step, the submerged streets, and the news helicopter camera. Everything is
// scheduled from the storm clock, so a skip (which moves the clock) lands on the right state.
import type { Map as MapLibreMap } from 'maplibre-gl';
import { FINAL_FLOOD_STEP } from '@shared/config';
import { applyPalette } from '../map/basemap';
import type { FloodView } from '../map/flood';
import { cameraForPoints, type Camera, type Pad } from '../map/frame';
import { tokens } from '../tokens';
import {
  BACK_MS,
  CLEAR_MS,
  FLY_MS,
  GROW_MS,
  HOLD_MS,
  STORM_MS,
  TILT_MS,
  WIPE_MS,
  stepStart,
  type Storm,
  type StormEvent,
} from './sim';

/** The storm camera's pitch (DESIGN.md "Map"). */
export const STORM_PITCH = 55;
/** The helicopter circles this many degrees while it holds on an event. */
const ORBIT_DEG = 14;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

interface Options {
  /** The points the planning camera frames: the city (or, on a phone, the riskiest area). */
  frame: [number, number][];
  /** Room to keep clear for the band and counters (storm), and for the HUD (the day after). */
  stormPad: Pad;
  dayPad: Pad;
  reduce: boolean;
  /** The LIVE caption: the event on screen, or null. */
  onEvent: (e: StormEvent | null) => void;
}

/** Start directing the storm that started at `stormAt` (performance.now() ms). Returns a stop function. */
export function directStorm(map: MapLibreMap, flood: FloodView | null, storm: Storm, stormAt: number, o: Options) {
  const t = tokens();
  const timers: number[] = [];
  const elapsed = () => performance.now() - stormAt;
  /** Run `fn` at storm time `ms`; at once if that time has passed. */
  const at = (ms: number, fn: () => void) => {
    const wait = stormAt + ms - performance.now();
    if (wait <= 0) fn();
    else timers.push(window.setTimeout(fn, wait));
  };

  // The camera stays ours until the player grabs the map.
  let userTookOver = false;
  const onMoveStart = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) userTookOver = true;
  };
  map.on('movestart', onMoveStart);
  const camera = (fn: () => void) => () => {
    if (!userTookOver) fn();
  };

  // Computed now, while the map is still: measuring later would stop a flight in progress.
  const overview = cameraForPoints(map, o.frame, STORM_PITCH, o.stormPad);
  const city = cameraForPoints(map, o.frame, 0, o.dayPad);
  const over = (cam: Camera | null, duration: number, bearing = -14) => {
    if (!cam) return;
    const opts = { ...cam, bearing, duration: o.reduce ? 0 : duration, essential: true };
    if (o.reduce) map.jumpTo(opts);
    else map.easeTo(opts);
  };

  const now = elapsed();
  /** Skipped past the end: go straight to the aftermath. */
  const skipped = now >= STORM_MS;

  // Night: swapped at the middle of the wipe (instantly when the storm is skipped past).
  if (!skipped) {
    at(o.reduce ? 0 : WIPE_MS / 2, () => {
      applyPalette(map, 'storm', t, 0);
      flood?.setLook('storm', 'full', 0);
    });
  }

  // The water grows step by step, and the streets under it show once it is there.
  flood?.setReveal((n) => [1, 2, 3].map((k) => (o.reduce ? Number(n - stormAt >= stepStart(k)) : clamp01((n - stormAt - stepStart(k)) / GROW_MS))));
  for (let k = 1; k <= FINAL_FLOOD_STEP; k++) at(stepStart(k) + GROW_MS * 0.4, () => flood?.showSubmerged(k));

  // The helicopter: tilt over the city, then each event in turn.
  if (!skipped) {
    at(250, camera(() => over(overview, TILT_MS)));
    for (const e of storm.events) {
      if (now > e.back + BACK_MS) continue;
      const cam = cameraForPoints(map, e.points, STORM_PITCH, o.stormPad);
      if (!cam) continue;
      // Close enough to see the street go under, never closer than street level.
      cam.zoom = Math.min(cam.zoom, 15.6);
      const bearing = -14 + (e.step % 2 ? 24 : -24);
      if (!o.reduce) {
        at(e.fly, camera(() => map.flyTo({ ...cam, bearing, duration: FLY_MS, curve: 1.2, essential: true })));
        at(e.hold, camera(() => map.easeTo({ bearing: bearing + ORBIT_DEG, duration: HOLD_MS, easing: (x) => x, essential: true })));
        at(e.back, camera(() => over(overview, BACK_MS)));
      }
      at(e.hold, () => o.onEvent(e));
      at(e.back, () => o.onEvent(null));
    }
  }

  // The end: the storm clears to daylight, the water stays, the camera pulls back over the city.
  at(STORM_MS, () => {
    o.onEvent(null);
    applyPalette(map, 'day', t, skipped ? 300 : CLEAR_MS);
    flood?.setLook('day', 'full', skipped ? 300 : CLEAR_MS);
    flood?.showSubmerged(FINAL_FLOOD_STEP);
    if (!userTookOver) over(city, skipped ? 600 : 2200, 0);
  });

  return () => {
    for (const id of timers) clearTimeout(id);
    map.off('movestart', onMoveStart);
    o.onEvent(null);
  };
}

/** Back to the calm board for another round: day palette, faint water, no streets under water. */
export function resetWater(map: MapLibreMap, flood: FloodView | null) {
  applyPalette(map, 'day', tokens(), 0);
  flood?.setReveal(null);
  flood?.showSubmerged(0);
  flood?.setLook('day', 'preview', 600);
}
