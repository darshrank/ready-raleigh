import { describe, expect, it } from 'vitest';
import type { DataBundle } from '../data';
import type { Cell, Site } from '../types';
import { cellToLatLng } from 'h3-js';
import { BUS_STOP_ACTIVATE_COST } from '../config';
import { engineIndex, optimize, placementCoverage, planCost, planProblems, planState, protectorOf, score, simTimeline } from './index';
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

  it('fills by drive time, partially fills the last cell, and never gives drivers more than 9,000 seats', () => {
    // 10,000 seats, 10% kept for bus riders: 9,000 for drivers.
    const data: DataBundle = { cells: [cell(0, 7000), cell(1, 6000), cell(2, 4000)],
      sites: [site('a', [1, 0, 2], [100, 200, 300])], floodRoads: [] };
    const plan = makePlan('flood', [shelter('a')]);
    const sources = protectorOf(plan, data);
    close(score(plan, data).protectedPeople, 9000);
    close(sources.get(1)![0]!.share, 1);
    close(sources.get(0)![0]!.share, 3000 / 7000);
    expect(sources.has(2)).toBe(false);
    expect(placementCoverage(plan.placements[0]!, 'flood', data)).toEqual([0, 1]);
  });

  it('compares actual times across shelters, reroutes past full shelters, and is insertion-order independent', () => {
    const data: DataBundle = { cells: [cell(0, 10000), cell(1, 5000), cell(2, 5000)],
      sites: [site('a', [0, 1, 2], [10, 20, 90]), site('b', [0, 2, 1], [15, 30, 40])], floodRoads: [] };
    const plan = makePlan('flood', [shelter('b'), shelter('a')]);
    const owners = protectorOf(plan, data);
    expect([0, 1, 2].map((i) => owners.get(i)![0]!.placement.siteId)).toEqual(['a', 'b', 'b']);
    // Cell 0 fills a (9,000 driver seats) and its last 1,000 go on to b.
    expect(owners.get(0)!.map((s) => s.placement.siteId)).toEqual(['a', 'b']);
    close(score(plan, data).protectedPeople, 18000);
    const reverse = { ...plan, placements: [...plan.placements].reverse() };
    expect(protectorOf(reverse, data)).toEqual(owners);
    expect(score(reverse, data)).toEqual(score(plan, data));
  });

  it('uses people, not vulnerability weights, for seats; a road does not save flooded homes', () => {
    const data: DataBundle = { cells: [cell(0, 10000, { pop65: 10000, floodFrac: .5, cutOff: true }), cell(1, 10000)],
      sites: [site('a', [0, 1], [10, 20])],
      floodRoads: [{ id: 'road', name: 'Road', floodStep: 1, coords: [[0, 0], [1, 1]], unlocks: [0] }] };
    // 9,000 driver seats: cell 0's 5,000 at-risk people (weight 10,000), then 4,000 of cell 1.
    const alone = score(makePlan('flood', [shelter('a')]), data);
    close(alone.protectedPeople, 9000);
    close(alone.protectedWeighted, 14000);
    const plan = makePlan('flood', [shelter('a'), { type: 'road_protection', roadId: 'road' }]);
    close(score(plan, data).protectedPeople, 9000);
    expect(protectorOf(plan, data).get(0)![0]!.placement.siteId).toBe('a');
  });
});

