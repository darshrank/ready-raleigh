// The civic record's completeness layer (docs/SOLANA.md): every stored play gets a fingerprint;
// plays are anchored in batches (a room's election when it ends, solo plays every few minutes) as
// one Memo transaction carrying the Merkle root; each play keeps its proof. Fail soft: nothing here
// ever blocks a game, and a failed transaction leaves the plays for the next batch.
import { randomUUID } from 'node:crypto';
import { merkleTree, playFingerprint, playsMemo } from '@shared';
import type { PlayRecord } from '../db/store';
import { type Chain, explorerTx } from './chain';
import type { Anchor, CivicStore, PlayProof } from './store';

/** Server-scored plays are scored on Raleigh's data (rooms are Raleigh; see SOLANA.md for cities). */
export const PLAY_CITY = 'raleigh';
const MAX_BATCH = 512;

export interface CivicLog {
  info(msg: string): void;
  warn(obj: unknown, msg: string): void;
}

export interface CivicOptions {
  store: CivicStore;
  /** Null when the chain is off: plays still get fingerprints, nothing is anchored. */
  chain: Chain | null;
  /** The data build the server scores on (meta.json buildDate). */
  dataBuild: () => string;
  log: CivicLog;
  /** How often waiting solo plays are anchored. */
  batchMs?: number;
}

export interface ProofView {
  play: PlayProof;
  anchor: (Anchor & { explorerUrl: string | null }) | null;
}

export const withExplorer = (a: Anchor) => ({ ...a, explorerUrl: a.signature ? explorerTx(a.signature) : null });

export function civicRecord({ store, chain, dataBuild, log, batchMs = 5 * 60_000 }: CivicOptions) {
  let flushing: Promise<Anchor | null> = Promise.resolve(null);

  /** Fingerprints a stored play. The anchoring comes later (flush). */
  async function recordPlay(record: PlayRecord): Promise<PlayProof> {
    const input = {
      playId: record.id,
      city: PLAY_CITY,
      mode: record.plan.mode,
      roomCode: record.plan.roomCode,
      createdAt: record.createdAt.toISOString(),
      dataBuild: dataBuild(),
      placements: record.plan.placements.map(({ type, cell, siteId, roadId, stopId }) => ({ type, cell, siteId, roadId, stopId })),
      score: record.score.score,
    };
    const play: PlayProof = { playId: record.id, playerId: record.plan.playerId, input, fingerprint: await playFingerprint(input), anchorId: null, proof: null };
    await store.savePlay(play);
    return play;
  }

  async function anchorWaiting(): Promise<Anchor | null> {
    if (!chain) return null;
    const plays = await store.unanchored(MAX_BATCH);
    if (plays.length === 0) return null;
    const build = plays[0]!.input.dataBuild;
    const batch = plays.filter((p) => p.input.dataBuild === build);
    const { root, proofs } = await merkleTree(batch.map((p) => p.fingerprint));
    const anchor: Anchor = {
      id: randomUUID(), kind: 'plays', city: PLAY_CITY, createdAt: new Date().toISOString(), root, count: batch.length,
      memo: playsMemo(PLAY_CITY, root, batch.length, build), status: 'pending', signature: null, slot: null,
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
    await Promise.all(batch.map((p, i) => store.savePlay({ ...p, anchorId: anchor.id, proof: proofs[i]! })));
    log.info(`civic: anchored ${batch.length} plays on Solana ${explorerTx(anchor.signature!)}`);
    return anchor;
  }

  /** Anchors every play waiting, one batch at a time (calls queue behind each other). */
  function flush(): Promise<Anchor | null> {
    flushing = flushing.catch(() => null).then(anchorWaiting).catch((err) => {
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
    flush,
    proof,
    close: () => clearInterval(timer),
  };
}

export type CivicRecord = ReturnType<typeof civicRecord>;
