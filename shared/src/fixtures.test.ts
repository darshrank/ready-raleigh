// Checks the fixture files keep the contract shapes and stay internally consistent.
// Point DATA_DIR at app/public/data to run the same checks on the real pipeline output.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FloodStepsCollection, Hospital, RoadsGraph } from './data';
import type { Cell, FloodRoad, Site } from './types';

const DATA_DIR =
  process.env.DATA_DIR ?? fileURLToPath(new URL('../../app/public/data/fixtures/', import.meta.url));
const load = <T>(f: string): T => JSON.parse(readFileSync(`${DATA_DIR}/${f}`, 'utf8')) as T;

const cells = load<Cell[]>('cells.json');
const sites = load<Site[]>('sites.json');
const roads = load<FloodRoad[]>('flood_roads.json');
const graph = load<RoadsGraph>('roads_graph.json');
const hospitals = load<Hospital[]>('hospitals.json');
const steps = load<FloodStepsCollection>('flood_steps.geojson');

const validCell = (i: number) => Number.isInteger(i) && i >= 0 && i < cells.length;
const validStep = (s: number | null) => s === null || [1, 2, 3, 4].includes(s);

describe(`data files in ${DATA_DIR}`, () => {
  it('cells are indexed by position and carry every field', () => {
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach((c, idx) => {
      expect(c.i).toBe(idx);
      expect(c.h3).toMatch(/^89[0-9a-f]{13}$/);
      expect(c.hood.length).toBeGreaterThan(0);
      for (const n of [c.pop, c.pop65, c.lowInc, c.noCarHH, c.heatC, c.treePct]) {
        expect(Number.isFinite(n)).toBe(true);
      }
      expect(c.pop65).toBeLessThanOrEqual(c.pop);
      expect(validStep(c.floodStep)).toBe(true);
      expect(typeof c.cutOff).toBe('boolean');
    });
  });

  it('sites and flood roads reference real cells', () => {
    for (const s of sites) {
      expect(validCell(s.cell)).toBe(true);
      expect(validStep(s.floodStep)).toBe(true);
      expect(s.coverDry.every(validCell)).toBe(true);
      expect(s.coverFlood.every(validCell)).toBe(true);
      expect(s.coverFlood.every((i) => s.coverDry.includes(i))).toBe(true);
    }
    for (const r of roads) {
      expect(r.coords.length).toBeGreaterThanOrEqual(2);
      expect(validStep(r.floodStep)).toBe(true);
      expect(r.unlocks.every((i) => validCell(i) && cells[i]!.cutOff)).toBe(true);
    }
  });

  it('graph edges and hospitals reference real nodes', () => {
    const n = graph.nodes.length;
    for (const [a, b, secs, step] of graph.edges) {
      expect(a >= 0 && a < n && b >= 0 && b < n).toBe(true);
      expect(secs).toBeGreaterThan(0);
      expect(validStep(step)).toBe(true);
    }
    for (const h of hospitals) expect(h.node >= 0 && h.node < n).toBe(true);
  });

  it('flood steps are polygons tagged 1 to 3', () => {
    expect(steps.type).toBe('FeatureCollection');
    const tagged = new Set(steps.features.map((f) => f.properties.step));
    expect([...tagged].sort()).toEqual([1, 2, 3]);
  });

  it('every file is under the 5 MB budget', () => {
    for (const f of ['cells.json', 'sites.json', 'flood_roads.json', 'roads_graph.json', 'flood_steps.geojson']) {
      expect(statSync(`${DATA_DIR}/${f}`).size).toBeLessThan(5 * 1024 * 1024);
    }
  });
});
