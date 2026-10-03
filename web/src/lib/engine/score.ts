import { SCORE_WEIGHTS } from "@/config/game";
import type { SimResult } from "./simulate";

export type ScoreKey = keyof typeof SCORE_WEIGHTS;

export interface ScoreContext {
  /** Vulnerability-weighted protected residents with no interventions. */
  baselineVuln: number;
  /** Best vulnerability-weighted gain per $1M among single interventions. */
  bestGainPerMillion: number;
  /** Critical crossings and their weights, from the bottleneck scan. */
  critical: { crossing: number; weight: number }[];
}

export interface Score {
  total: number;
  components: Record<ScoreKey, number>;
  shares: { overall: number; older: number; lowIncome: number; noCar: number; vulnerable: number };
  gainVsBaseline: number;
  spent: number;
}

const pct = (a: number, b: number) => (b > 0 ? a / b : 0);

export function scoreRun(sim: SimResult, ctx: ScoreContext): Score {
  const t = sim.totals;
  const overall = pct(t.protected + t.rescued, t.atRisk);
  const vulnerable = pct(t.vuln.protected, t.vuln.total);
  const spent = sim.plan.cost;
  const gain = t.vuln.protected - ctx.baselineVuln;
  const perMillion = spent > 0 ? gain / (spent / 1e6) : 0;

  let critTotal = 0;
  let critKept = 0;
  for (const { crossing, weight } of ctx.critical) {
    critTotal += weight;
    if (sim.plan.crossings.includes(crossing)) critKept += weight;
  }
  const access = sim.hospitalAccessPeak;
  const components: Record<ScoreKey, number> = {
    population: 100 * overall,
    vulnerable: 100 * vulnerable,
    accessibility: 100 * access,
    // with no road bottlenecks (heat), network resilience is how much of the cooling network survived
    network:
      critTotal > 0
        ? 100 * (0.35 + 0.65 * (critKept / critTotal)) * Math.min(1, access + 0.1)
        : 100 * (sim.shelterStats.length ? sim.shelterStats.filter((s) => s.floodedAt > 99).length / sim.shelterStats.length : access),
    budget: spent > 0 && ctx.bestGainPerMillion > 0 ? Math.max(0, Math.min(100, (100 * perMillion) / ctx.bestGainPerMillion)) : 0,
    equity: overall > 0 ? 100 * Math.min(1, vulnerable / overall) : 0,
  };
  let total = 0;
  for (const k of Object.keys(SCORE_WEIGHTS) as ScoreKey[]) total += SCORE_WEIGHTS[k] * components[k];
  return {
    total: Math.round(total),
    components,
    shares: { overall, older: pct(t.g65.protected, t.g65.total), lowIncome: pct(t.gPov.protected, t.gPov.total), noCar: pct(t.gNoCar.protected, t.gNoCar.total), vulnerable },
    gainVsBaseline: gain,
    spent,
  };
}
