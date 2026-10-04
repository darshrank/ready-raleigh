// The weak spot (a special power in planning): the flood-prone road whose protection keeps the
// most residents within reach of safety, given the plan so far. Same coverage model as score(),
// without the budget check or the optimizer, so every road can be tested at once (~1 ms each).
import type { DataBundle } from '../data';
import type { Placement, Plan } from '../types';
import { PART_CAR, PART_NO_CAR, engineIndex } from './context';
import { planState, protectedWeight } from './coverage';

export interface WeakSpot {
  roadId: string;
  /** Residents the road keeps in reach of safety if it is protected (people, as in score()). */
  people: number;
  /** The same gain in weighted people. */
  weighted: number;
}

/** The `n` unprotected flood roads that would protect the most people, best first. */
export function weakSpots(plan: Plan, data: DataBundle, n = 3): WeakSpot[] {
  const idx = engineIndex(data);
  const m = idx.mode.flood;
  const cells: number[] = [];
  for (let i = 0; i < idx.n; i++) if (m.atRisk[i]) cells.push(i);

  const totals = (p: Plan) => {
    const state = planState(p, idx);
    let weighted = 0;
    let people = 0;
    for (const i of cells) {
      const w = m.partW[PART_CAR * idx.n + i]! + m.partW[PART_NO_CAR * idx.n + i]!;
      const pw = protectedWeight(idx, state, i);
      weighted += pw;
      if (w > 0) people += ((idx.pop[i]! * m.riskShare[i]!) * pw) / w;
    }
    return { weighted, people };
  };

  const base = totals(plan);
  const taken = new Set(plan.placements.filter((p) => p.type === 'road_protection').map((p) => p.roadId));
  return data.floodRoads
    .filter((r) => !taken.has(r.id))
    .map((r) => {
      const probe: Placement = { id: `weak-spot-${r.id}`, type: 'road_protection', roadId: r.id };
      const t = totals({ ...plan, placements: [...plan.placements, probe] });
      return { roadId: r.id, people: t.people - base.people, weighted: t.weighted - base.weighted };
    })
    .filter((s) => s.weighted > 1e-9)
    .sort((a, b) => b.weighted - a.weighted || a.roadId.localeCompare(b.roadId))
    .slice(0, n);
}
