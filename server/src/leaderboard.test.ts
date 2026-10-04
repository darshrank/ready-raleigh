import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from '../../shared/scripts/bundle';
import { buildServer } from './app';
import { loadGameData } from './data';
import { MemoryStore, failSoft, type PlayStore } from './db/store';
import { boardName, cleanName, rankBoard, type PlayerBest } from './leaderboard';

const game = loadGameData(FIXTURES_DIR);
const store = new MemoryStore();
// The fixtures stand in for Raleigh and for Miami.
const app = buildServer({ store, data: (city) => (city === 'raleigh' || city === 'miami' ? game : null) });
afterAll(() => app.close());

const road = (id: string) => ({ id, type: 'road_protection', roadId: game.bundle.floodRoads[0]!.id });
const site = (k: number) => ({ id: `s${k}`, type: 'shelter', siteId: game.bundle.sites[k]!.id });
const play = (playerId: string, playerName: string, placements: object[], city?: string) =>
  app.inject({
    method: 'POST',
    url: '/api/plays',
    payload: { plan: { roomCode: 'solo', playerId, playerName, mode: 'flood', placements, spent: 0, ...(city ? { city } : {}) } },
  });
const board = async (query: string) => (await app.inject({ method: 'GET', url: `/api/leaderboard?${query}` })).json();

describe('leaderboard', () => {
  it('ranks each player by their best play in the city', async () => {
    expect((await play('player-ana', 'Ana', [])).statusCode).toBe(201);
    expect((await play('player-ana', 'Ana', [site(0)])).statusCode).toBe(201);
    expect((await play('player-bo', 'Bo', [road('r')])).statusCode).toBe(201);
    // Another city's board is its own.
    expect((await play('player-cy', 'Cy', [site(1)], 'miami')).statusCode).toBe(201);

    const raleigh = await board('city=raleigh&mode=flood&playerId=player-bo');
    expect(raleigh.store).toBe('memory');
    expect(raleigh.players).toBe(2);
    expect(raleigh.plays).toBe(3);
    const names = raleigh.entries.map((e: { name: string }) => e.name);
    expect(names).toEqual([...names].sort((a, b) => {
      const s = (n: string) => raleigh.entries.find((e: { name: string }) => e.name === n).score;
      return s(b) - s(a);
    }));
    expect(raleigh.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2]);
    // Ana's best is her shelter play, not the empty one.
    const ana = raleigh.entries.find((e: { name: string }) => e.name === 'Ana');
    const anaPlays = store.plays.filter((p) => p.plan.playerId === 'player-ana').map((p) => p.score.score);
    expect(ana.score).toBeCloseTo(Math.max(...anaPlays), 1);
    // The asker's row is marked; ids never leave the server.
    expect(raleigh.you.name).toBe('Bo');
    expect(raleigh.you.you).toBe(true);
    expect(JSON.stringify(raleigh)).not.toContain('player-');

    const miami = await board('city=miami&playerId=player-ana');
    expect(miami.players).toBe(1);
    expect(miami.entries[0].name).toBe('Cy');
    expect(miami.you).toBeNull();
  });

  it('keeps other cities out of Raleigh counts', async () => {
    expect((await store.crowd('flood')).plays).toBe(3);
    expect(store.plays.find((p) => p.plan.playerId === 'player-cy')!.plan.city).toBe('miami');
  });

  it('refuses boards for cities that are not on the map, and bad modes', async () => {
    for (const city of ['atlantis', '..%2Fetc']) {
      expect((await app.inject({ method: 'GET', url: `/api/leaderboard?city=${city}` })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/api/leaderboard?mode=lava' })).statusCode).toBe(400);
  });

  it('renames a player on every board', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/players/name', payload: { playerId: 'player-bo', name: '  Mayor   Bo \u0007' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'Mayor Bo', updated: 1 });
    expect((await board('city=raleigh&playerId=player-bo')).you.name).toBe('Mayor Bo');
    const bad = (payload: object) => app.inject({ method: 'POST', url: '/api/players/name', payload });
    expect((await bad({ playerId: 'player-bo', name: '   ' })).statusCode).toBe(400);
    expect((await bad({ name: 'Bo' })).statusCode).toBe(400);
  });
});

describe('rankBoard', () => {
  const best = (playerId: string, score: number, minute: number, plays = 1): PlayerBest => ({
    playerId, name: playerId, score, protectedPeople: score * 100, strandedPeople: 10, spent: 5e6,
    createdAt: new Date(Date.UTC(2026, 9, 3, 12, minute)), plays,
  });

  it('breaks ties by who got there first, and finds a player below the top', () => {
    const b = rankBoard([best('late', 50, 9), best('early', 50, 1), best('top', 80, 5), best('low', 10, 2)], 2, 'low');
    expect(b.entries.map((e) => e.name)).toEqual(['top', 'early']);
    expect(b.you).toMatchObject({ name: 'low', rank: 4, you: true });
    expect(b.players).toBe(4);
  });

  it('merges a player seen in two stores, keeping the better play', () => {
    const b = rankBoard([best('ana', 40, 1, 3), best('ana', 60, 2, 1)], 8);
    expect(b.players).toBe(1);
    expect(b.plays).toBe(4);
    expect(b.entries[0]!.score).toBe(60);
  });

  it('cleans names', () => {
    expect(cleanName('  Ana\n  Lopez ')).toBe('Ana Lopez');
    expect(cleanName(42)).toBe('');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
  });

  it('shows old "You" plays under the browser default name, not as you', () => {
    expect(boardName('You', '7f3a9c1e-0000-4000-8000-000000000000')).toBe('Mayor 7F3A');
    expect(boardName('  ', 'ab-cd-ef')).toBe('Mayor ABCD');
    expect(boardName('Priya', 'x')).toBe('Priya');
    const b = rankBoard([best('7f3a9c1e', 10, 1)].map((r) => ({ ...r, name: 'You' })), 8);
    expect(b.entries[0]!.name).toBe('Mayor 7F3A');
  });
});

describe('failSoft leaderboard', () => {
  it('answers from memory when the database is down', async () => {
    const broken: PlayStore = {
      kind: 'tiger',
      savePlay: async () => { throw new Error('down'); },
      crowd: async () => { throw new Error('down'); },
      pickups: async () => { throw new Error('down'); },
      pickers: async () => { throw new Error('down'); },
      bestScore: async () => { throw new Error('down'); },
      bests: async () => { throw new Error('down'); },
      renamePlayer: async () => { throw new Error('down'); },
      close: async () => {},
    };
    const soft = failSoft(broken, { warn: () => {} });
    await soft.savePlay({ ...store.plays[0]!, id: 'outage' });
    expect(await soft.renamePlayer(store.plays[0]!.plan.playerId, 'Outage Ana')).toBe(1);
    const bests = await soft.bests('raleigh', 'flood');
    expect(bests).toHaveLength(1);
    expect(bests[0]!.name).toBe('Outage Ana');
  });
});
