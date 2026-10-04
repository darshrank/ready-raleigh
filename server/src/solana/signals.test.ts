import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from '../../../shared/scripts/bundle';
import { buildServer } from '../app';
import { loadGameData } from '../data';
import { MemoryStore } from '../db/store';
import type { PlannerResult, PlannerSpot } from '../planner';
import type { Chain } from './chain';
import { civicRecord } from './civic';
import { BLIND_MIN_PLAYS, spotSignals } from './signals';
import { MemoryCivicStore, type Signal } from './store';

const spot = (target: string, over: Partial<PlannerSpot>): PlannerSpot => ({
  target, type: 'shelter', name: 'Enloe High School', hood: 'Five Points', cell: 1, lon: 0, lat: 0, category: 'data',
  inOptimal: true, dataRank: 1, crowdPicks: 0, crowdShare: 0, protectedWeighted: 10, protectedPeople: 900, reason: '', ...over,
});
const ranking = (plays: number, spots: PlannerSpot[]) => ({ plays, spots }) as unknown as PlannerResult;

describe('spotSignals (the rules)', () => {
  it('turns consensus on when a spot is in "both" and off when it leaves', () => {
    const both = ranking(4, [spot('site:a', { category: 'both', crowdPicks: 3 })]);
    const first = spotSignals(both, new Set());
    expect(first.changes).toMatchObject([{ type: 'consensus', spot: 'site:a', state: 'on', label: 'Enloe High School (Five Points)' }]);
    const gone = spotSignals(ranking(9, [spot('site:a', { category: 'data', crowdPicks: 1 })]), first.on);
    expect(gone.changes).toMatchObject([{ type: 'consensus', state: 'off' }]);
    expect(spotSignals(both, first.on).changes).toEqual([]);
  });

  it('calls a top data spot a blind spot only after enough plays, and clears it when picked', () => {
    const missed = (plays: number, picks: number) => ranking(plays, [spot('road:r1', { dataRank: 2, crowdPicks: picks }), spot('road:r9', { dataRank: 7 })]);
    expect(spotSignals(missed(BLIND_MIN_PLAYS - 1, 0), new Set()).changes).toEqual([]);
    const on = spotSignals(missed(BLIND_MIN_PLAYS, 0), new Set());
    expect(on.changes).toMatchObject([{ type: 'blind_spot', spot: 'road:r1', state: 'on' }]);
    expect(spotSignals(missed(BLIND_MIN_PLAYS + 1, 1), on.on).changes).toMatchObject([{ type: 'blind_spot', state: 'off' }]);
  });
});

describe('civic signals on the server', () => {
  const game = loadGameData(FIXTURES_DIR);
  const memos: string[] = [];
  const chain: Chain = {
    address: 'Authority', rpcUrl: 'fake', balanceSol: async () => 1,
    memo: async (text) => (memos.push(text), { signature: `sig${memos.length}`, slot: memos.length }),
  };
  const awards: { signal: Signal; playId: string }[] = [];
  const civic = civicRecord({ store: new MemoryCivicStore(), chain, dataBuild: () => 'fixture', log: { info: () => {}, warn: () => {} } });
  const app = buildServer({ store: new MemoryStore(), data: () => game, civic, onAward: (signal, play) => awards.push({ signal, playId: play.playId }) });
  afterAll(() => app.close());

  const top = game.optimal('flood').placements[0]!;
  const post = async (player: string, placements: object[]) => {
    const res = await app.inject({
      method: 'POST', url: '/api/plays',
      payload: { plan: { roomCode: 'SOLO', playerId: player, playerName: player, mode: 'flood', placements, spent: 0 } },
    });
    expect(res.statusCode).toBe(201);
    await new Promise((r) => setTimeout(r, 20)); // the fingerprint, then the rules, run after the answer
    return res.json().id as string;
  };

  it('publishes consensus once three different players back the same spot, and awards the third', async () => {
    await post('ana', [top]);
    await post('ana', [top]); // the same person twice is still one voice
    expect(memos.filter((m) => m.includes('consensus'))).toEqual([]);
    await post('ben', [top]);
    const cy = await post('cy', [top]);
    const consensus = memos.filter((m) => m.includes('.consensus:'));
    expect(consensus).toHaveLength(1);
    expect(consensus[0]).toMatch(/^ready-raleigh:v1:signal:raleigh:flood\.consensus:.+:on:[0-9a-f]{64}$/);
    expect(awards.map((a) => [a.signal.type, a.playId])).toContainEqual(['consensus', cy]);
    const listed = (await app.inject({ method: 'GET', url: '/api/solana/signals' })).json();
    expect(listed.signals[0]).toMatchObject({ type: 'consensus', state: 'on', anchor: { status: 'confirmed' } });
    expect(listed.signals[0].playIds).toHaveLength(4);
  });

  it('starts from what was published: a restart publishes what changed, not a silent baseline', async () => {
    // A fresh server sharing the same civic store: its boot state is the published history.
    const restarted = buildServer({ store: new MemoryStore(), data: () => game, civic });
    const published = (await civic.store.signals(100)).filter((s) => s.type === 'consensus' && s.city === 'raleigh');
    const before = memos.length;
    // The new server's play store is empty, so the spot is no longer consensus there: it must say so.
    const res = await restarted.inject({
      method: 'POST', url: '/api/plays',
      payload: { plan: { roomCode: 'SOLO', playerId: 'dee', playerName: 'dee', mode: 'flood', placements: [], spent: 0 } },
    });
    expect(res.statusCode).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    expect(published.some((s) => s.state === 'on')).toBe(true);
    expect(memos.slice(before).filter((m) => m.includes('raleigh:flood.consensus:') && m.includes(':off:'))).toHaveLength(1);
    await restarted.close();
  });

  it('runs each city on its own: Miami plays build Miami consensus, published under miami', async () => {
    const before = memos.length;
    const miami = async (player: string) => {
      const res = await app.inject({
        method: 'POST', url: '/api/plays',
        payload: { plan: { roomCode: 'SOLO', playerId: player, playerName: player, mode: 'flood', placements: [top], spent: 0, city: 'miami' } },
      });
      expect(res.statusCode).toBe(201);
      await new Promise((r) => setTimeout(r, 20));
    };
    await miami('mia-1');
    await miami('mia-2');
    expect(memos.slice(before).filter((m) => m.includes('.consensus:'))).toEqual([]); // Raleigh's backers do not count for Miami
    await miami('mia-3');
    await miami('mia-4');
    const published = memos.slice(before).filter((m) => m.includes('.consensus:'));
    expect(published).toHaveLength(1);
    expect(published[0]).toMatch(/^ready-raleigh:v1:signal:miami:flood\.consensus:/);
  });
});
