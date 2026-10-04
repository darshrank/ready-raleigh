// Quality tiers for the realistic world (R7), chosen once per page load. Each tier only changes
// what the shaders are built with and how far the city draws, never anything per frame.
//
// - high (desktops and laptops): everything.
// - medium (phones and tablets): two octaves of water noise, the window grid fades out sooner.
// - low (small or old devices): one octave, no foam, no window grid (its average tone and glow
//   stay), a shorter city, no ground shadows or rain ripples, half the city lights, and the map
//   drawn at most 1.25 device pixels per CSS pixel.
// `?quality=low|medium|high` overrides the guess (frame-time checks, demos).
import { LIGHTS_BUDGET } from './cityLightsData';

export type Quality = 'low' | 'medium' | 'high';

export interface Tier {
  quality: Quality;
  /** Octaves of water surface noise (1..3). */
  octaves: 1 | 2 | 3;
  /** The foam band behind the advancing water. */
  foam: boolean;
  /** Meters per pixel over which the window grid fades to its average; null: average only. */
  windowFade: [number, number] | null;
  /** Buildings sink into the ground beyond this many screen pixels from the view's center. */
  farPx: number;
  /** Cap on the map's pixel ratio (MapLibre and deck.gl share the canvas). */
  maxPixelRatio: number;
  /** Ground shadows under the 3D buildings (a second, projected pass). */
  shadows: boolean;
  /** Rain ripples on the storm water. */
  ripples: boolean;
  /** The city's lights at night (world/cityLights.ts): at most this many points. */
  lights: number;
}

const TIERS: Record<Quality, Tier> = {
  high: { quality: 'high', octaves: 3, foam: true, windowFade: [0.7, 1.6], farPx: 1800, maxPixelRatio: 3, shadows: true, ripples: true, lights: LIGHTS_BUDGET },
  medium: { quality: 'medium', octaves: 2, foam: true, windowFade: [0.5, 1.1], farPx: 1500, maxPixelRatio: 2, shadows: true, ripples: true, lights: LIGHTS_BUDGET },
  low: { quality: 'low', octaves: 1, foam: false, windowFade: null, farPx: 1100, maxPixelRatio: 1.25, shadows: false, ripples: false, lights: LIGHTS_BUDGET / 2 },
};

function guess(): Quality {
  if (typeof window === 'undefined') return 'high';
  const asked = /[?&]quality=(low|medium|high)(&|$)/.exec(window.location.search)?.[1] as Quality | undefined;
  if (asked) return asked;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 8;
  const handheld = window.matchMedia('(max-width: 639px), (pointer: coarse)').matches;
  if (memory <= 2 || cores <= 2 || (handheld && cores <= 4)) return 'low';
  return handheld ? 'medium' : 'high';
}

export const TIER: Tier = TIERS[guess()];
