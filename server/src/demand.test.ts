import { afterAll, describe, expect, it } from 'vitest';
import { cellToLatLng, cellToParent } from 'h3-js';
import { FIXTURES_DIR } from '../../shared/scripts/bundle';
import { buildServer } from './app';
import { type TransitStops, loadGameData } from './data';
import { MemoryStore } from './db/store';
import { AREA_RES, MIN_PLAYERS_FLOOR, WALK_M, busDemand, demandCsv, demandGeoJson } from './demand';

const game = loadGameData(FIXTURES_DIR);
const { cells } = game.bundle;

// Two areas with requests: one with a bus stop right next to the requested cell, one without.
const areaOf = (i: number) => cellToParent(cells[i]!.h3, AREA_RES);
const first = 0;
const second = cells.findIndex((c) => cellToParent(c.h3, AREA_RES) !== areaOf(first));
const third = cells.findIndex((c) => ![areaOf(first), areaOf(second)].includes(cellToParent(c.h3, AREA_RES)));
const [lat, lon] = cellToLatLng(cells[first]!.h3);
const transit: TransitStops = {
  built: 'test',
  sources: [{ agency: 'GoRaleigh', url: 'x', feedStart: '2024-01-26', feedEnd: '2024-03-31', expired: true, stops: 2 }],
  stops: [[lon + 0.0005, lat, 'Next door', 0], [lon + 0.5, lat + 0.5, 'Far away', 0]],
};
const picks = (cell: number, players: string[]) => players.map((player) => ({ cell, player }));
const pickups = {
  plays: 12,
  players: 10,
  picks: [
    ...picks(first, ['a', 'b', 'c', 'd', 'e', 'e']), // e twice: still 5 players
    ...picks(second, ['a', 'b', 'c', 'd', 'f', 'g']),
    ...(third >= 0 ? picks(third, ['h']) : []), // one player only: hidden
  ],
};

describe('bus pickup demand', () => {
  const report = busDemand({ mode: 'flood', data: game.bundle, transit, pickups, since: new Date(0) });

  it('counts distinct players per area and hides small areas', () => {
    expect(report.minPlayers).toBe(5);
    const byArea = new Map(report.areas.map((a) => [a.area, a]));
    expect(byArea.get(areaOf(first))?.players).toBe(5);
    expect(byArea.get(areaOf(first))?.picks).toBe(6);
    expect(byArea.get(areaOf(second))?.players).toBe(6);
    expect(report.hiddenAreas).toBe(third >= 0 ? 1 : 0);
    expect(report.areas.every((a) => a.players >= 5)).toBe(true);
  });

  it('flags gaps (no stop within a five-minute walk) first', () => {
    const near = report.areas.find((a) => a.area === areaOf(first))!;
    const far = report.areas.find((a) => a.area === areaOf(second))!;
    expect(near.gap).toBe(false);
    expect(near.nearestStop!.meters).toBeLessThanOrEqual(WALK_M);
    expect(near.reason).toMatch(/designate as an evacuation pickup/);
    expect(far.gap).toBe(true);
    expect(far.reason).toMatch(/new evacuation pickup/);
    expect(report.areas[0]!.gap).toBe(true);
    expect(report.gaps).toBe(1);
    expect(report.summary).toMatch(/feed that ended 2024-03-31/);
  });

  it('never goes below the privacy floor', () => {
    const low = busDemand({ mode: 'flood', data: game.bundle, transit, pickups, since: new Date(0), minPlayers: 1 });
    expect(low.minPlayers).toBe(MIN_PLAYERS_FLOOR);
  });

  it('exports CSV and GeoJSON', () => {
    const csv = demandCsv(report).trim().split('\n');
    expect(csv[0]).toMatch(/^rank,area_h3,neighborhood/);
    expect(csv).toHaveLength(report.areas.length + 1);
    const geo = demandGeoJson(report);
    expect(geo.features).toHaveLength(report.areas.length);
    const ring = geo.features[0]!.geometry.coordinates[0]!;
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring.length).toBeGreaterThanOrEqual(7);
  });
});

describe('GET /api/planner/bus-demand', () => {
  const store = new MemoryStore();
  const app = buildServer({ store, data: () => ({ ...game, transit }) });
  afterAll(() => app.close());

  it('reports plays from the store, in three formats', async () => {
    for (const id of ['p1', 'p2', 'p3']) {
      const res = await app.inject({ method: 'POST', url: '/api/plays', payload: { plan: {
        roomCode: 'solo', playerId: id, playerName: id, mode: 'flood', spent: 0,
        placements: [{ id: 'b', type: 'bus_pickup', cell: second }] } } });
      expect(res.statusCode).toBe(201);
    }
    const json = (await app.inject({ method: 'GET', url: '/api/planner/bus-demand?minPlayers=3' })).json();
    expect(json).toMatchObject({ store: 'memory', plays: 3, players: 3, minPlayers: 3, gaps: 1 });
    expect(json.areas[0].players).toBe(3);
    const csv = await app.inject({ method: 'GET', url: '/api/planner/bus-demand?minPlayers=3&format=csv' });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/bus-pickup-demand-.*\.csv/);
    const geo = await app.inject({ method: 'GET', url: '/api/planner/bus-demand?minPlayers=3&format=geojson' });
    expect(geo.json().features).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/planner/bus-demand?mode=lava' })).statusCode).toBe(400);
  });
});
