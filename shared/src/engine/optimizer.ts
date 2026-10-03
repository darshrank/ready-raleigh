// Budgeted max coverage: pick placements that protect the most weighted people within budget.
//
// Flood uses eager greedy because capacity reassignment invalidates lazy marginal-gain bounds.
// Heat retains CELF lazy greedy (a heuristic for tree synergies). Both compare gain-per-dollar,
// pure-gain greedy and the best single placement; this is a baseline, not a proven global optimum.
import { BUDGET, COSTS, MODE_INTERVENTIONS } from '../config';
import type { DataBundle } from '../data';
import type { Mode, Placement, Plan } from '../types';
import { type EngineIndex, PART_CAR, PART_NO_CAR, engineIndex } from './context';
import { type Effect, applyEffect, emptyState, marginalGain, placementEffect } from './coverage';

export interface Candidate {
  placement: Omit<Placement, 'id'>;
  cost: number;
  eff: Effect;
}

/** Every placement that protects someone in this mode: usable sites, roads, and useful cells. */
export function candidates(mode: Mode, data: DataBundle): Candidate[] {
  const idx = engineIndex(data);
  const empty = emptyState(mode, idx);
  const out: Candidate[] = [];
  const push = (placement: Omit<Placement, 'id'>) => {
    const eff = placementEffect({ id: '', ...placement }, idx);
    if (eff && marginalGain(idx, empty, eff) > 0) out.push({ placement, cost: COSTS[placement.type], eff });
  };
  for (const type of MODE_INTERVENTIONS[mode]) {
    if (type === 'shelter') for (const s of data.sites) push({ type, siteId: s.id });
    else if (type === 'road_protection') for (const r of data.floodRoads) push({ type, roadId: r.id });
    else for (const cell of usefulCells(mode, idx)) push({ type, cell });
  }
  return out;
}

/** Cells within 2 rings of an at-risk cell: the only places a walk-in or tree placement helps. */
function usefulCells(mode: Mode, idx: EngineIndex): number[] {
  const m = idx.mode[mode];
  const seen = new Uint8Array(idx.n);
  for (let i = 0; i < idx.n; i++) {
    const w = m.partW[PART_CAR * idx.n + i]! + m.partW[PART_NO_CAR * idx.n + i]!;
    if (m.atRisk[i] && w > 0) for (const j of idx.disk(i, 2)) seen[j] = 1;
  }
  const out: number[] = [];
  for (let i = 0; i < idx.n; i++) if (seen[i]) out.push(i);
  return out;
}

export interface OptimizeResult {
  plan: Plan;
  protectedWeighted: number;
  /** Candidate placements considered and marginal gains computed, for logs. */
  stats: { candidates: number; evaluations: number };
}

const cache = new WeakMap<DataBundle, Map<string, OptimizeResult>>();

export function optimize(mode: Mode, data: DataBundle, budget = BUDGET): OptimizeResult {
  if (!Number.isFinite(budget) || budget < 0) throw new Error('Budget must be finite and nonnegative');
  let memo = cache.get(data);
  if (!memo) { memo = new Map(); cache.set(data, memo); }
  const cacheKey = `${mode}:${budget}`;
  const cached = memo.get(cacheKey);
  if (cached) return cached;
  const idx = engineIndex(data);
  const cands = candidates(mode, data);
  let evaluations = 0;

  const greedy = (byRatio: boolean): { picks: number[]; gain: number } => {
    const state = emptyState(mode, idx);
    // Capacity reassignment can increase a marginal gain; CELF's stale bounds are not valid.
    if (mode === 'flood') {
      const picks: number[] = [];
      let spent = 0, gain = 0;
      const used = new Set<number>();
      while (true) {
        let best = -1, bestKey = 0, bestGain = 0;
        cands.forEach((c, k) => {
          if (used.has(k) || c.cost > budget - spent) return;
          const g = marginalGain(idx, state, c.eff);
          evaluations++;
          const key = byRatio ? g / c.cost : g;
          if (key > bestKey) { best = k; bestKey = key; bestGain = g; }
        });
        if (best < 0) break;
        const c = cands[best]!;
        applyEffect(state, c.eff, idx.n);
        picks.push(best); used.add(best); spent += c.cost; gain += bestGain;
      }
      return { picks, gain };
    }
    const heap = new MaxHeap();
    cands.forEach((c, k) => {
      if (c.cost > budget) return;
      const g = marginalGain(idx, state, c.eff);
      evaluations++;
      if (g > 0) heap.push({ k, key: byRatio ? g / c.cost : g, round: 0 });
    });
    const picks: number[] = [];
    let spent = 0;
    let total = 0;
    let round = 0;
    for (let top = heap.pop(); top; top = heap.pop()) {
      const c = cands[top.k]!;
      if (c.cost > budget - spent) continue; // budget only shrinks, so drop it for good
      if (top.round !== round) {
        const g = marginalGain(idx, state, c.eff);
        evaluations++;
        if (g > 0) heap.push({ k: top.k, key: byRatio ? g / c.cost : g, round });
        continue;
      }
      const g = marginalGain(idx, state, c.eff);
      applyEffect(state, c.eff, idx.n);
      picks.push(top.k);
      spent += c.cost;
      total += g;
      round++;
    }
    return { picks, gain: total };
  };

  let best = greedy(true);
  const byGain = greedy(false);
  if (byGain.gain > best.gain) best = byGain;
  const empty = emptyState(mode, idx);
  cands.forEach((c, k) => {
    if (c.cost > budget) return;
    const g = marginalGain(idx, empty, c.eff);
    if (g > best.gain) best = { picks: [k], gain: g };
  });

  const placements: Placement[] = best.picks.map((k, n) => ({ id: `opt-${n + 1}`, ...cands[k]!.placement }));
  const spent = best.picks.reduce((s, k) => s + cands[k]!.cost, 0);
  const result: OptimizeResult = {
    plan: { roomCode: 'optimal', playerId: 'optimizer', playerName: 'Optimizer', mode, placements, spent },
    protectedWeighted: best.gain,
    stats: { candidates: cands.length, evaluations },
  };
  memo.set(cacheKey, result);
  return result;
}

interface HeapItem {
  k: number;
  key: number;
  round: number;
}

/** Binary max-heap on `key`; ties go to the lower candidate index so runs are deterministic. */
class MaxHeap {
  private a: HeapItem[] = [];
  private above(x: HeapItem, y: HeapItem) {
    return x.key > y.key || (x.key === y.key && x.k < y.k);
  }
  push(item: HeapItem) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.above(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): HeapItem | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.above(a[l]!, a[m]!)) m = l;
        if (r < a.length && this.above(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}
