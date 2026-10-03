import { describe, expect, it } from 'vitest';
import type { DataBundle } from '../data';
import type { Cell, Site } from '../types';
import { engineIndex, optimize, placementCoverage, planState, protectorOf, score, simTimeline } from './index';
import { makePlan, syntheticBundle } from './testData';

const base = syntheticBundle(5, 9, 0, 0);
const cell = (i: number, pop: number, over: Partial<Cell> = {}): Cell => ({
  ...base.cells[i]!, i, pop, pop65: 0, lowInc: 0, noCarHH: 0,
  floodStep: 1, floodFrac: 1, cutOff: false, ...over,
});
const site = (id: string, coverDry: number[], driveDry: number[]): Site => ({
  id, name: id, kind: 'school', lon: 0, lat: 0, cell: 0, floodStep: null,
  coverDry, driveDry, coverFlood: [], driveFlood: [],
});
const shelter = (siteId: string) => ({ type: 'shelter' as const, siteId });
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('fractional flooding and capacity', () => {
  it('scales all flood weights and people once; sub-threshold dry cut-off cells count in full', () => {
    const data: DataBundle = { cells: [
      cell(0, 100, { floodFrac: .25, pop65: 20, lowInc: 10, noCarHH: 4, cutOff: true }),
      cell(1, 100, { floodStep: null, floodFrac: .1 }),
      cell(2, 100, { floodStep: null, floodFrac: .1, cutOff: true }),
    ], sites: [site('a', [0], [10])], floodRoads: [] };
    const result = score(makePlan('flood', [shelter('a'), { type: 'bus_pickup', cell: 0 }]), data);
    close(result.atRiskWeighted, 140 * .25 + 100);
    close(result.protectedWeighted, 140 * .25);
    close(result.protectedPeople, 25);
    close(result.strandedPeople, 100);
    const timeline = simTimeline(makePlan('flood', [shelter('a'), { type: 'bus_pickup', cell: 0 }]), data);
    close(timeline[0]!.protectedWeighted, 35);
    close(timeline[0]!.strandedWeighted, 0);
    close(timeline[2]!.strandedWeighted, 100);
  });

  it('fills by drive time, partially fills the last cell, and never exceeds 10,000 people', () => {
    const data: DataBundle = { cells: [cell(0, 7000), cell(1, 6000), cell(2, 4000)],
      sites: [site('a', [1, 0, 2], [100, 200, 300])], floodRoads: [] };
    const plan = makePlan('flood', [shelter('a')]);
    const sources = protectorOf(plan, data);
    close(score(plan, data).protectedPeople, 10000);
    close(sources.get(1)![0]!.share, 1);
    close(sources.get(0)![0]!.share, 4000 / 7000);
    expect(sources.has(2)).toBe(false);
    expect(placementCoverage(plan.placements[0]!, 'flood', data)).toEqual([0, 1]);
  });

  it('compares actual times across shelters, reroutes past full shelters, and is insertion-order independent', () => {
    const data: DataBundle = { cells: [cell(0, 10000), cell(1, 5000), cell(2, 5000)],
      sites: [site('a', [0, 1, 2], [10, 20, 90]), site('b', [0, 2, 1], [15, 30, 40])], floodRoads: [] };
    const plan = makePlan('flood', [shelter('b'), shelter('a')]);
    const owners = protectorOf(plan, data);
    expect([0, 1, 2].map((i) => owners.get(i)![0]!.placement.siteId)).toEqual(['a', 'b', 'b']);
    close(score(plan, data).protectedPeople, 20000);
    const reverse = { ...plan, placements: [...plan.placements].reverse() };
    expect(protectorOf(reverse, data)).toEqual(owners);
    expect(score(reverse, data)).toEqual(score(plan, data));
  });

  it('uses people, not vulnerability weights, for seats and avoids overlap with road protection', () => {
    const data: DataBundle = { cells: [cell(0, 10000, { pop65: 10000, floodFrac: .5, cutOff: true }), cell(1, 10000)],
      sites: [site('a', [0, 1], [10, 20])],
      floodRoads: [{ id: 'road', name: 'Road', floodStep: 1, coords: [[0, 0], [1, 1]], unlocks: [0] }] };
    const alone = score(makePlan('flood', [shelter('a')]), data);
    close(alone.protectedPeople, 10000);
    close(alone.protectedWeighted, 15000);
    const plan = makePlan('flood', [shelter('a'), { type: 'road_protection', roadId: 'road' }]);
    close(score(plan, data).protectedPeople, 15000);
    expect(protectorOf(plan, data).get(0)![0]!.placement.roadId).toBe('road');
  });

  it('reports the same optimizer score for the chosen budget; cached baselines stay budget-specific', () => {
    const data: DataBundle = { cells: [cell(0, 10000)], sites: [site('a', [0], [10])], floodRoads: [] };
    const empty = makePlan('flood', []);
    expect(score(empty, data, 0).bestPossible).toBe(0);
    expect(score(empty, data, 3_000_000).bestPossible).toBe(100);
    expect(score(empty, data, 0).bestPossible).toBe(0);
    const best = optimize('flood', data, 3_000_000);
    close(score(best.plan, data, 3_000_000).score, score(empty, data, 3_000_000).bestPossible);
  });
});

describe('protection source and timeline consistency', () => {
  it.each(['flood', 'heat'] as const)('%s attribution exactly adds to the score for every part', (mode) => {
    const data = syntheticBundle(50, 4, 5, 3);
    const plan = optimize(mode, data).plan;
    const sources = protectorOf(plan, data);
    const result = score(plan, data);
    close([...sources.values()].flat().reduce((sum, s) => sum + s.weighted, 0), result.protectedWeighted);
    const idx = engineIndex(data), state = planState(plan, idx);
    for (const [i, entries] of sources) {
      expect(entries.every((s) => plan.placements.includes(s.placement))).toBe(true);
      for (const part of ['car', 'noCar'] as const) {
        const share = entries.filter((s) => s.part === part).reduce((sum, s) => sum + s.share, 0);
        expect(share).toBeLessThanOrEqual(1 + 1e-9);
        if (mode === 'flood') close(share, state.cover[(part === 'car' ? 0 : idx.n) + i]!);
      }
    }
    if (mode === 'flood') {
      const steps = simTimeline(plan, data), final = steps.at(-1)!;
      close(final.protectedWeighted, result.protectedWeighted);
      close(final.strandedWeighted, result.atRiskWeighted - result.protectedWeighted);
      close(final.protectedPeople, result.protectedPeople);
      close(final.strandedPeople, result.strandedPeople);
    }
  });
});
