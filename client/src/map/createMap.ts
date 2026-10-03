import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BEARING_STEP, DEFAULT_PITCH, RALEIGH_CENTER, snapBearing } from '@rr/shared';
import { buildStyle } from './style.ts';

export interface GameMap {
  map: maplibregl.Map;
  deck: MapboxOverlay;
  rotateBy(steps: number): void;
  resetNorth(): void;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const cameraMs = () => (reducedMotion() ? 0 : 1000);
/** Snap to the next 45° step in the direction of travel from `from` to `to`. */
function directionalSnap(from: number, to: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  if (Math.abs(delta) < 0.01) return snapBearing(to);
  const step = delta > 0 ? Math.ceil(to / BEARING_STEP) : Math.floor(to / BEARING_STEP);
  return snapBearing(step * BEARING_STEP);
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface MapOptions {
  center?: [number, number];
  zoom?: number;
}

export async function createMap(container: HTMLElement, opts: MapOptions = {}): Promise<GameMap> {
  const style = await buildStyle();
  const map = new maplibregl.Map({
    container,
    style,
    center: opts.center ?? RALEIGH_CENTER,
    zoom: opts.zoom ?? 15.2,
    pitch: DEFAULT_PITCH,
    bearing: 0,
    maxPitch: 75,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true },
  });

  // deck.gl interleaved into MapLibre's WebGL context; layers are added by later milestones.
  const deck = new MapboxOverlay({ interleaved: true, layers: [] });
  map.addControl(deck);

  const ease = (bearing: number) =>
    map.easeTo({ bearing, duration: cameraMs(), easing: easeInOutCubic });

  // SimCity feel: free rotate while dragging, snap to the nearest 45° on release.
  // Keyboard rotation (Shift+←/→ turns 15°) snaps onward in the pressed direction,
  // otherwise it would always snap back to where it started.
  let startBearing = 0;
  map.on('rotatestart', () => {
    startBearing = map.getBearing();
  });
  map.on('rotateend', (e) => {
    const ev = 'originalEvent' in e ? e.originalEvent : undefined;
    if (!ev) return; // our own easeTo, not a user gesture
    const b = map.getBearing();
    const target =
      ev instanceof KeyboardEvent ? directionalSnap(startBearing, b) : snapBearing(b);
    if (Math.abs(target - b) > 0.01) ease(target);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (e: { error?: Error }) => reject(e.error ?? new Error('Map failed to load'));
    map.once('error', onError);
    map.once('load', () => {
      map.off('error', onError);
      resolve();
    });
  });
  // Start attribution collapsed on small screens; the (i) button still expands it.
  if (window.innerWidth < 640) {
    container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  }
  // After load, tile errors are logged, not fatal.
  map.on('error', (e) => console.warn('[map]', e.error?.message ?? e));

  return {
    map,
    deck,
    rotateBy: (steps) => ease(snapBearing(map.getBearing() + steps * BEARING_STEP)),
    resetNorth: () => ease(0),
  };
}
