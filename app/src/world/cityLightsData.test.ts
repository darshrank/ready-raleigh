import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLights, LIGHTS_BUDGET, type LightCell, type LightGraph } from './cityLightsData';

const data = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${path}`, import.meta.url)), 'utf8'));

describe('city lights', () => {
  it.each(['', 'cities/miami/', 'cities/san-francisco/', 'cities/new-york/'])('stays within the budget in %s', (dir) => {
    const cells = data(`${dir}cells.json`) as LightCell[];
    const graph = data(`${dir}roads_graph.json`) as LightGraph;
    const L = buildLights(cells, graph);
    expect(L.count).toBeLessThanOrEqual(LIGHTS_BUDGET);
    expect(L.count).toBeGreaterThan(LIGHTS_BUDGET * 0.9);
    expect(L.streets).toBeGreaterThan(0);
    expect(L.streets).toBeLessThan(L.count);
    const half = buildLights(cells, graph, LIGHTS_BUDGET / 2);
    expect(half.count).toBeLessThanOrEqual(LIGHTS_BUDGET / 2);
  });

  it('puts building lights inside their cell, more where more people live', () => {
    // Two res-9 cells side by side in Raleigh, one with ten times the residents.
    const cells: LightCell[] = [
      { h3: '892ad48a5b3ffff', pop: 1000 },
      { h3: '892ad48a5a7ffff', pop: 100 },
    ];
    const L = buildLights(cells, { nodes: [], edges: [] }, 1100);
    expect(L.streets).toBe(0);
    expect(L.count).toBeGreaterThan(1000);
    for (let i = 0; i < L.count; i++) expect(L.info[2 * i]).toBe(0);
  });

  it('is the same on every load', () => {
    const cells = data('cities/new-york/cells.json') as LightCell[];
    const graph = data('cities/new-york/roads_graph.json') as LightGraph;
    const a = buildLights(cells, graph, 5000);
    const b = buildLights(cells, graph, 5000);
    expect(Array.from(a.positions.slice(0, 50))).toEqual(Array.from(b.positions.slice(0, 50)));
  });
});
