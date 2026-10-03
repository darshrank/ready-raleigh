// simTimeline(plan, data): what the flood simulation shows at each step.
//
// A cell joins the count when water reaches it; cut-off cells join at the final step (the data
// only says they are cut off by then). Each joining cell's people split into protected and
// stranded by the share of its weight the plan protects, the same share score() uses.
import { FINAL_FLOOD_STEP } from '../config';
import type { DataBundle } from '../data';
import type { Plan } from '../types';
import { PART_CAR, PART_NO_CAR, engineIndex } from './context';
import { planState, protectedWeight } from './coverage';
import { assertValidPlan } from './plan';

export interface TimelineStep {
  step: number;
  /** Every cell under water by this step. */
  flooded: number[];
  /** Cells that first flood at this step (to animate). */
  newlyFlooded: number[];
  /** Flood roads closed by this step; protected roads stay open. */
  closedRoadIds: string[];
  /** Flood roads that would have closed by this step but the plan keeps open. */
  heldRoadIds: string[];
  /** People affected so far who reach help, and who do not. */
  protectedPeople: number;
  strandedPeople: number;
  protectedWeighted: number;
  strandedWeighted: number;
}

export function simTimeline(plan: Plan, data: DataBundle): TimelineStep[] {
  if (plan.mode !== 'flood') throw new Error(`simTimeline is flood only, got a ${plan.mode} plan`);
  assertValidPlan(plan, data);
  const idx = engineIndex(data);
  const { n } = idx;
  const m = idx.mode.flood;
  const state = planState(plan, idx);
  const held = new Set(plan.placements.flatMap((p) => (p.type === 'road_protection' && p.roadId ? [p.roadId] : [])));

  const steps: TimelineStep[] = [];
  const flooded: number[] = [];
  let protectedPeople = 0;
  let strandedPeople = 0;
  let protectedWeighted = 0;
  let strandedWeighted = 0;
  const counted = new Uint8Array(n);
  for (let step = 1; step <= FINAL_FLOOD_STEP; step++) {
    const newlyFlooded: number[] = [];
    for (let i = 0; i < n; i++) {
      if (idx.floodStep[i] === step) newlyFlooded.push(i);
    }
    flooded.push(...newlyFlooded);
    const joining = step === FINAL_FLOOD_STEP ? allAtRisk(m.atRisk) : newlyFlooded;
    for (const i of joining) {
      if (counted[i] || !m.atRisk[i]) continue;
      counted[i] = 1;
      const w = m.partW[PART_CAR * n + i]! + m.partW[PART_NO_CAR * n + i]!;
      const pw = protectedWeight(idx, state, i);
      const share = w > 0 ? pw / w : 0;
      protectedWeighted += pw;
      strandedWeighted += w - pw;
      protectedPeople += idx.pop[i]! * m.riskShare[i]! * share;
      strandedPeople += idx.pop[i]! * m.riskShare[i]! * (1 - share);
    }
    const closing = data.floodRoads.filter((r) => r.floodStep <= step);
    steps.push({
      step,
      flooded: [...flooded],
      newlyFlooded,
      closedRoadIds: closing.filter((r) => !held.has(r.id)).map((r) => r.id),
      heldRoadIds: closing.filter((r) => held.has(r.id)).map((r) => r.id),
      protectedPeople,
      strandedPeople,
      protectedWeighted,
      strandedWeighted,
    });
  }
  return steps;
}

function allAtRisk(mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
  return out;
}
