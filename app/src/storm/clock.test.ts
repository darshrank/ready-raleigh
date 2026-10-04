import { describe, expect, it, vi } from 'vitest';

// The storm modules reach the plan store, which hands itself to `window` in dev builds.
vi.stubGlobal('window', { location: { search: '' } });
const { aboutEn, aboutHi } = await import('../news');
const { storyOf } = await import('../story');
const { clockLabel, lightAt, lightBands, nightAt, nightTurns } = await import('./clock');
const { STORM_MS } = await import('./sim');

const CITIES = ['raleigh', 'miami', 'san-francisco', 'new-york'] as const;

describe('storm clock', () => {
  it('covers each storm with contiguous light bands', () => {
    for (const id of CITIES) {
      const bands = lightBands(storyOf(id).clock);
      expect(bands[0]!.from).toBe(0);
      expect(bands.at(-1)!.to).toBeCloseTo(1, 9);
      for (let i = 1; i < bands.length; i++) expect(bands[i]!.from).toBeCloseTo(bands[i - 1]!.to, 9);
      // Every city's storm starts in daylight and shows a day band.
      expect(bands[0]!.light).toBe('day');
    }
  });

  it('gives each city its own day and night', () => {
    const raleigh = storyOf('raleigh').clock;
    expect(clockLabel(raleigh.start, raleigh)).toBe('Fri 3:00 PM');
    expect(clockLabel(raleigh.end, raleigh)).toBe('Sat 9:00 AM');
    expect(nightTurns(raleigh).turns.map((t) => t.night)).toEqual([true, false]);

    // The quake runs from the morning into the night: one turn, to night, near the end.
    const sf = storyOf('san-francisco').clock;
    const { turns } = nightTurns(sf);
    expect(turns.map((t) => t.night)).toEqual([true]);
    expect(turns[0]!.at).toBeGreaterThan(STORM_MS * 0.7);
    expect(nightAt(0, sf)).toBe(false);
    expect(nightAt(STORM_MS, sf)).toBe(true);
    expect(lightAt(sf.start, sf)).toBe('day');
  });
});

describe('spoken numbers', () => {
  it('rounds the way an anchor says them', () => {
    expect(aboutEn(940)).toBe('940');
    expect(aboutEn(3384)).toBe('About 3,400');
    expect(aboutEn(225_603)).toBe('About 230,000');
    expect(aboutHi(3384)).toBe('लगभग 3 हज़ार');
    expect(aboutHi(225_603)).toBe('लगभग 2.3 लाख');
    expect(aboutHi(200_000)).toBe('लगभग 2 लाख');
  });
});
