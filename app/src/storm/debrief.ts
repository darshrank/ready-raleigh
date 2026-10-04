// The results' debrief: the facts sent to POST /api/debrief (Gemini writes the summary), and the
// template summary the page shows when Gemini is off or its answer was refused. Every number here
// comes from the engine's score; Gemini only phrases them (shared/src/debrief.ts).
import { BUDGET } from '@shared/config';
import { DEBRIEF_MAX_CHARS, type DebriefFacts } from '@shared/debrief';
import { planCost } from '@shared/engine';
import type { Placement, ScoreResult } from '@shared/types';
import type { MapData } from '../data';
import type { Story } from '../story';
import { money } from '../ui/format';
import { platform } from './newsFacts';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** The neighborhoods with the most at-risk people left unprotected, worst first, with the engine's reason. */
export function biggestGaps(result: ScoreResult, k = 3) {
  return result.byHood
    .map((h) => ({ hood: h.hood, left: h.atRisk - h.protected, leftPct: h.atRisk > 0 ? Math.round(100 * (1 - h.protected / h.atRisk)) : 0 }))
    .filter((h) => h.left > 1e-6 && h.leftPct > 0)
    .sort((a, b) => b.left - a.left)
    .slice(0, k)
    .map((h) => ({ hood: h.hood, leftPct: h.leftPct, reason: result.topMisses.find((m) => m.hood === h.hood)?.reason ?? '' }));
}

export function debriefFacts(
  result: ScoreResult,
  data: MapData,
  story: Story,
  placements: Placement[],
  mayor: string | null,
  rank: { place: number; of: number } | null,
): DebriefFacts {
  const best = Math.round(result.bestPossible);
  return {
    city: story.name,
    hazard: story.hazard,
    mayor,
    score: Math.round(result.score),
    bestPossible: best,
    shareOfBest: result.bestPossible > 0 ? Math.round((100 * result.score) / result.bestPossible) : 0,
    protectedPeople: Math.round(result.protectedPeople),
    strandedPeople: Math.round(result.strandedPeople),
    baselineProtected: Math.round(result.baseline.protectedPeople),
    vulnerablePct: Math.round(result.vulnerable.protectedPct),
    everyonePct: Math.round(result.vulnerable.everyonePct),
    spent: money(planCost(placements)),
    budget: money(BUDGET),
    plan: platform(data, mayor, placements),
    missed: biggestGaps(result),
    rank,
  };
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** The debrief without Gemini: the same facts in fixed sentences. */
export function templateDebrief(f: DebriefFacts): string {
  const you = f.mayor ? `Candidate ${f.mayor}, you` : 'You';
  const out: string[] = [
    `${you} scored ${f.score} out of 100 in ${f.city}${f.bestPossible > 0 ? `, ${f.shareOfBest}% of the best plan the data found` : ''}.`,
  ];
  const pieces = [...f.plan.shelters.slice(0, 2), ...f.plan.roads.slice(0, 1)];
  out.push(
    pieces.length
      ? `${list(pieces)} helped keep ${fmt(f.protectedPeople)} people safe, and ${fmt(f.strandedPeople)} were still stranded.`
      : `With nothing new on the map, ${fmt(f.strandedPeople)} people were stranded.`,
  );
  const miss = f.missed[0];
  if (miss) out.push(`The biggest gap was ${miss.hood}${miss.reason ? `: ${miss.reason}` : `, with ${miss.leftPct}% of its people left exposed`}.`);
  out.push(
    f.vulnerablePct < f.everyonePct
      ? `You reached ${f.vulnerablePct}% of vulnerable residents and ${f.everyonePct}% of everyone: aim the next plan at them.`
      : `You reached ${f.vulnerablePct}% of vulnerable residents, ahead of ${f.everyonePct}% of everyone.`,
  );
  let text = '';
  for (const s of out) if ((text + ' ' + s).trim().length <= DEBRIEF_MAX_CHARS) text = (text + ' ' + s).trim();
  return text;
}
