// The civic record's completeness layer (docs/SOLANA.md): every stored play gets a fingerprint;
// plays are anchored in batches (a room's election when it ends, solo plays every few minutes) as
// one Memo transaction carrying the Merkle root; each play keeps its proof. Fail soft: nothing here
// ever blocks a game, and a failed transaction leaves the plays for the next batch.
import { randomUUID } from 'node:crypto';
import { merkleTree, playFingerprint, playMemo, playsMemo } from '@shared';
import type { PlayRecord } from '../db/store';
import { type Chain, explorerTx } from './chain';
import type { Anchor, CivicStore, PlayProof } from './store';

/** The city whose spots the civic signals follow (signals.ts); plays from every city are recorded. */
export const PLAY_CITY = 'raleigh';
/** The city a play was scored in (Plan.city; older plans have none and are Raleigh). */
export const playCity = (record: PlayRecord) => record.plan.city ?? 'raleigh';
const MAX_BATCH = 512;

export interface CivicLog {
  info(msg: string): void;
  warn(obj: unknown, msg: string): void;
}

export interface CivicOptions {
  store: CivicStore;
  /** Null when the chain is off: plays still get fingerprints, nothing is anchored. */
  chain: Chain | null;
  /** The data build a city's plays are scored on (meta.json buildDate). */
  dataBuild: (city: string) => string;
  log: CivicLog;
  /** How often waiting solo plays are anchored. */
  batchMs?: number;
  /** The play's decisions in words, for its own memo (decisions.ts). */
  describe?: (record: PlayRecord) => string[];
}

export interface ProofView {
  play: PlayProof;
  anchor: (Anchor & { explorerUrl: string | null }) | null;
}

export const withExplorer = (a: Anchor) => ({ ...a, explorerUrl: a.signature ? explorerTx(a.signature) : null });

