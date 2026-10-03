// The engine's view of the plan: score, per-cell coverage, and a preview of the piece under the
// pointer. Everything here comes from score() and the coverage functions in shared/.
import { useMemo } from 'react';
import { BUDGET } from '@shared/config';
import {
  PART_CAR,
  PART_NO_CAR,
  atRiskCells,
  engineIndex,
  placementCoverage,
  planCost,
  planState,
  protectedWeight,
  score,
} from '@shared/engine';
import type { Placement, Plan, ScoreResult } from '@shared/types';
import type { MapData } from '../data';
import { placementFor, targetProblem, usePlan } from './store';

export const soloPlan = (placements: Placement[]): Plan => ({
  roomCode: 'solo',
  playerId: 'solo',
  playerName: 'You',
  mode: 'flood',
  placements,
  spent: planCost(placements),
});

const atRiskCache = new WeakMap<MapData, number[]>();
export function floodAtRisk(data: MapData): number[] {
  let list = atRiskCache.get(data);
  if (!list) atRiskCache.set(data, (list = atRiskCells('flood', data)));
  return list;
}

/** Protected share (0..1) of each at-risk cell's weighted people, in floodAtRisk() order. */
function coverShares(data: MapData, placements: Placement[]): Float32Array {
  const idx = engineIndex(data);
  const state = planState({ mode: 'flood', placements }, idx);
  const m = idx.mode.flood;
  return Float32Array.from(floodAtRisk(data), (i) => {
    const w = m.partW[PART_CAR * idx.n + i]! + m.partW[PART_NO_CAR * idx.n + i]!;
    return w > 0 ? protectedWeight(idx, state, i) / w : 0;
  });
}

export interface Preview {
  /** The piece being placed or moved, at the hovered target. */
  piece: Placement;
  /** At-risk cells that piece reaches on its own. */
  cells: number[];
  result: ScoreResult;
  /** Residents covered, plan with the preview minus plan without it. */
  gain: number;
  /** Why the piece cannot go there, if it cannot. */
  problem: string | null;
}

export function usePlanScore(data: MapData | null) {
  const placements = usePlan((s) => s.placements);
  const hover = usePlan((s) => s.hover);
  const movingId = usePlan((s) => s.movingId);

  const result = useMemo(() => (data ? score(soloPlan(placements), data) : null), [data, placements]);
  const shares = useMemo(() => (data ? coverShares(data, placements) : new Float32Array()), [data, placements]);
  const spent = planCost(placements);

  const preview = useMemo((): Preview | null => {
    if (!data || !result || !hover) return null;
    const piece = placementFor(movingId ?? 'preview', hover);
    const problem = targetProblem(placements, hover, movingId);
    const cells = placementCoverage(piece, 'flood', data);
    if (problem) return { piece, cells, result, gain: 0, problem };
    const next = movingId ? placements.map((p) => (p.id === movingId ? piece : p)) : [...placements, piece];
    const res = score(soloPlan(next), data);
    return { piece, cells, result: res, gain: res.protectedPeople - result.protectedPeople, problem: null };
  }, [data, result, hover, movingId, placements]);

  return { placements, result, shares, preview, spent, left: BUDGET - spent };
}

/** Residents a placed piece adds: the plan's covered count with it minus without it. */
export function pieceGain(data: MapData, placements: Placement[], id: string): number {
  const all = score(soloPlan(placements), data).protectedPeople;
  const without = score(soloPlan(placements.filter((p) => p.id !== id)), data).protectedPeople;
  return all - without;
}
