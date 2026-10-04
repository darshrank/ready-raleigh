// The storm's clock, per city (story.ts `clock`): Raleigh's rain runs from Friday afternoon to
// Saturday morning, San Francisco's quake from a Tuesday morning into the night. Storm time (ms)
// maps onto those hours linearly, so the timeline, the news feed and the map's daylight agree.
import { currentStory, type StormClock } from '../story';
import { STORM_MS } from './sim';

const here = () => currentStory().clock;

export const stormHour = (t: number, c: StormClock = here()) =>
  c.start + ((c.end - c.start) * Math.min(Math.max(t, 0), STORM_MS)) / STORM_MS;

/** Storm time (ms) when the clock reads `hour`. */
const msAt = (hour: number, c: StormClock) => ((hour - c.start) / (c.end - c.start)) * STORM_MS;

/** "Fri 9:40 PM", in ten-minute steps like a broadcast clock. */
export function clockLabel(hour: number, c: StormClock = here()) {
  const minutes = Math.floor((hour * 60) / 10) * 10;
  const day = minutes >= 24 * 60 ? c.days[1] : c.days[0];
  const m = minutes % (24 * 60);
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${day} ${h12}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export type Light = 'day' | 'dusk' | 'night' | 'dawn';

/** Dawn runs from 30 minutes before sunrise to 15 after; dusk from 15 before sunset to 30 after. */
const DAWN = [-0.5, 0.25] as const;
const DUSK = [-0.25, 0.5] as const;

export function lightAt(hour: number, c: StormClock = here()): Light {
  const h = ((hour % 24) + 24) % 24;
  if (h >= c.sunrise + DAWN[0] && h < c.sunrise + DAWN[1]) return 'dawn';
  if (h >= c.sunrise + DAWN[1] && h < c.sunset + DUSK[0]) return 'day';
  if (h >= c.sunset + DUSK[0] && h < c.sunset + DUSK[1]) return 'dusk';
  return 'night';
}

/** The light bands under the timeline, as shares of the storm. */
export function lightBands(c: StormClock = here()): { light: Light; from: number; to: number }[] {
  const edges = [c.start, c.end];
  for (const day of [0, 24, 48])
    for (const e of [c.sunrise + DAWN[0], c.sunrise + DAWN[1], c.sunset + DUSK[0], c.sunset + DUSK[1]]) {
      const x = e + day;
      if (x > c.start && x < c.end) edges.push(x);
    }
  edges.sort((a, b) => a - b);
  const span = c.end - c.start;
  const out: { light: Light; from: number; to: number }[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const [a, b] = [edges[i]!, edges[i + 1]!];
    if (b - a > 1e-6) out.push({ light: lightAt((a + b) / 2, c), from: (a - c.start) / span, to: (b - c.start) / span });
  }
  return out;
}

/** The map is dark from the middle of dusk to the middle of dawn. */
export function nightAtHour(hour: number, c: StormClock = here()): boolean {
  const light = lightAt(hour, c);
  if (light === 'night') return true;
  if (light === 'day') return false;
  const h = ((hour % 24) + 24) % 24;
  return light === 'dusk' ? h >= c.sunset + (DUSK[0] + DUSK[1]) / 2 : h < c.sunrise + (DAWN[0] + DAWN[1]) / 2;
}
export const nightAt = (t: number, c: StormClock = here()) => nightAtHour(stormHour(t, c), c);

/**
 * When the storm's map turns dark and light again (storm ms), and how long each turn takes: the
 * length of dusk on this city's clock, at least 0.9 s and at most 2.6 s.
 */
export function nightTurns(c: StormClock = here()): { turns: { at: number; night: boolean }[]; fadeMs: number } {
  const turns: { at: number; night: boolean }[] = [];
  for (const day of [0, 24, 48]) {
    const dusk = c.sunset + (DUSK[0] + DUSK[1]) / 2 + day;
    const dawn = c.sunrise + (DAWN[0] + DAWN[1]) / 2 + day;
    if (dusk > c.start && dusk < c.end) turns.push({ at: msAt(dusk, c), night: true });
    if (dawn > c.start && dawn < c.end) turns.push({ at: msAt(dawn, c), night: false });
  }
  const fadeMs = Math.min(2600, Math.max(900, msAt(c.start + (DUSK[1] - DUSK[0]), c)));
  return { turns: turns.sort((a, b) => a.at - b.at), fadeMs };
}
