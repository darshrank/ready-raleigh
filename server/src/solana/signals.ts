// Civic signals (docs/SOLANA.md, the "new or critical" layer): deterministic rules over the stored
// plays, evaluated after each play. AI never decides. A signal is published on Solana when it
// changes state (one Memo each), with the Merkle root of the plays behind it as evidence.
//   consensus   a spot enters the planner's "both" (residents and the data agree), with at least
//               CONSENSUS_MIN_PLAYERS different players behind it
//   blind_spot  one of the data's top BLIND_TOP spots that nobody has picked after BLIND_MIN_PLAYS
//               plays; it turns off when a play finally covers it (that play earns a card)
//   new_best    a play beats the best score so far (after NEW_BEST_MIN_PLAYS plays)
// Every city has its own spots, so the rules run per city and mode on that city's data and crowd,
// and each memo names the city. The rules start from what was last published, so the record on
// chain is a true history of changes across restarts.
import { randomUUID } from 'node:crypto';
import { type CityId, canonicalJson, engineIndex, isCityId, merkleTree, sha256Hex, signalMemo, type Mode } from '@shared';
import type { GameData } from '../data';
import type { PlayRecord, PlayStore } from '../db/store';
import { type PlannerResult, type PlannerSpot, rankPlanner } from '../planner';
import type { CivicLog, CivicRecord } from './civic';
import type { Signal, SignalType } from './store';

export const CONSENSUS_MIN_PLAYERS = 3;
export const BLIND_TOP = 3;
export const BLIND_MIN_PLAYS = 10;
export const NEW_BEST_MIN_PLAYS = 5;
/** A new best must beat the old one by this much (scores are 0..100). */
export const NEW_BEST_MARGIN = 0.5;
/** How many published signals the boot state is read from (newest first). */
const PUBLISHED_HISTORY = 2000;

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
  /** Game data per city (null when a city pack is missing: its plays move no signals). */
  data: (city?: CityId) => GameData | null;
  log: CivicLog;
  /** A play earned recognition for a signal (cards, step 4). */
  onAward?: (signal: Signal, play: { playId: string; playerId: string }) => void;
}

export function civicSignals({ plays, civic, data, log, onAward }: SignalOptions) {
  /** Rule state and best score per city and mode (`<city>|<mode>`): each city has its own spots. */
  const state = new Map<string, Set<string>>();
  const best = new Map<string, number | null>();
  let queue: Promise<unknown> = Promise.resolve();

  /** One evaluation's scope: a city's data and a mode. */
  interface Scope {
    city: CityId;
    mode: Mode;
    game: GameData;
    key: string;
  }

  const planner = ({ mode, game }: Scope, crowd: Awaited<ReturnType<PlayStore['crowd']>>) =>
    rankPlanner(mode, game.bundle, game.optimal(mode), game.extended(mode), crowd);

  /**
   * Where the rules start (boot, or a city's first play): the state as published, i.e. each spot's
   * latest signal on record. The chain then only ever says what changed against what it already said;
   * something true but never published is published on the next play.
   */
  async function baseline(scope: Scope, skipPlay: PlayRecord) {
    if (state.has(scope.key)) return;
    const latest = new Map<string, 'on' | 'off'>();
    for (const s of await civic.store.signals(PUBLISHED_HISTORY)) {
      if (s.city !== scope.city || s.mode !== scope.mode || s.type === 'new_best') continue;
      const key = `${s.type}|${s.spot}`;
      if (!latest.has(key)) latest.set(key, s.state); // newest first
    }
    state.set(scope.key, new Set([...latest].filter(([, st]) => st === 'on').map(([key]) => key)));
    // The best before this play: the store already holds it, so recompute without it when it leads.
    const top = await plays.bestScore(scope.mode, scope.city);
    best.set(scope.key, top !== null && top <= skipPlay.score.score ? null : top);
  }

  /** Spot targets that count as the same spot (walk-in picks merge within one ring, like the planner). */
  function targetsOf(game: GameData, target: string): string[] {
    if (!target.startsWith('cell:')) return [target];
    return Array.from(engineIndex(game.bundle).disk(Number(target.slice(5)), 1), (c) => `cell:${c}`);
  }

  const pickersOf = (scope: Scope, target: string, limit: number) => plays.pickers(scope.mode, targetsOf(scope.game, target), limit, scope.city);


  async function publish({ city, mode }: Scope, change: Change, playIds: string[]): Promise<Signal> {
    const prints = (await Promise.all(playIds.map((id) => civic.store.play(id)))).flatMap((p) => (p ? [p.fingerprint] : []));
    const evidenceRoot = prints.length ? (await merkleTree(prints)).root : await sha256Hex(canonicalJson(change.evidence));
    const signal: Signal = {
      id: randomUUID(), city, mode, ...change, playIds, evidenceRoot, anchorId: null, createdAt: new Date().toISOString(),
    };
    const anchor = await civic.anchorMemo('signal', city, evidenceRoot, playIds.length,
      signalMemo(city, `${mode}.${change.type}`, change.spot, change.state, evidenceRoot));
    signal.anchorId = anchor?.id ?? null;
    await civic.store.saveSignal(signal);
    log.info(`civic signal (${city}): ${change.type} ${change.state} at ${change.label}${anchor?.signature ? ` (${anchor.signature.slice(0, 12)}…)` : ''}`);
    return signal;
  }

  async function evaluate(record: PlayRecord) {
    // Each city's plays move only that city's signals, on that city's data.
    const city: CityId = isCityId(record.plan.city) ? record.plan.city : 'raleigh';
    const game = data(city);
    if (!game) return;
    const mode = record.plan.mode;
    const scope: Scope = { city, mode, game, key: `${city}|${mode}` };
    await baseline(scope, record);
    const crowd = await plays.crowd(mode, city);
    const result = planner(scope, crowd);
    const before = state.get(scope.key)!;
    const { on, changes } = spotSignals(result, before);
    const trigger = { playId: record.id, playerId: record.plan.playerId };
    const mine = new Set(record.placements.map((p) => p.target));

    for (const change of changes) {
      const pickers = change.type === 'blind_spot' && change.state === 'on' ? [] : await pickersOf(scope, change.spot, 50);
      if (change.type === 'consensus' && change.state === 'on' && new Set(pickers.map((p) => p.playerId)).size < CONSENSUS_MIN_PLAYERS) {
        on.delete(`consensus|${change.spot}`); // not enough different people yet: try again later
        continue;
      }
      const signal = await publish(scope, change, pickers.map((p) => p.playId));
      const caused = targetsOf(game, change.spot).some((t) => mine.has(t));
      // Pushing a spot into consensus, or covering a blind spot first, is the player's doing.
      if (caused && ((change.type === 'consensus' && change.state === 'on') || (change.type === 'blind_spot' && change.state === 'off'))) {
        onAward?.(signal, trigger);
      }
    }
    state.set(scope.key, on);

    const previous = best.get(scope.key) ?? null;
    if (record.score.score > (previous ?? -Infinity)) best.set(scope.key, record.score.score);
    if (previous !== null && crowd.plays >= NEW_BEST_MIN_PLAYS && record.score.score >= previous + NEW_BEST_MARGIN) {
      const signal = await publish(scope, {
        type: 'new_best', spot: 'city', label: 'Best plan so far', state: 'on',
        evidence: { score: Math.round(record.score.score * 10) / 10, previous: Math.round(previous * 10) / 10, plays: crowd.plays },
      }, [record.id]);
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
