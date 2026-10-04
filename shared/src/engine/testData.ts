// Test helpers: a seeded synthetic bundle of any size, and random valid plans. Not exported from
// the engine index; tests import it directly.
import { gridDisk, gridDistance, latLngToCell } from 'h3-js';
import { BUDGET, MODE_INTERVENTIONS, placementCost } from '../config';
import type { DataBundle } from '../data';
import type { Cell, FloodRoad, Mode, Placement, Plan, Site } from '../types';
import { engineIndex } from './context';

export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `nCells` res-9 cells around downtown Raleigh with random people, flooding, heat, sites, roads. */
export function syntheticBundle(nCells: number, seed = 1, nSites = 400, nRoads = 60): DataBundle {
  const rand = mulberry32(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  let k = 0;
  while (3 * k * (k + 1) + 1 < nCells) k++;
  const h3s = gridDisk(latLngToCell(35.7796, -78.6382, 9), k).sort().slice(0, nCells);
  const index = new Map(h3s.map((h, i) => [h, i]));
  const hoods = ['Downtown', 'Five Points', 'Oakwood', 'Boylan Heights', 'South Park', 'Mordecai', 'Cameron Village', 'Glenwood'];

  const cells: Cell[] = h3s.map((h3, i) => {
    const pop = Math.round(50 + rand() * 1500);
    const flood = rand();
    return {
      i,
      h3,
      hood: hoods[i % hoods.length]!,
      pop,
      pop65: Math.round(pop * rand() * 0.2),
      lowInc: Math.round(pop * rand() * 0.4),
      noCarHH: Math.round((pop / 2.2) * rand() * 0.3),
      floodStep: flood < 0.05 ? 1 : flood < 0.12 ? 2 : flood < 0.2 ? 3 : null,
      floodFrac: flood < .2 ? 1 : 0,
      cutOff: rand() < 0.12,
      heatC: Math.round((30 + rand() * 14) * 10) / 10,
      treePct: Math.round(rand() * 60),
    };
  });
  const near = (cell: number, radius: number) =>
    gridDisk(h3s[cell]!, radius).flatMap((h) => {
      const j = index.get(h);
      return j === undefined ? [] : [j];
    });
  const cutOff = cells.filter((c) => c.cutOff).map((c) => c.i);

  const sites: Site[] = Array.from({ length: nSites }, (_, s) => {
    const cell = Math.floor(rand() * nCells);
    const time = (i: number) => gridDistance(h3s[cell]!, h3s[i]!) * 30_000;
    const coverDry = near(cell, 14).sort((a, b) => time(a) - time(b) || a - b);
    const coverFlood = coverDry.filter(() => rand() < .7);
    return {
      id: `site-${s}`,
      name: `Site ${s}`,
      kind: pick(['school', 'library', 'community_centre', 'place_of_worship']),
      lon: 0,
      lat: 0,
      cell,
      floodStep: cells[cell]!.floodStep,
      coverDry,
      coverFlood,
      driveDry: coverDry.map(time),
      driveFlood: coverFlood.map(time),
    };
  });
  const floodRoads: FloodRoad[] = Array.from({ length: nRoads }, (_, r) => ({
    id: `road-${r}`,
    name: `Road ${r}`,
    floodStep: 1 + Math.floor(rand() * 3),
    coords: [
      [0, 0],
      [0, 0],
    ],
    unlocks: cutOff.filter(() => rand() < 0.05),
  }));
  return { cells, sites, floodRoads };
}

/** Every placement a player could make in this mode (including useless ones). */
export function allPlacements(mode: Mode, data: DataBundle): Omit<Placement, 'id'>[] {
  const out: Omit<Placement, 'id'>[] = [];
  for (const type of MODE_INTERVENTIONS[mode]) {
    if (type === 'shelter') for (const s of data.sites) out.push({ type, siteId: s.id });
    else if (type === 'road_protection') for (const r of data.floodRoads) out.push({ type, roadId: r.id });
    else if (type === 'bus_pickup') {
      // New pickups only where a bus can reach someone; existing stops too.
      const idx = engineIndex(data);
      for (const c of data.cells) if (idx.busOk[c.i]) out.push({ type, cell: c.i });
      for (const [stopId, { cell }] of idx.stops) if (idx.busOk[cell]) out.push({ type, cell, stopId });
    } else for (const c of data.cells) out.push({ type, cell: c.i });
  }
  return out;
}

export function makePlan(mode: Mode, placements: Omit<Placement, 'id'>[]): Plan {
  const ps = placements.map((p, n) => ({ id: `p${n}`, ...p }));
  return {
    roomCode: 'TEST',
    playerId: 'tester',
    playerName: 'Tester',
    mode,
    placements: ps,
    spent: ps.reduce((s, p) => s + placementCost(p), 0),
  };
}

/**
 * A random valid plan: draws placements until the budget is spent or `stopChance` ends it early.
 * No site or road twice.
 */
export function randomPlan(mode: Mode, data: DataBundle, rand: () => number, stopChance = 0, budget = BUDGET): Plan {
  const pool = allPlacements(mode, data);
  const chosen: Omit<Placement, 'id'>[] = [];
  const used = new Set<string>();
  let left = budget;
  for (;;) {
    if (rand() < stopChance) break;
    const fits = pool.filter((p) => placementCost(p) <= left && !used.has(key(p)));
    if (fits.length === 0) break;
    const p = fits[Math.floor(rand() * fits.length)]!;
    chosen.push(p);
    left -= placementCost(p);
    if (p.siteId || p.roadId) used.add(key(p));
  }
  return makePlan(mode, chosen);
}

export const key = (p: Omit<Placement, 'id'>) => `${p.type}:${p.siteId ?? p.roadId ?? p.stopId ?? p.cell}`;
