import { afterAll, describe, expect, it } from 'vitest';
import { score } from '@shared';
import { FIXTURES_DIR } from '../../shared/scripts/bundle';
import { buildServer } from './app';
import { loadGameData } from './data';
import { MemoryStore, failSoft, type PlayStore } from './db/store';
import { schemaStatements } from './db/tiger';

const game = loadGameData(FIXTURES_DIR);
const store = new MemoryStore();
const app = buildServer({ store, data: () => game });
afterAll(() => app.close());

const plan = (name: string, placements: object[]) => ({
  roomCode: 'abcd', playerId: name, playerName: name, mode: 'flood', placements, spent: 0,
});
const post = (body: unknown) => app.inject({ method: 'POST', url: '/api/plays', payload: body as object });
const planner = async () => (await app.inject({ method: 'GET', url: '/api/planner?mode=flood' })).json();

describe('POST /api/plays', () => {
  it('scores the plan on the server and stores it', async () => {
    const placements = [{ id: 'a', type: 'road_protection', roadId: 'road-pullen' }];
    const res = await post({ plan: plan('Ana', placements), score: { score: 100 } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const expected = score({ ...plan('Ana', placements), roomCode: 'ABCD', spent: 2_000_000 } as never, game.bundle);
    expect(body.score.score).toBeCloseTo(expected.score);
    expect(body.store).toBe('memory');
    const saved = store.plays.at(-1)!;
    expect(saved.plan.roomCode).toBe('ABCD');
    expect(saved.plan.spent).toBe(2_000_000);
    expect(saved.placements).toEqual([{ type: 'road_protection', target: 'road:road-pullen', cell: null }]);
  });

  it('scores each plan with the data of its own city', async () => {
    const asked: (string | undefined)[] = [];
    const cityApp = buildServer({ store: new MemoryStore(), data: (city) => { asked.push(city); return game; } });
    const placements = [{ id: 'a', type: 'road_protection', roadId: 'road-pullen' }];
    // Each plan is scored and stored under its own city (unknown cities fall back to Raleigh). The
    // civic record also asks for a play's city afterwards, so the asks are checked as a set.
    const cityStore = new MemoryStore();
    const cityApp2 = buildServer({ store: cityStore, data: (city) => { asked.push(city); return game; } });
    for (const body of [{ ...plan('Mia', placements), city: 'miami' }, { ...plan('Ral', placements), city: 'atlantis' }, plan('Old', placements)]) {
      expect((await cityApp2.inject({ method: 'POST', url: '/api/plays', payload: { plan: body } })).statusCode).toBe(201);
    }
    expect(cityStore.plays.map((p) => p.plan.city ?? 'raleigh')).toEqual(['miami', 'raleigh', 'raleigh']);
    expect(asked).toContain('miami');
    await cityApp2.close();
    await cityApp.inject({ method: 'POST', url: '/api/plays', payload: { plan: { ...plan('Mia', placements), city: 'miami' } } });
    expect(asked).not.toContain('atlantis');
    // Crowd data stays per city.
    const res = (await cityApp.inject({ method: 'GET', url: '/api/planner?mode=flood&city=miami' })).json();
    expect(res.city).toBe('miami');
    expect(res.plays).toBe(1);
    await cityApp.close();
  });

  it('rejects plans that break the rules', async () => {
    const tooMuch = Array.from({ length: 4 }, (_, k) => ({ id: `s${k}`, type: 'shelter', siteId: game.bundle.sites[k]!.id }));
    const res = await post({ plan: plan('Bo', tooMuch) });
    expect(res.statusCode).toBe(400);
    expect(res.json().problems.join(' ')).toMatch(/over budget/);
    expect((await post({ plan: { mode: 'lava', placements: [] } })).statusCode).toBe(400);
    expect((await post({})).statusCode).toBe(400);
  });
});

describe('GET /api/planner', () => {
  it('splits spots into both, data only and crowd only', async () => {
    const optimal = game.optimal('flood');
    const first = optimal.placements[0]!;
    // Two players pick the best plan's first spot, one picks a site the data does not list.
    const before = await planner();
    const outsider = game.bundle.sites.find((s) => !before.spots.some((p: { target: string }) => p.target === `site:${s.id}`))!;
    await post({ plan: plan('Cy', [first]) });
    await post({ plan: plan('Di', [first, { id: 'x', type: 'shelter', siteId: outsider.id }]) });
    const res = await planner();
    expect(res.plays).toBe(3);
    const target = first.roadId ? `road:${first.roadId}` : first.siteId ? `site:${first.siteId}` : `cell:${first.cell}`;
    const both = res.spots.find((s: { target: string }) => s.target === target);
    expect(both.category).toBe('both');
    expect(both.inOptimal).toBe(true);
    const crowdOnly = res.spots.find((s: { target: string }) => s.target === `site:${outsider.id}`);
    expect(crowdOnly.category).toBe('crowd');
    expect(res.counts.data).toBeGreaterThan(0);
    expect(res.spots[0].category).toBe('both');
    for (const s of res.spots) expect(s.reason.length).toBeGreaterThan(10);
  });

  it('rejects unknown modes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/planner?mode=snow' });
    expect(res.statusCode).toBe(400);
  });
});

describe('failSoft', () => {
  it('keeps plays in memory when the database fails', async () => {
    const broken: PlayStore = {
      kind: 'tiger',
      savePlay: async () => { throw new Error('down'); },
      crowd: async () => { throw new Error('down'); },
      pickups: async () => { throw new Error('down'); },
      pickers: async () => { throw new Error('down'); },
      bestScore: async () => { throw new Error('down'); },
      close: async () => {},
    };
    const warnings: string[] = [];
    const soft = failSoft(broken, { warn: (_o, msg) => warnings.push(msg) });
    const play = { ...store.plays[0]!, id: 'x' };
    await soft.savePlay(play);
    const crowd = await soft.crowd('flood');
    expect(crowd.plays).toBe(1);
    expect(warnings).toHaveLength(2);
  });
});

describe('schema.sql', () => {
  it('splits into single statements with no comments left', () => {
    const statements = schemaStatements();
    expect(statements.length).toBeGreaterThan(15);
    for (const s of statements) {
      expect(s).not.toMatch(/;\s*$/);
      expect(s).not.toMatch(/^--/m);
    }
    expect(statements.some((s) => s.includes('timescaledb.continuous'))).toBe(true);
  });
});
