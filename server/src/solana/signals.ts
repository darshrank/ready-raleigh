// Civic signals (docs/SOLANA.md, the "new or critical" layer): deterministic rules over the stored
// plays, evaluated after each play. AI never decides. A signal is published on Solana when it
// changes state (one Memo each), with the Merkle root of the plays behind it as evidence.
//   consensus   a spot enters the planner's "both" (residents and the data agree), with at least
//               CONSENSUS_MIN_PLAYERS different players behind it
//   blind_spot  one of the data's top BLIND_TOP spots that nobody has picked after BLIND_MIN_PLAYS
//               plays; it turns off when a play finally covers it (that play earns a card)
//   new_best    a play beats the best score so far (after NEW_BEST_MIN_PLAYS plays)
// The rules start from the state at boot without publishing it, so a restart never floods the chain.
import { randomUUID } from 'node:crypto';
import { canonicalJson, engineIndex, merkleTree, sha256Hex, signalMemo, type Mode } from '@shared';
import type { GameData } from '../data';
import type { PlayRecord, PlayStore } from '../db/store';
import { type PlannerResult, type PlannerSpot, rankPlanner } from '../planner';
import { type CivicLog, type CivicRecord, PLAY_CITY } from './civic';
import type { Signal, SignalType } from './store';

export const CONSENSUS_MIN_PLAYERS = 3;
export const BLIND_TOP = 3;
export const BLIND_MIN_PLAYS = 10;
export const NEW_BEST_MIN_PLAYS = 5;
/** A new best must beat the old one by this much (scores are 0..100). */
export const NEW_BEST_MARGIN = 0.5;

export interface Change {
  type: SignalType;
  spot: string;
  label: string;
  state: 'on' | 'off';
  evidence: Record<string, number | string>;
}

const spotLabel = (s: PlannerSpot) => (s.name && s.hood && !s.name.includes(s.hood) ? `${s.name} (${s.hood})` : s.name || s.hood);

/**
 * Which spot signals are on in this planner ranking, and what changed since `before`.
 * Keys are `<type>|<target>`. Consensus is only a candidate here: the player count is checked later.
 */
export function spotSignals(planner: PlannerResult, before: Set<string>): { on: Set<string>; changes: Change[]; spots: Map<string, PlannerSpot> } {
  const on = new Set<string>();
  const spots = new Map<string, PlannerSpot>();
  for (const s of planner.spots) {
    if (s.category === 'both') {
      on.add(`consensus|${s.target}`);
      spots.set(`consensus|${s.target}`, s);
    }
    if (planner.plays >= BLIND_MIN_PLAYS && s.dataRank !== null && s.dataRank <= BLIND_TOP) {
      spots.set(`blind_spot|${s.target}`, s);
      if (s.crowdPicks === 0) on.add(`blind_spot|${s.target}`);
    }
  }
  const changes: Change[] = [];
  const evidence = (s: PlannerSpot) => ({
    plays: planner.plays, crowdPicks: s.crowdPicks, crowdShare: Math.round(s.crowdShare * 1000) / 1000,
    dataRank: s.dataRank ?? 0, protectedPeople: Math.round(s.protectedPeople),
  });
  for (const key of on) {
    if (before.has(key)) continue;
    const s = spots.get(key)!;
    changes.push({ type: key.split('|')[0] as SignalType, spot: s.target, label: spotLabel(s), state: 'on', evidence: evidence(s) });
  }
  const ranked = new Map(planner.spots.map((s) => [s.target, s]));
  for (const key of before) {
    if (on.has(key)) continue;
    const s = ranked.get(key.slice(key.indexOf('|') + 1));
    // A spot that left the ranking entirely says nothing new; only a spot still ranked turns off.
    if (s) changes.push({ type: key.split('|')[0] as SignalType, spot: s.target, label: spotLabel(s), state: 'off', evidence: evidence(s) });
  }
  return { on, changes, spots };
}

export interface SignalOptions {
  plays: PlayStore;
  civic: CivicRecord;
  data: () => GameData | null;
  log: CivicLog;
  /** A play earned recognition for a signal (cards, step 4). */
  onAward?: (signal: Signal, play: { playId: string; playerId: string }) => void;
}

