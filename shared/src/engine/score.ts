// score(plan, data): share of at-risk weighted people the plan protects, with the breakdowns the
// results screen and the AI debrief need.
import { SHELTER_DRIVE_LIMIT_S } from '../config';
import type { DataBundle } from '../data';
import type { Plan, ScoreResult } from '../types';
import { type EngineIndex, PART_CAR, PART_NO_CAR, engineIndex } from './context';
import { type CoverState, planState, protectedWeight, siteUsable } from './coverage';
import { assertValidPlan } from './plan';

const TOP_MISSES = 5;

/** Scores a valid plan. Throws PlanError if the plan is over budget or references bad ids. */
export function score(plan: Plan, data: DataBundle): ScoreResult {
  assertValidPlan(plan, data);
  const idx = engineIndex(data);
  return summarize(plan, idx, planState(plan, idx));
}

export function summarize(plan: Plan, idx: EngineIndex, state: CoverState): ScoreResult {
  const { n } = idx;
  const m = idx.mode[plan.mode];
  const hoodRisk = new Float64Array(idx.hoods.length);
  const hoodProt = new Float64Array(idx.hoods.length);
  let atRiskW = 0;
  let protW = 0;
  let atRiskPeople = 0;
  let protPeople = 0;
  let atRiskVuln = 0;
  let protVuln = 0;
  const misses: { cell: number; weighted: number }[] = [];

  for (let i = 0; i < n; i++) {
    if (!m.atRisk[i]) continue;
    const w = m.partW[PART_CAR * n + i]! + m.partW[PART_NO_CAR * n + i]!;
    const pw = protectedWeight(idx, state, i);
    // People and the vulnerable count follow the protected share of the cell's weight.
    const share = w > 0 ? pw / w : 0;
    atRiskW += w;
    protW += pw;
    atRiskPeople += idx.pop[i]!;
    protPeople += idx.pop[i]! * share;
    atRiskVuln += idx.vulnW[i]!;
    protVuln += idx.vulnW[i]! * share;
    const h = idx.hoodOf[i]!;
    hoodRisk[h]! += w;
    hoodProt[h]! += pw;

    const missed = w - pw;
    if (missed > 1e-9 && (misses.length < TOP_MISSES || missed > misses[misses.length - 1]!.weighted)) {
      misses.push({ cell: i, weighted: missed });
      misses.sort((a, b) => b.weighted - a.weighted || a.cell - b.cell);
      if (misses.length > TOP_MISSES) misses.pop();
    }
  }

  const byHood: ScoreResult['byHood'] = [];
  idx.hoods.forEach((hood, h) => {
    if (hoodRisk[h]! > 0) byHood.push({ hood, atRisk: hoodRisk[h]!, protected: hoodProt[h]! });
  });
  byHood.sort((a, b) => b.atRisk - a.atRisk || a.hood.localeCompare(b.hood));

  const pct = (part: number, whole: number) => (whole > 0 ? (100 * part) / whole : 100);
  return {
    score: pct(protW, atRiskW),
    atRiskWeighted: atRiskW,
    protectedWeighted: protW,
    protectedPeople: protPeople,
    strandedPeople: atRiskPeople - protPeople,
    vulnerable: { protectedPct: pct(protVuln, atRiskVuln), everyonePct: pct(protPeople, atRiskPeople) },
    byHood,
    topMisses: misses.map(({ cell, weighted }) => ({
      cell,
      hood: idx.hoods[idx.hoodOf[cell]!]!,
      reason: missReason(plan, idx, state, cell),
      weighted,
    })),
  };
}

const DRIVE_MIN = Math.round(SHELTER_DRIVE_LIMIT_S / 60);

/** Plain-words reason a cell is not (fully) protected. */
export function missReason(plan: Plan, idx: EngineIndex, state: CoverState, i: number): string {
  const { n } = idx;
  const m = idx.mode[plan.mode];
  if (plan.mode === 'heat') {
    const cover = state.cover[PART_CAR * n + i]!;
    if (cover > 0) return 'only a water station nearby; no cooling center within a short walk';
    return 'hot block with no cooling center, water station or new trees nearby';
  }
  const reasons: string[] = [];
  if (m.partW[PART_CAR * n + i]! > 0 && state.cover[PART_CAR * n + i]! < 1) {
    if (floodedShelterWouldCover(plan, idx, i)) reasons.push(`the nearest shelter floods; no working shelter within ${DRIVE_MIN} minutes`);
    else if (idx.floodStep[i] === 0) reasons.push(`cut off from hospitals; no protected road or shelter within ${DRIVE_MIN} minutes`);
    else reasons.push(`no shelter within ${DRIVE_MIN} minutes`);
  }
  if (m.partW[PART_NO_CAR * n + i]! > 0 && state.cover[PART_NO_CAR * n + i]! < 1) {
    reasons.push('households with no car and no bus pickup nearby');
  }
  return reasons.join('; ');
}

function floodedShelterWouldCover(plan: Plan, idx: EngineIndex, i: number): boolean {
  for (const p of plan.placements) {
    if (p.type !== 'shelter' || p.siteId === undefined) continue;
    const site = idx.sites.get(p.siteId);
    if (site && !siteUsable(site) && site.coverDry.includes(i)) return true;
  }
  return false;
}
