import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, loadBundle } from '../../scripts/bundle';
import { score } from './score';
import { makePlan } from './testData';
import { weakSpots } from './weakSpot';

const data = loadBundle(FIXTURES_DIR);

describe('weak spots', () => {
  it('ranks unprotected flood roads by the people they keep in reach, matching score()', () => {
    const empty = makePlan('flood', []);
    const spots = weakSpots(empty, data, 5);
    expect(spots.length).toBeGreaterThan(0);
    for (let k = 1; k < spots.length; k++) expect(spots[k - 1]!.weighted).toBeGreaterThanOrEqual(spots[k]!.weighted);
    const top = spots[0]!;
    const gain = score(makePlan('flood', [{ type: 'road_protection', roadId: top.roadId }]), data).protectedPeople - score(empty, data).protectedPeople;
    expect(top.people).toBeCloseTo(gain, 6);
  });

  it('skips roads the plan already protects', () => {
    const top = weakSpots(makePlan('flood', []), data, 1)[0]!;
    const spots = weakSpots(makePlan('flood', [{ type: 'road_protection', roadId: top.roadId }]), data, 5);
    expect(spots.some((s) => s.roadId === top.roadId)).toBe(false);
  });
});
