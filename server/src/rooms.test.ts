import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { CANDIDATES, LOCK_GRACE_MS, PLANNING_SECONDS, type RoomState, type ServerMsg } from '@shared';
import { FIXTURES_DIR } from '../../shared/scripts/bundle';
import { buildServer } from './app';
import { loadGameData } from './data';
import { MemoryStore } from './db/store';
import { RoomError, again, getOrCreateRoom, join, lock, pick, presence, rooms, start, tick } from './rooms';

const okScorer = (score: number) => () => ({ score, bestPossible: 90, atRiskWeighted: 1, protectedWeighted: 1, protectedPeople: score * 10, strandedPeople: 5, vulnerable: { protectedPct: 0, everyonePct: 0 }, byHood: [], topMisses: [], baseline: { protectedPeople: 0, protectedWeighted: 0 } });

describe('room state machine', () => {
  const fresh = (code = 'ABCD') => {
    rooms.delete(code);
    return getOrCreateRoom(code, 0);
  };

  it('accepts only the landing page code alphabet', () => {
    expect(() => getOrCreateRoom('AB1D')).toThrow(RoomError);
    expect(() => getOrCreateRoom('ABIO')).toThrow(RoomError);
  });

  it('candidates are unique, names are unique, joining closes when planning starts', () => {
    const room = fresh();
    const a = join(room, 'Ana', CANDIDATES[0]);
    expect(() => join(room, 'Ben', CANDIDATES[0])).toThrow(/taken/);
    expect(() => join(room, 'ana', CANDIDATES[1])).toThrow(/name/);
    expect(() => join(room, 'Ben', 'peep-999')).toThrow(/Pick a candidate/);
    const b = join(room, 'Ben', CANDIDATES[1]);
    expect(() => pick(room, b, CANDIDATES[0])).toThrow(/taken/);
    pick(room, b, CANDIDATES[2]);
    expect(() => start(room, b, 1000)).toThrow(/Only the host/);
    start(room, a, 1000);
    expect(room.phase).toBe('planning');
    expect(room.endsAt).toBe(1000 + PLANNING_SECONDS * 1000);
    expect(() => join(room, 'Cy', CANDIDATES[3])).toThrow(/under way/);
    expect(() => pick(room, a, CANDIDATES[5])).toThrow(RoomError);
  });

  it('ranks platforms by the server score; ties go to the earlier lock', () => {
    const room = fresh();
    const a = join(room, 'Ana', CANDIDATES[0]);
    const b = join(room, 'Ben', CANDIDATES[1]);
    const c = join(room, 'Cy', CANDIDATES[2]);
    start(room, a, 0);
    lock(room, b, [], okScorer(70), 2000);
    lock(room, a, [], okScorer(70), 3000);
    expect(room.phase).toBe('planning');
    lock(room, c, [], okScorer(80), 4000);
    expect(room.phase).toBe('results');
    expect(room.results!.map((r) => r.name)).toEqual(['Cy', 'Ben', 'Ana']);
    expect(room.results!.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(() => lock(room, a, [], okScorer(1), 5000)).toThrow(/over/);
    expect(() => again(room, b)).toThrow(/Only the host/);
    again(room, a);
    expect(room.phase).toBe('lobby');
  });

  it('the host is a player; when the host leaves, the next candidate hosts', () => {
    const room = fresh();
    const a = join(room, 'Ana', CANDIDATES[0]);
    const b = join(room, 'Ben', CANDIDATES[1]);
    expect(room.hostSeat).toBe(a.seat);
    presence(room, a, false);
    expect(room.hostSeat).toBe(b.seat);
    start(room, b, 0);
    expect(room.phase).toBe('planning');
  });

  it('a candidate who leaves does not hold the round; the clock closes it after the grace', () => {
    const room = fresh();
    const a = join(room, 'Ana', CANDIDATES[0]);
    const b = join(room, 'Ben', CANDIDATES[1]);
    start(room, a, 0);
    lock(room, a, [], okScorer(50), 1000);
    presence(room, b, false);
    expect(room.phase).toBe('results');
    expect(room.results!.find((r) => r.name === 'Ben')).toMatchObject({ submitted: false, score: 0 });

    const r2 = fresh('WXYZ');
    const solo = join(r2, 'Ana', CANDIDATES[0]);
    start(r2, solo, 0);
    expect(tick(r2, PLANNING_SECONDS * 1000 + LOCK_GRACE_MS - 1)).toBe(false);
    expect(tick(r2, PLANNING_SECONDS * 1000 + LOCK_GRACE_MS)).toBe(true);
    expect(r2.phase).toBe('results');
  });
});

describe('/ws/rooms/:code with the real engine and store', () => {
  const store = new MemoryStore();
  const game = loadGameData(FIXTURES_DIR);
  const app = buildServer({ store, data: () => game });
  let url = '';
  beforeAll(async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws/rooms/`;
  });
  afterAll(() => app.close());

  const client = (code: string) => {
    const ws = new WebSocket(url + code);
    const msgs: ServerMsg[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    const open = new Promise((r) => ws.on('open', r));
    const send = (m: object) => ws.send(JSON.stringify(m));
    const wait = async (pred: (m: ServerMsg) => boolean) => {
      for (let i = 0; i < 200; i++) {
        const hit = [...msgs].reverse().find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`timeout; last ${JSON.stringify(msgs.at(-1))}`);
    };
    const state = (pred: (s: RoomState) => boolean) => wait((m) => m.t === 'state' && pred(m.state)) as Promise<{ t: 'state'; state: RoomState }>;
    return { ws, open, send, wait, state, msgs };
  };

  it('host + 1 candidate, no central screen: create, join, plan, ranked, stored with the candidate, resume', async () => {
    const ana = client('QRST');
    const ben = client('qrst');
    await Promise.all([ana.open, ben.open]);
    ben.send({ t: 'look' });
    expect(((await ben.wait((m) => m.t === 'error')) as { message: string }).message).toMatch(/not found/);
    ana.send({ t: 'join', name: 'Ana', candidate: CANDIDATES[0], create: true });
    const joined = (await ana.wait((m) => m.t === 'joined')) as { playerId: string };
    expect((await ana.state((s) => s.players.length === 1)).state.hostSeat).toBe(0);
    ben.msgs.length = 0;
    ben.send({ t: 'join', name: 'Ben', candidate: CANDIDATES[0] });
    expect(((await ben.wait((m) => m.t === 'error')) as { message: string }).message).toMatch(/taken/);
    ben.send({ t: 'join', name: 'Ben', candidate: CANDIDATES[1] });
    await ana.state((s) => s.players.length === 2);

    ben.msgs.length = 0;
    ben.send({ t: 'start' });
    expect(((await ben.wait((m) => m.t === 'error')) as { message: string }).message).toMatch(/Only the host/);
    ana.send({ t: 'start' });
    await ben.state((s) => s.phase === 'planning');

    // Ana's phone reloads mid-planning and resumes with her stored id.
    ana.ws.close();
    const ana2 = client('QRST');
    await ana2.open;
    ana2.send({ t: 'resume', playerId: joined.playerId });
    expect((await ana2.state((s) => s.you === 0 && s.phase === 'planning')).state.players[0]!.connected).toBe(true);

    const road = game.bundle.floodRoads[0]!;
    ana2.send({ t: 'lock', placements: [{ id: 'a', type: 'road_protection', roadId: road.id }] });
    ben.msgs.length = 0;
    ben.send({ t: 'lock', placements: [{ id: 'b', type: 'road_protection', roadId: 'no-such-road' }] });
    expect(((await ben.wait((m) => m.t === 'error')) as { message: string }).message).toMatch(/not valid/);
    ben.send({ t: 'lock', placements: [] });
    const end = (await ana2.state((s) => s.phase === 'results')).state;
    expect(end.results).toHaveLength(2);
    expect(end.results![0]!.name).toBe('Ana');
    expect(end.results![0]!.score).toBeGreaterThan(end.results![1]!.score);
    expect(end.bestPossible).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 50));
    const saved = store.plays.filter((p) => p.plan.roomCode === 'QRST');
    expect(saved.map((p) => p.candidate).sort()).toEqual([CANDIDATES[0], CANDIDATES[1]].sort());
    expect(saved.find((p) => p.plan.playerName === 'Ana')!.score.score).toBeCloseTo(end.results![0]!.score);
    for (const c of [ana2, ben]) c.ws.close();
  });
});

describe('look', () => {
  it('a phone that has not joined sees the room, or a clear error', async () => {
    const app = buildServer({ store: new MemoryStore(), data: () => null });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const ask = (code: string) =>
      new Promise<ServerMsg>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/rooms/${code}`);
        ws.on('open', () => ws.send(JSON.stringify({ t: 'look' })));
        ws.on('message', (d) => {
          resolve(JSON.parse(String(d)));
          ws.close();
        });
      });
    getOrCreateRoom('LMNP');
    expect(await ask('LMNP')).toMatchObject({ t: 'state', state: { code: 'LMNP', you: null } });
    expect(await ask('ZZZZ')).toMatchObject({ t: 'error', message: expect.stringMatching(/not found/) });
    await app.close();
  });
});
