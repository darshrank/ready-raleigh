// The map's light, set in one place: the basemap palette (map/basemap.ts) and the water's look
// (map/flood.ts), with or without the satellite imagery.
// - Title, planning, results: the player's choice (theme.ts): the day board, or the night palette.
// - The storm, Light: the city's clock (storm/clock.ts) turns the map dark at dusk and light at
//   dawn. Dark: night all the way. Either way the map goes back to the player's choice at the end.
import { useEffect } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Phase } from '../plan/store';
import { useMapUi } from '../store';
import { nightAt, nightTurns } from '../storm/clock';
import { CLEAR_MS, STORM_MS, WIPE_MS } from '../storm/sim';
import { useTheme, type Theme } from '../theme';
import { tokens } from '../tokens';
import { applyPalette, type Mood } from './basemap';
import { floodViewOf, type WaterLevel } from './flood';

/** Toggling Light, Dark or Satellite on the calm board. */
const SWITCH_MS = 600;

/** Whether the map is dark at storm time `t` (ms; past the end, the player's choice again). */
export function stormNight(t: number, theme: Theme): boolean {
  if (theme === 'dark') return true;
  return t < STORM_MS + CLEAR_MS / 2 && nightAt(t);
}

export function useMapMood(map: MapLibreMap | null, phase: Phase, stormAt: number | null, reduce: boolean) {
  const theme = useTheme((s) => s.theme);
  const satellite = useMapUi((s) => s.satellite);

  useEffect(() => {
    if (!map) return;
    const timers: number[] = [];
    let live = true;
    const level: WaterLevel = phase === 'storm' || phase === 'results' ? 'full' : 'preview';
    const paint = (night: boolean, ms: number) => {
      if (!live) return;
      const mood: Mood = night ? 'storm' : 'day';
      const fade = reduce ? 0 : ms;
      applyPalette(map, mood, tokens(), fade, satellite);
      floodViewOf(map)?.setLook(mood, level, fade);
    };
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, stormAt! + ms - performance.now())));

    const run = () => {
      const dark = theme === 'dark';
      if (phase !== 'storm' || stormAt === null) return paint(dark, SWITCH_MS);
      const now = performance.now() - stormAt;
      if (now >= STORM_MS) return paint(dark, 300);
      // The storm's opening light lands under the middle of the wipe (or at once after a skip).
      const first = Math.max(now, WIPE_MS / 2);
      at(first, () => paint(stormNight(first, theme), now < WIPE_MS ? 0 : 400));
      if (!dark) {
        const { turns, fadeMs } = nightTurns();
        for (const turn of turns) if (turn.at > first) at(turn.at, () => paint(turn.night, fadeMs));
      }
      // The end: back to the player's choice as the storm clears.
      at(STORM_MS, () => paint(dark, CLEAR_MS));
    };
    // The style and the water exist once the map has loaded (MapView makes the water on 'load').
    if (floodViewOf(map)) run();
    else map.once('load', run);
    return () => {
      live = false;
      timers.forEach(clearTimeout);
      map.off('load', run);
    };
  }, [map, phase, stormAt, theme, satellite, reduce]);
}
