import { afterEach, describe, expect, it } from 'vitest';
import { playFingerprint, verifyProof, type Plan, type ScoreResult } from '@shared';
import { buildServer } from '../app';
import type { PlayRecord } from '../db/store';
import type { Chain } from './chain';
import { civicRecord } from './civic';
import { MemoryCivicStore } from './store';

const log = { info: () => {}, warn: () => {} };

function fakeChain(fail = false) {
  const memos: string[] = [];
  const chain: Chain = {
    address: 'Authority1111111111111111111111111111111111',
    rpcUrl: 'fake',
    async memo(text) {
      if (fail) throw new Error('blockhash not found');
      memos.push(text);
      return { signature: `sig${memos.length}`, slot: 100 + memos.length };
    },
    async balanceSol() {
      return 5;
    },
  };
  return { chain, memos };
}

function play(n: number): PlayRecord {
  const plan: Plan = { roomCode: 'SOLO', playerId: `player-${n}`, playerName: 'Ana', mode: 'flood', placements: [{ id: 'a', type: 'bus_pickup', cell: n }], spent: 1 };
  return { id: `play-${n}`, createdAt: new Date(Date.UTC(2026, 9, 4, 5, n)), plan, score: { score: 40 + n } as ScoreResult, placements: [] };
}

const records: ReturnType<typeof civicRecord>[] = [];
afterEach(() => records.splice(0).forEach((r) => r.close()));
const make = (chain: Chain | null) => {
  const store = new MemoryCivicStore();
  const r = civicRecord({ store, chain, dataBuild: () => '2026-10-03', log });
  records.push(r);
  return { r, store };
};

describe('civic record (completeness layer)', () => {
  it('fingerprints plays without names and anchors a batch in one memo with a proof per play', async () => {
    const { chain, memos } = fakeChain();
    const { r } = make(chain);
    for (const n of [1, 2, 3]) await r.recordPlay(play(n));
    const anchor = await r.flush();
    expect(anchor).toMatchObject({ status: 'confirmed', count: 3 });
    expect(memos.filter((m) => m.includes(':plays:'))).toEqual([`ready-raleigh:v1:plays:raleigh:${anchor!.root}:3:2026-10-03`]);
    for (const n of [1, 2, 3]) {
      const view = (await r.proof(`play-${n}`))!;
      expect(JSON.stringify(view.play.input)).not.toMatch(/Ana|player-/);
      expect(await playFingerprint(view.play.input)).toBe(view.play.fingerprint);
      expect(await verifyProof(view.play.fingerprint, view.play.proof!, view.anchor!.root)).toBe(true);
      expect(view.anchor!.explorerUrl).toBe(`https://explorer.solana.com/tx/${anchor!.signature}?cluster=devnet`);
    }
    expect(await r.flush()).toBeNull(); // nothing left to anchor
  });

  it('writes each play\'s decisions in words in its own memo, linked from its proof', async () => {
    const { chain, memos } = fakeChain();
    const store = new MemoryCivicStore();
    const r = civicRecord({ store, chain, dataBuild: () => '2026-10-03', log, describe: () => ['Shelter: Enloe High School (Five Points)', 'Protect: Capital Boulevard'] });
    records.push(r);
    const play1 = await r.recordPlay(play(1));
    await r.memosSent();
    await r.flush();
    expect(memos[0]).toBe(`ready-raleigh:v1:play:raleigh:flood:SOLO:score=41:${play1.fingerprint} | Shelter: Enloe High School (Five Points); Protect: Capital Boulevard`);
    const saved = (await store.play('play-1'))!;
    expect(saved.memo).toMatchObject({ status: 'confirmed', signature: 'sig1' });
    expect(saved.proof).not.toBeNull(); // the batch kept the memo, and the memo kept the batch
    expect(JSON.stringify(memos)).not.toMatch(/Ana|player-/);
  });

  it('keeps plays for the next batch when the transaction fails', async () => {
    const { r, store } = make(fakeChain(true).chain);
    await r.recordPlay(play(1));
    expect(await r.flush()).toMatchObject({ status: 'failed', error: 'blockhash not found' });
    expect(await store.unanchored(10)).toHaveLength(1);
  });

  it('fingerprints but never anchors with the chain off', async () => {
    const { r } = make(null);
    await r.recordPlay(play(1));
    expect(await r.flush()).toBeNull();
    expect((await r.proof('play-1'))!.anchor).toBeNull();
  });

  it('serves proofs over HTTP without the player id', async () => {
    const { chain } = fakeChain();
    const { r } = make(chain);
    const app = buildServer({ civic: r });
    await r.recordPlay(play(7));
    await r.flush();
    const res = await app.inject({ method: 'GET', url: '/api/solana/proof/play-7' });
    expect(res.statusCode).toBe(200);
    expect(res.json().play.playerId).toBeUndefined();
    expect(res.json().anchor.status).toBe('confirmed');
    expect((await app.inject({ method: 'GET', url: '/api/solana/proof/nope' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/solana/status' })).json()).toMatchObject({ enabled: true, cluster: 'devnet' });
    await app.close();
  });
});
