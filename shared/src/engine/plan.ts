// Plan cost and validation. Cost always comes from the placements, never from `plan.spent`.
import { BUDGET, COSTS, MODE_INTERVENTIONS } from '../config';
import type { DataBundle } from '../data';
import type { Placement, Plan } from '../types';
import { engineIndex } from './context';

export function planCost(placements: Placement[]): number {
  let total = 0;
  for (const p of placements) total += COSTS[p.type];
  return total;
}

/** Thrown by score() and simTimeline() for a plan that breaks the rules. */
export class PlanError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid plan: ${problems.join('; ')}`);
    this.name = 'PlanError';
  }
}

/** Every rule the plan breaks, in plain words. Empty means valid. */
export function planProblems(plan: Plan, data: DataBundle, budget = BUDGET): string[] {
  const idx = engineIndex(data);
  const problems: string[] = [];
  const cost = planCost(plan.placements);
  if (cost > budget) problems.push(`over budget: $${cost.toLocaleString('en-US')} of $${budget.toLocaleString('en-US')}`);

  const allowed = MODE_INTERVENTIONS[plan.mode];
  const usedSites = new Set<string>();
  const usedRoads = new Set<string>();
  for (const p of plan.placements) {
    if (!allowed.includes(p.type)) {
      problems.push(`${p.id}: ${p.type} is not a ${plan.mode} intervention`);
      continue;
    }
    if (p.type === 'shelter') {
      if (p.siteId === undefined || !idx.sites.has(p.siteId)) problems.push(`${p.id}: unknown shelter site ${p.siteId}`);
      else if (usedSites.has(p.siteId)) problems.push(`${p.id}: site ${p.siteId} already has a shelter`);
      else usedSites.add(p.siteId);
    } else if (p.type === 'road_protection') {
      if (p.roadId === undefined || !idx.roads.has(p.roadId)) problems.push(`${p.id}: unknown road ${p.roadId}`);
      else if (usedRoads.has(p.roadId)) problems.push(`${p.id}: road ${p.roadId} is already protected`);
      else usedRoads.add(p.roadId);
    } else if (p.cell === undefined || !Number.isInteger(p.cell) || p.cell < 0 || p.cell >= idx.n) {
      problems.push(`${p.id}: ${p.type} needs a valid cell, got ${p.cell}`);
    }
  }
  return problems;
}

export function isValidPlan(plan: Plan, data: DataBundle, budget = BUDGET): boolean {
  return planProblems(plan, data, budget).length === 0;
}

export function assertValidPlan(plan: Plan, data: DataBundle, budget = BUDGET): void {
  const problems = planProblems(plan, data, budget);
  if (problems.length > 0) throw new PlanError(problems);
}
