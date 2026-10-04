import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLights, LIGHTS_BUDGET, NEAR_M, type LightCell, type LightGraph } from './cityLightsData';
import type { FloodGrid } from './floodData';

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

  it('points each light at its nearest zone cell within NEAR_M', () => {
    // A 100 x 10 grid of 30 m cells along a parallel near the equator, a zone in column 10.
    const dLng = 30 / 111_320;
    const grid: FloodGrid = { lng0: 0, lat0: 0, dLng, dLat: 30 / 111_320, w: 100, h: 10 };
    const band = new Uint8Array(grid.w * grid.h);
    for (let y = 0; y < grid.h; y++) band[y * grid.w + 10] = 2;
    const lat = 5.5 * grid.dLat;
    const node = (col: number): [number, number] => [col * dLng, lat];
    // One road along the row: street lights every 60 m from column 0 to 60.
    const L = buildLights([], { nodes: [node(0), node(60)], edges: [[0, 1, 100, null]] }, 1000, { grid, band });
    expect(L.count).toBeGreaterThan(20);
    for (let i = 0; i < L.count; i++) {
      const col = L.positions[2 * i]! / dLng;
      const d = L.ref[3 * i + 2]!;
      if (Math.floor(col) === 10) {
        expect(d).toBe(0);
      } else if (Math.abs(col - 10.5) * 30 > NEAR_M + 30) expect(d).toBe(-1);
      else if (Math.abs(col - 10.5) * 30 < NEAR_M - 30) {
        expect(d).toBeGreaterThan(0);
        expect(Math.abs(d - Math.abs(col - 10.5) * 30)).toBeLessThan(16);
        expect(L.ref[3 * i]).toBeCloseTo(10.5 / grid.w, 6);
      }
    }
  });
});