describe('evacuation chain', () => {
  // Cell 0 floods (8,000 people, 1,000 no-car households). Cell 1 is dry but cut off (4,000 people,
  // 400 no-car households). One shelter reaches both; a road reconnects cell 1.
  const data: DataBundle = {
    cells: [cell(0, 8000, { noCarHH: 1000 }), cell(1, 4000, { floodStep: null, floodFrac: 0, cutOff: true, noCarHH: 400 })],
    sites: [{ ...site('a', [0], [10]), coverFlood: [1], driveFlood: [20] }],
    floodRoads: [{ id: 'road', name: 'Road', floodStep: 1, coords: [[0, 0], [1, 1]], unlocks: [0, 1] }],
  };
  const bus = { type: 'bus_pickup' as const, cell: 0 };
  const road = { type: 'road_protection' as const, roadId: 'road' };
  const noCarW = (i: number) => 2.5 * data.cells[i]!.noCarHH;

  it('a bus pickup helps no one without a shelter in reach', () => {
    expect(score(makePlan('flood', [bus]), data).protectedWeighted).toBe(0);
  });

  it('a bus takes no-car residents to a shelter with seats left, after the drivers', () => {
    const shelterOnly = score(makePlan('flood', [shelter('a')]), data);
    const withBus = score(makePlan('flood', [shelter('a'), bus]), data);
    expect(withBus.protectedWeighted).toBeGreaterThan(shelterOnly.protectedWeighted);
    const sources = protectorOf(makePlan('flood', [shelter('a'), bus]), data).get(0)!;
    const riders = sources.find((s) => s.part === 'noCar')!;
    expect(riders.placement.siteId).toBe('a');
    expect(riders.via?.type).toBe('bus_pickup');
    // Drivers keep their seats: the car parts are seated as without the bus.
    const carShare = (plan: ReturnType<typeof makePlan>) =>
      [...protectorOf(plan, data).values()].flat().filter((s) => s.part === 'car').reduce((sum, s) => sum + s.weighted, 0);
    close(carShare(makePlan('flood', [shelter('a'), bus])), carShare(makePlan('flood', [shelter('a')])));
  });

  it('a road saves everyone in a dry cut-off block and frees their seats', () => {
    const before = score(makePlan('flood', [shelter('a'), bus]), data);
    const plan = makePlan('flood', [shelter('a'), bus, road]);
    const after = score(plan, data);
    const owners = protectorOf(plan, data).get(1)!;
    expect(owners.map((s) => s.part).sort()).toEqual(['car', 'noCar']);
    expect(owners.every((s) => s.placement.roadId === 'road')).toBe(true);
    // 9,000 driver seats and 1,000 bus seats. Without the road, cell 0's 6,095 drivers and 2,905 of
    // cell 1's 3,200 fill the driver seats. With it, cell 1 is safe at home (4,000 people) and every
    // driver of cell 0 fits; the bus seats take 1,000 of cell 0's 1,905 riders either way.
    const riders = (1000 / (8000 * noCarW(0) / (8000 + noCarW(0))));
    expect(before.protectedPeople).toBeCloseTo(10000, 6);
    close(after.protectedWeighted, 8000 + noCarW(0) * riders + 4000 + noCarW(1));
    close(after.protectedPeople, 8000 * 8000 / (8000 + noCarW(0)) + 1000 + 4000);
  });

  it('reports the same optimizer score for the chosen budget; cached baselines stay budget-specific', () => {
    const data: DataBundle = { cells: [cell(0, 10000)], sites: [site('a', [0], [10])], floodRoads: [] };
    const empty = makePlan('flood', []);
    expect(score(empty, data, 0).bestPossible).toBe(0);
    // One shelter seats 9,000 of the 10,000 (no one here needs a bus seat).
    expect(score(empty, data, 3_000_000).bestPossible).toBeCloseTo(90, 9);
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

describe('existing shelters and bus stops', () => {
  // Cell 0 floods (8,000 people). A registered shelter with 3,000 seats already serves it; site 'a'
  // is a candidate with the usual 10,000. Cell 1 is dry and safe; a bus stop stands in cell 0.
  const [lat, lon] = cellToLatLng(base.cells[0]!.h3);
  const data: DataBundle = {
    cells: [cell(0, 8000, { noCarHH: 400 }), cell(1, 500, { floodStep: null, floodFrac: 0 })],
    sites: [site('a', [0], [20])],
    floodRoads: [],
    existingShelters: [{ ...site('fema-1', [0], [10]), capacity: 3000 }],
    stops: [{ id: 'goraleigh-9', name: 'Main St', agency: 'GoRaleigh', lon, lat }],
  };
  const none = makePlan('flood', []);

  it('count as protection before any plan, and the score measures the rest', () => {
    const empty = score(none, data);
    // 3,000 seats, 300 of them kept for bus riders.
    close(empty.baseline.protectedPeople, 2700);
    close(empty.protectedPeople, 2700);
    expect(empty.score).toBe(0);
    const owner = protectorOf(none, data).get(0)!.find((s) => s.part === 'car')!;
    expect(owner.existing).toBe(true);
    expect(owner.placement.id).toBe('existing:fema-1');
    const plan = makePlan('flood', [shelter('a')]);
    const r = score(plan, data);
    // Drivers fill both shelters: 3,000 + 10,000 seats for 8,000 * 8000/9000 drivers.
    expect(r.protectedPeople).toBeGreaterThan(empty.protectedPeople);
    close(r.score, (100 * (r.protectedWeighted - r.baseline.protectedWeighted)) / (r.atRiskWeighted - r.baseline.protectedWeighted));
  });

  it('players cannot place a shelter on an existing one', () => {
    expect(planProblems(makePlan('flood', [shelter('fema-1')]), data).join(' ')).toMatch(/unknown shelter site/);
  });

  it('a bus pickup at an existing stop costs less and works like a new one there', () => {
    const atStop = { type: 'bus_pickup' as const, stopId: 'goraleigh-9' };
    const newOne = { type: 'bus_pickup' as const, cell: 0 };
    expect(planCost([{ id: 'x', ...atStop }])).toBe(BUS_STOP_ACTIVATE_COST);
    expect(planProblems(makePlan('flood', [shelter('a'), atStop]), data)).toEqual([]);
    close(score(makePlan('flood', [shelter('a'), atStop]), data).protectedWeighted,
      score(makePlan('flood', [shelter('a'), newOne]), data).protectedWeighted);
    expect(planProblems(makePlan('flood', [{ ...atStop, cell: 1 }]), data).join(' ')).toMatch(/is in cell 0/);
    expect(planProblems(makePlan('flood', [{ type: 'bus_pickup', stopId: 'nope' }]), data).join(' ')).toMatch(/unknown bus stop/);
  });

  it('new bus pickups only go where no-car residents are at risk nearby', () => {
    const far = engineIndex(data).busOk.findIndex((ok) => ok === 0);
    if (far >= 0) {
      expect(planProblems(makePlan('flood', [{ type: 'bus_pickup', cell: far }]), data).join(' '))
        .toMatch(/no one without a car is at flood risk/);
    }
    expect(engineIndex(data).busOk[0]).toBe(1);
  });

  it('the optimizer can activate existing stops', () => {
    const plan = optimize('flood', data).plan;
    expect(planProblems(plan, data)).toEqual([]);
  });
});