export function civicRecord({ store, chain, dataBuild, log, batchMs = 5 * 60_000, describe }: CivicOptions) {
  let flushing: Promise<Anchor | null> = Promise.resolve(null);
  const listeners: ((record: PlayRecord, play: PlayProof) => void)[] = [];
  let sending: Promise<unknown> = Promise.resolve();

  /** Writes a play's decisions to Solana in its own memo. One at a time; never throws. */
  function sendPlayMemo(play: PlayProof, record: PlayRecord): Promise<unknown> {
    if (!chain) return Promise.resolve();
    const text = playMemo(play.input, play.fingerprint, describe?.(record) ?? []);
    sending = sending.then(async () => {
      let memo: NonNullable<PlayProof['memo']>;
      try {
        memo = { text, status: 'confirmed', ...(await chain.memo(text)) };
      } catch (err) {
        memo = { text, status: 'failed', signature: null, slot: null, error: (err as Error).message.slice(0, 200) };
        log.warn({ err: memo.error }, `civic: play ${play.playId.slice(0, 8)} decisions not written to Solana`);
      }
      // Re-read: the batch may have added the proof meanwhile.
      const latest = (await store.play(play.playId)) ?? play;
      await store.savePlay({ ...latest, memo });
    }).catch((err) => log.warn({ err }, 'civic: play memo failed'));
    return sending;
  }

  /** Fingerprints a stored play. The anchoring comes later (flush). */
  async function recordPlay(record: PlayRecord): Promise<PlayProof> {
    const input = {
      playId: record.id,
      city: playCity(record),
      mode: record.plan.mode,
      roomCode: record.plan.roomCode,
      createdAt: record.createdAt.toISOString(),
      dataBuild: dataBuild(playCity(record)),
      placements: record.plan.placements.map(({ type, cell, siteId, roadId, stopId }) => ({ type, cell, siteId, roadId, stopId })),
      score: record.score.score,
    };
    const play: PlayProof = { playId: record.id, playerId: record.plan.playerId, input, fingerprint: await playFingerprint(input), anchorId: null, proof: null };
    await store.savePlay(play);
    void sendPlayMemo(play, record);
    for (const fn of listeners) fn(record, play);
    return play;
  }

  /** Writes one memo (a civic signal) and records it as an anchor; null when the chain is off. */
  async function anchorMemo(kind: Anchor['kind'], city: string, root: string, count: number, memo: string): Promise<Anchor | null> {
    if (!chain) return null;
    const anchor: Anchor = { id: randomUUID(), kind, city, createdAt: new Date().toISOString(), root, count, memo, status: 'pending', signature: null, slot: null };
    try {
      Object.assign(anchor, { status: 'confirmed' }, await chain.memo(memo));
    } catch (err) {
      anchor.status = 'failed';
      anchor.error = (err as Error).message.slice(0, 200);
      log.warn({ err: anchor.error }, `civic: memo failed (${memo.slice(0, 60)})`);
    }
    await store.saveAnchor(anchor);
    return anchor;
  }

  async function anchorWaiting(): Promise<Anchor | null> {
    if (!chain) return null;
    const plays = await store.unanchored(MAX_BATCH);
    if (plays.length === 0) return null;
    // One batch is one city on one data build (both are in its memo).
    const { city, dataBuild: build } = plays[0]!.input;
    const batch = plays.filter((p) => p.input.dataBuild === build && p.input.city === city);
    const { root, proofs } = await merkleTree(batch.map((p) => p.fingerprint));
    const anchor: Anchor = {
      id: randomUUID(), kind: 'plays', city, createdAt: new Date().toISOString(), root, count: batch.length,
      memo: playsMemo(city, root, batch.length, build), status: 'pending', signature: null, slot: null,
    };
    try {
      const { signature, slot } = await chain.memo(anchor.memo);
      Object.assign(anchor, { status: 'confirmed', signature, slot });
    } catch (err) {
      anchor.status = 'failed';
      anchor.error = (err as Error).message.slice(0, 200);
      await store.saveAnchor(anchor);
      log.warn({ err: anchor.error }, `civic: anchoring ${batch.length} plays failed; they wait for the next batch`);
      return anchor;
    }
    await store.saveAnchor(anchor);
    // Re-read each play: its own memo may have landed since the batch was read.
    await Promise.all(batch.map(async (p, i) => store.savePlay({ ...((await store.play(p.playId)) ?? p), anchorId: anchor.id, proof: proofs[i]! })));
    log.info(`civic: anchored ${batch.length} plays on Solana ${explorerTx(anchor.signature!)}`);
    return anchor;
  }

  /**
   * Anchors every play waiting, one batch (city and data build) at a time; stops at a failure.
   * Resolves to the last anchor. Calls queue behind each other.
   */
  async function anchorAll(): Promise<Anchor | null> {
    let last: Anchor | null = null;
    for (let i = 0; i < 8; i++) {
      const anchor = await anchorWaiting();
      if (!anchor) break;
      last = anchor;
      if (anchor.status !== 'confirmed') break;
    }
    return last;
  }

  function flush(): Promise<Anchor | null> {
    flushing = flushing.catch(() => null).then(anchorAll).catch((err) => {
      log.warn({ err }, 'civic: flush failed');
      return null;
    });
    return flushing;
  }

  const timer = setInterval(() => void flush(), batchMs);
  timer.unref();

  async function proof(playId: string): Promise<ProofView | null> {
    const play = await store.play(playId);
    if (!play) return null;
    const anchor = play.anchorId ? await store.anchor(play.anchorId) : null;
    return { play, anchor: anchor ? withExplorer(anchor) : null };
  }

  return {
    enabled: chain !== null,
    address: chain?.address ?? null,
    store,
    recordPlay,
    /** Called after each play is fingerprinted (civic signals listen here). */
    onRecorded: (fn: (record: PlayRecord, play: PlayProof) => void) => void listeners.push(fn),
    anchorMemo,
    flush,
    proof,
    /** Resolves when every play memo queued so far is written (tests, shutdown). */
    memosSent: () => sending,
    close: () => clearInterval(timer),
  };
}

export type CivicRecord = ReturnType<typeof civicRecord>;
