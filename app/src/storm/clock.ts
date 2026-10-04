// The storm's clock: it hits Saturday at dusk and clears at dawn on Sunday. Storm time (ms) maps
// onto these hours linearly, so the timeline, the news feed and the night palette agree.
import { STORM_MS } from './sim';

export const START_HOUR = 18;
export const END_HOUR = 31;

export const stormHour = (t: number) => START_HOUR + ((END_HOUR - START_HOUR) * Math.min(Math.max(t, 0), STORM_MS)) / STORM_MS;

/** "Sat 9:40 PM", in ten-minute steps like a broadcast clock. */
export function clockLabel(hour: number) {
  const minutes = Math.floor((hour * 60) / 10) * 10;
  const day = minutes >= 24 * 60 ? 'Sun' : 'Sat';
  const m = minutes % (24 * 60);
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${day} ${h12}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export type Light = 'dusk' | 'night' | 'dawn';
export const lightAt = (hour: number): Light => (hour < 19.5 ? 'dusk' : hour < 30 ? 'night' : 'dawn');

/** Where each light band sits on the timeline, as shares of the storm. */
export const LIGHT_BANDS: { light: Light; from: number; to: number }[] = [
  { light: 'dusk', from: 0, to: (19.5 - START_HOUR) / (END_HOUR - START_HOUR) },
  { light: 'night', from: (19.5 - START_HOUR) / (END_HOUR - START_HOUR), to: (30 - START_HOUR) / (END_HOUR - START_HOUR) },
  { light: 'dawn', from: (30 - START_HOUR) / (END_HOUR - START_HOUR), to: 1 },
];
