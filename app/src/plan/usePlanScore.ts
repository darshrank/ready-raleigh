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
  protectorOf,
  score,
} from '@shared/engine';
import type { Placement, Plan, ScoreResult } from '@shared/types';
import type { MapData } from '../data';
import type { Link } from './layers';
import { placementFor, targetOf, targetProblem, usePlan } from './store';
import { anchorOf } from './targets';

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

/**
 * Bus pickup -> shelter lines: one per pair where the engine seats riders from that pickup, to a
 * placed or an existing shelter. Empty for an invalid plan.
 */
export function busLinks(data: MapData, placements: Placement[]): Link[] {
  if (!placements.some((p) => p.type === 'bus_pickup')) return [];
  let sources;
  try {
    sources = protectorOf(soloPlan(placements), data);
  } catch {
    return [];
  }
  const idx = engineIndex(data);
  const seen = new Map<string, Link>();
  for (const list of sources.values()) {
    for (const s of list) {
      if (!s.via || s.placement.siteId === undefined) continue;
      const key = `${s.via.id}|${s.placement.siteId}`;
      if (seen.has(key)) continue;
      const t = targetOf(s.via);
      const from = t && anchorOf(data, t);
      const site = idx.shelterSites.get(s.placement.siteId);
      if (from && site) seen.set(key, { from, to: [site.lon, site.lat] });
    }
  }
  return [...seen.values()];
}

export interface Preview {
  /** The piece being placed or moved, at the hovered target. */
  piece: Placement;
  /** At-risk cells that piece reaches on its own. */
  cells: number[];
  result: ScoreResult;
  /** Residents the piece covers at this spot: the plan with it minus the plan without it (never negative). */
  gain: number;
  /** Why the piece cannot go there, if it cannot. */
  problem: string | null;
  /** Bus pickup -> shelter lines with the piece in place. */
  links: Link[];
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
    if (problem) return { piece, cells, result, gain: 0, problem, links: [] };
    const next = movingId ? placements.map((p) => (p.id === movingId ? piece : p)) : [...placements, piece];
    const res = score(soloPlan(next), data);
    const links = piece.type === 'bus_pickup' || piece.type === 'shelter' ? busLinks(data, next) : [];
    // What the piece covers at this spot, with the rest of the plan as it is. A moved piece is
    // compared with the plan without it, not with its old spot (that difference can be negative).
    const without = movingId ? score(soloPlan(placements.filter((p) => p.id !== movingId)), data).protectedPeople : result.protectedPeople;
    return { piece, cells, result: res, gain: Math.max(0, res.protectedPeople - without), problem: null, links };
  }, [data, result, hover, movingId, placements]);
  const links = useMemo(() => (data ? busLinks(data, placements) : []), [data, placements]);

  return { placements, result, shares, preview, links, spent, left: BUDGET - spent };
}

/** Residents a placed piece adds: the plan's covered count with it minus without it. */
export function pieceGain(data: MapData, placements: Placement[], id: string): number {
  const all = score(soloPlan(placements), data).protectedPeople;
  const without = score(soloPlan(placements.filter((p) => p.id !== id)), data).protectedPeople;
  return all - without;
}
