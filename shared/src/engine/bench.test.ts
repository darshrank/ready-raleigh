// Speed budget: score() under 30 ms on a 6,400-cell bundle (synthetic, seeded).
import { describe, expect, it } from 'vitest';
import { engineIndex, optimize, score } from './index';
import { makePlan, syntheticBundle } from './testData';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe('benchmark: 6,400 cells', () => {
  const data = syntheticBundle(6400);

  it('score runs under 30 ms, first call and warm', () => {
    expect(data.cells).toHaveLength(6400);
    const flood = makePlan('flood', [
      { type: 'shelter', siteId: 'site-1' },
      { type: 'shelter', siteId: 'site-2' },
      { type: 'shelter', siteId: 'site-3' },
      { type: 'bus_pickup', cell: 3200 },
    ]);
    const heat = makePlan('heat', [
      { type: 'cooling_center', cell: 100 },
      { type: 'cooling_center', cell: 2000 },
      ...Array.from({ length: 10 }, (_, k) => ({ type: 'tree_planting' as const, cell: 300 * k })),
      ...Array.from({ length: 4 }, (_, k) => ({ type: 'water_station' as const, cell: 500 + 700 * k })),
    ]);

    // The index is built once per bundle when the data loads; score() reuses it.
    let t = performance.now();
    engineIndex(data);
    const index = performance.now() - t;
    t = performance.now();
    const first = score(flood, data);
    const cold = performance.now() - t;
    expect(first.atRiskWeighted).toBeGreaterThan(0);
    expect(first.score).toBeGreaterThan(0);

    const runs = (plan: typeof flood) =>
      Array.from({ length: 40 }, () => {
        t = performance.now();
        score(plan, data);
        return performance.now() - t;
      });
    const warmFlood = median(runs(flood));
    const warmHeat = median(runs(heat));
    console.log(
      `6,400 cells: index build ${index.toFixed(1)} ms (once per load), first score ${cold.toFixed(1)} ms, ` +
        `warm score flood ${warmFlood.toFixed(2)} ms, heat ${warmHeat.toFixed(2)} ms`,
    );
    expect(index + cold).toBeLessThan(30); // even the very first score, index included
    expect(cold).toBeLessThan(30);
    expect(warmFlood).toBeLessThan(30);
    expect(warmHeat).toBeLessThan(30);
  });

  it('the optimizer finishes on 6,400 cells', () => {
    const t = performance.now();
    const { plan, stats } = optimize('flood', data);
    const ms = performance.now() - t;
    console.log(`optimize 6,400 cells: ${ms.toFixed(0)} ms, ${stats.candidates} candidates, ${stats.evaluations} evals`);
    expect(plan.placements.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(10_000);
  });
});
