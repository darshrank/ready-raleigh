// Engine behaviour on the fixture bundle (always the fixtures: some checks name fixture sites).
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, dataDir, loadBundle } from '../../scripts/bundle';
import { BUDGET, COSTS, NO_CAR_HH_WEIGHT, weightedPeople } from '../config';
import type { DataBundle } from '../data';
import type { Cell, Mode, Site } from '../types';
import {
  PlanError,
  atRiskCells,
  heatThreshold,
  optimize,
  placementCoverage,
  planCost,
  planProblems,
  score,
  simTimeline,
} from './index';
import { allPlacements, key, makePlan, mulberry32, randomPlan } from './testData';

const data = loadBundle(FIXTURES_DIR);
const MODES: Mode[] = ['flood', 'heat'];
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('at risk', () => {
  it('flood: every cell that floods by step 3 or is cut off', () => {
    const expected = data.cells.filter((c) => (c.floodStep !== null && c.floodStep <= 3) || c.cutOff).map((c) => c.i);
    expect(atRiskCells('flood', data)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it('heat: cells at or above the 80th percentile', () => {
    const t = heatThreshold(data.cells);
    const hot = atRiskCells('heat', data);
    expect(hot).toEqual(data.cells.filter((c) => c.heatC >= t).map((c) => c.i));
    expect(hot.length).toBeGreaterThanOrEqual(Math.floor(data.cells.length * 0.2));
    expect(hot.length).toBeLessThan(data.cells.length / 2);
  });
});

describe('score', () => {
  it.each(MODES)('%s: the empty plan scores 0 and strands everyone at risk', (mode) => {
    const r = score(makePlan(mode, []), data);
    expect(r.score).toBe(0);
    expect(r.protectedWeighted).toBe(0);
    expect(r.atRiskWeighted).toBeGreaterThan(0);
    const people = atRiskCells(mode, data).reduce((s, i) => s + data.cells[i]!.pop, 0);
    close(r.strandedPeople, people);
    expect(r.topMisses).toHaveLength(5);
    for (const m of r.topMisses) expect(m.reason.length).toBeGreaterThan(0);
    const w = r.topMisses.map((m) => m.weighted);
    expect(w).toEqual([...w].sort((a, b) => b - a));
  });

  it.each(MODES)('%s: adding a placement never lowers the score', (mode) => {
    const rand = mulberry32(7);
    const pool = allPlacements(mode, data);
    for (let trial = 0; trial < 300; trial++) {
      const base = randomPlan(mode, data, rand, 0.3);
      const used = new Set(base.placements.map(key));
      const left = BUDGET - planCost(base.placements);
      const extra = pool.filter((p) => COSTS[p.type] <= left && !(used.has(key(p)) && (p.siteId || p.roadId)));
      if (extra.length === 0) continue;
      const add = extra[Math.floor(rand() * extra.length)]!;
      const before = score(base, data);
      const after = score(makePlan(mode, [...base.placements, add]), data);
      expect(after.score).toBeGreaterThanOrEqual(before.score - 1e-9);
      expect(after.protectedPeople).toBeGreaterThanOrEqual(before.protectedPeople - 1e-9);
    }
  });

  it('rejects over-budget plans and plans that break the rules', () => {
    const shelters = data.sites.slice(0, 4).map((s) => ({ type: 'shelter' as const, siteId: s.id }));
    const over = makePlan('flood', shelters);
    expect(planCost(over.placements)).toBeGreaterThan(BUDGET);
    expect(() => score(over, data)).toThrow(PlanError);
    expect(planProblems(over, data)[0]).toMatch(/over budget/);
    // `spent` is not trusted: the cost comes from the placements.
    expect(() => score({ ...over, spent: 0 }, data)).toThrow(/over budget/);

    expect(planProblems(makePlan('flood', [{ type: 'cooling_center', cell: 0 }]), data)[0]).toMatch(/not a flood/);
    expect(planProblems(makePlan('flood', [{ type: 'shelter', siteId: 'nope' }]), data)[0]).toMatch(/unknown/);
    expect(planProblems(makePlan('flood', [{ type: 'bus_pickup', cell: 999 }]), data)[0]).toMatch(/valid cell/);
    const twice = makePlan('flood', [
      { type: 'road_protection', roadId: 'road-pullen' },
      { type: 'road_protection', roadId: 'road-pullen' },
    ]);
    expect(planProblems(twice, data)[0]).toMatch(/already protected/);
  });

  it('Pullen Community Center floods at step 1 and protects nobody as a shelter', () => {
    const pullen = data.sites.find((s) => s.name === 'Pullen Community Center')!;
    expect(pullen.floodStep).toBe(1);
    const p = { type: 'shelter' as const, siteId: pullen.id };
    expect(placementCoverage({ id: 'x', ...p }, 'flood', data)).toEqual([]);
    const r = score(makePlan('flood', [p]), data);
    expect(r.score).toBe(0);
    expect(r.topMisses.some((m) => m.reason.includes('nearest shelter floods'))).toBe(true);
  });

  it('a dry shelter on the cut-off side protects people', () => {
    const r = score(makePlan('flood', [{ type: 'shelter', siteId: 'site-avent-ferry' }]), data);
    expect(r.score).toBeGreaterThan(0);
  });

  describe('shelter coverage rule', () => {
    // Four at-risk cells and one site whose coverDry holds 0, 1, 2 and coverFlood only 2.
    const at = (c: Cell, over: Partial<Cell>): Cell => ({ ...c, floodStep: null, cutOff: false, ...over });
    const cells = [
      at(data.cells[0]!, { i: 0, floodStep: 2 }), // floods, dry-road reach only: evacuates in time
      at(data.cells[1]!, { i: 1, cutOff: true }), // dry but cut off, dry-road reach only: stranded
      at(data.cells[2]!, { i: 2, cutOff: true }), // dry but cut off, reachable at the final step
      at(data.cells[3]!, { i: 3, floodStep: 1 }), // floods, out of reach
    ];
    const site: Site = {
      id: 'site-a', name: 'A', kind: 'school', lon: 0, lat: 0, cell: 2,
      floodStep: null, coverDry: [0, 1, 2], coverFlood: [2],
    };
    const bundle: DataBundle = { cells, sites: [site, { ...site, id: 'site-wet', floodStep: 3 }], floodRoads: [] };
    const carW = (c: Cell) => weightedPeople(c) - NO_CAR_HH_WEIGHT * c.noCarHH;

    it('a flooded cell is covered by coverDry; a cut-off dry cell needs coverFlood', () => {
      expect(placementCoverage({ id: 'x', type: 'shelter', siteId: 'site-a' }, 'flood', bundle)).toEqual([0, 2]);
      const r = score(makePlan('flood', [{ type: 'shelter', siteId: 'site-a' }]), bundle);
      close(r.protectedWeighted, carW(cells[0]!) + carW(cells[2]!));
      const miss = r.topMisses.find((m) => m.cell === 1)!;
      expect(miss.reason).toMatch(/cut off from hospitals/);
    });

    it('a shelter that floods still covers nobody', () => {
      expect(placementCoverage({ id: 'x', type: 'shelter', siteId: 'site-wet' }, 'flood', bundle)).toEqual([]);
      expect(score(makePlan('flood', [{ type: 'shelter', siteId: 'site-wet' }]), bundle).protectedWeighted).toBe(0);
    });

    it('fixtures: flooded cells outside coverFlood now count', () => {
      const dh = data.sites.find((s) => s.id === 'site-dh-hill')!;
      const flooded = dh.coverDry.filter((i) => data.cells[i]!.floodStep !== null && !dh.coverFlood.includes(i));
      expect(flooded.length).toBeGreaterThan(0);
      const got = placementCoverage({ id: 'x', type: 'shelter', siteId: dh.id }, 'flood', data);
      for (const i of flooded) expect(got).toContain(i);
    });
  });

  it('bus pickups serve only households with no car', () => {
    const r = score(makePlan('flood', [{ type: 'bus_pickup', cell: 9 }]), data);
    expect(r.score).toBeGreaterThan(0);
    const cell = data.cells[9]!;
    const full = cell.pop + cell.pop65 + cell.lowInc + 2.5 * cell.noCarHH;
    expect(r.protectedWeighted).toBeLessThan(full * 7);
    expect(r.topMisses.every((m) => !m.reason.includes('no bus pickup') || m.cell !== 9)).toBe(true);
  });

  it('breakdowns add up', () => {
    const plan = randomPlan('flood', data, mulberry32(3));
    const r = score(plan, data);
    close(r.byHood.reduce((s, h) => s + h.atRisk, 0), r.atRiskWeighted);
    close(r.byHood.reduce((s, h) => s + h.protected, 0), r.protectedWeighted);
    close(r.score, (100 * r.protectedWeighted) / r.atRiskWeighted);
    expect(r.vulnerable.everyonePct).toBeGreaterThanOrEqual(0);
    expect(r.vulnerable.protectedPct).toBeLessThanOrEqual(100);
  });

  it('heat: trees cool a cell below the threshold; water stations count half', () => {
    const t = heatThreshold(data.cells);
    const hot = atRiskCells('heat', data);
    const justOver = hot.find((i) => data.cells[i]!.heatC - 1.5 < t)!;
    expect(justOver).toBeDefined();
    const trees = score(makePlan('heat', [{ type: 'tree_planting', cell: justOver }]), data);
    expect(trees.protectedWeighted).toBeGreaterThan(0);

    const c = hot[0]!;
    const water = score(makePlan('heat', [{ type: 'water_station', cell: c }]), data);
    const cooling = score(makePlan('heat', [{ type: 'cooling_center', cell: c }]), data);
    expect(water.protectedWeighted).toBeGreaterThan(0);
    expect(cooling.protectedWeighted).toBeGreaterThan(water.protectedWeighted);
  });
});

describe('optimizer', () => {
  it.each(MODES)('%s: beats 100 random valid plans', (mode) => {
    const { plan } = optimize(mode, data);
    expect(planProblems(plan, data)).toEqual([]);
    expect(plan.spent).toBe(planCost(plan.placements));
    const best = score(plan, data).score;
    const rand = mulberry32(42);
    const randoms = Array.from({ length: 100 }, () => score(randomPlan(mode, data, rand), data).score);
    for (const s of randoms) expect(best).toBeGreaterThanOrEqual(s - 1e-9);
    const mean = randoms.reduce((a, b) => a + b, 0) / randoms.length;
    expect(best).toBeGreaterThan(mean);
  });

  it('is deterministic', () => {
    expect(optimize('flood', data).plan).toEqual(optimize('flood', data).plan);
  });
});

describe('timeline', () => {
  it('floods grow step by step and the final counts match score()', () => {
    const plan = makePlan('flood', [
      { type: 'road_protection', roadId: 'road-pullen' },
      { type: 'shelter', siteId: 'site-avent-ferry' },
      { type: 'bus_pickup', cell: 9 },
    ]);
    const steps = simTimeline(plan, data);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3]);
    for (let k = 1; k < steps.length; k++) {
      expect(steps[k]!.flooded.length).toBeGreaterThanOrEqual(steps[k - 1]!.flooded.length);
      expect(steps[k]!.protectedPeople + steps[k]!.strandedPeople).toBeGreaterThanOrEqual(
        steps[k - 1]!.protectedPeople + steps[k - 1]!.strandedPeople,
      );
    }
    const last = steps.at(-1)!;
    expect(last.flooded).toHaveLength(data.cells.filter((c) => c.floodStep !== null).length);
    expect(last.heldRoadIds).toEqual(['road-pullen']);
    expect(last.closedRoadIds).toEqual(['road-dan-allen']);
    const r = score(plan, data);
    close(last.protectedPeople, r.protectedPeople);
    close(last.strandedPeople, r.strandedPeople);
  });
});

describe('data folder', () => {
  it('DATA_DIR wins, then VITE_DATA_BASE under app/public, then the fixtures', () => {
    expect(dataDir({ DATA_DIR: '/x/y' })).toBe('/x/y');
    expect(dataDir({ VITE_DATA_BASE: '/data' })).toMatch(/app\/public\/data$/);
    expect(dataDir({})).toBe(FIXTURES_DIR);
    expect(() => dataDir({ VITE_DATA_BASE: 'https://cdn.example/data' })).toThrow(/DATA_DIR/);
  });
});