export function civicSignals({ plays, civic, data, log, onAward }: SignalOptions) {
  const state = new Map<Mode, Set<string>>();
  const best = new Map<Mode, number | null>();
  let queue: Promise<unknown> = Promise.resolve();

  function planner(mode: Mode, game: GameData, crowd: Awaited<ReturnType<PlayStore['crowd']>>) {
    return rankPlanner(mode, game.bundle, game.optimal(mode), game.extended(mode), crowd);
  }

  /** The state at boot (or on the first play): remembered, not published. */
  async function baseline(mode: Mode, game: GameData, skipPlay: PlayRecord) {
    if (state.has(mode)) return;
    const crowd = await plays.crowd(mode);
    const { on } = spotSignals(planner(mode, game, crowd), new Set());
    // Consensus counts only with enough different players, at boot as later.
    for (const key of [...on].filter((k) => k.startsWith('consensus|'))) {
      if (!(await enoughPlayers(mode, game, key.slice('consensus|'.length)))) on.delete(key);
    }
    state.set(mode, on);
    // The best before this play: the store already holds it, so recompute without it when it leads.
    const top = await plays.bestScore(mode);
    best.set(mode, top !== null && top <= skipPlay.score.score ? null : top);
  }

  /** Spot targets that count as the same spot (walk-in picks merge within one ring, like the planner). */
  function targetsOf(game: GameData, target: string): string[] {
    if (!target.startsWith('cell:')) return [target];
    return Array.from(engineIndex(game.bundle).disk(Number(target.slice(5)), 1), (c) => `cell:${c}`);
  }

  async function enoughPlayers(mode: Mode, game: GameData, target: string) {
    const pickers = await plays.pickers(mode, targetsOf(game, target), 200);
    return new Set(pickers.map((p) => p.playerId)).size >= CONSENSUS_MIN_PLAYERS;
  }

  async function publish(change: Change, mode: Mode, playIds: string[]): Promise<Signal> {
    const prints = (await Promise.all(playIds.map((id) => civic.store.play(id)))).flatMap((p) => (p ? [p.fingerprint] : []));
    const evidenceRoot = prints.length ? (await merkleTree(prints)).root : await sha256Hex(canonicalJson(change.evidence));
    const signal: Signal = {
      id: randomUUID(), city: PLAY_CITY, mode, ...change, playIds, evidenceRoot, anchorId: null, createdAt: new Date().toISOString(),
    };
    const anchor = await civic.anchorMemo('signal', PLAY_CITY, evidenceRoot, playIds.length,
      signalMemo(PLAY_CITY, `${mode}.${change.type}`, change.spot, change.state, evidenceRoot));
    signal.anchorId = anchor?.id ?? null;
    await civic.store.saveSignal(signal);
    log.info(`civic signal: ${change.type} ${change.state} at ${change.label}${anchor?.signature ? ` (${anchor.signature.slice(0, 12)}…)` : ''}`);
    return signal;
  }

  async function evaluate(record: PlayRecord) {
    // Signals are about one city's spots: plays from other city packs do not move them.
    if ((record.plan.city ?? 'raleigh') !== PLAY_CITY) return;
    const game = data();
    if (!game) return;
    const mode = record.plan.mode;
    await baseline(mode, game, record);
    const crowd = await plays.crowd(mode);
    const result = planner(mode, game, crowd);
    const before = state.get(mode)!;
    const { on, changes } = spotSignals(result, before);
    const trigger = { playId: record.id, playerId: record.plan.playerId };
    const mine = new Set(record.placements.map((p) => p.target));

    for (const change of changes) {
      const pickers = change.type === 'blind_spot' && change.state === 'on' ? [] : await plays.pickers(mode, targetsOf(game, change.spot), 50);
      if (change.type === 'consensus' && change.state === 'on' && new Set(pickers.map((p) => p.playerId)).size < CONSENSUS_MIN_PLAYERS) {
        on.delete(`consensus|${change.spot}`); // not enough different people yet: try again later
        continue;
      }
      const signal = await publish(change, mode, pickers.map((p) => p.playId));
      const caused = targetsOf(game, change.spot).some((t) => mine.has(t));
      // Pushing a spot into consensus, or covering a blind spot first, is the player's doing.
      if (caused && ((change.type === 'consensus' && change.state === 'on') || (change.type === 'blind_spot' && change.state === 'off'))) {
        onAward?.(signal, trigger);
      }
    }
    state.set(mode, on);

    const previous = best.get(mode) ?? null;
    if (record.score.score > (previous ?? -Infinity)) best.set(mode, record.score.score);
    if (previous !== null && crowd.plays >= NEW_BEST_MIN_PLAYS && record.score.score >= previous + NEW_BEST_MARGIN) {
      const signal = await publish({
        type: 'new_best', spot: 'city', label: 'Best plan so far', state: 'on',
        evidence: { score: Math.round(record.score.score * 10) / 10, previous: Math.round(previous * 10) / 10, plays: crowd.plays },
      }, mode, [record.id]);
      onAward?.(signal, trigger);
    }
  }

  /** Queues an evaluation after a play is recorded; never throws. */
  function onPlay(record: PlayRecord) {
    queue = queue.then(() => evaluate(record)).catch((err) => log.warn({ err }, 'civic signals: evaluation failed'));
    return queue;
  }

  return { onPlay, idle: () => queue };
}

export type CivicSignals = ReturnType<typeof civicSignals>;
