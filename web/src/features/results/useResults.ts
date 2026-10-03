"use client";

import { useMemo } from "react";
import { crowdAnalysis } from "@/lib/engine/crowd";
import { metersBetween } from "@/lib/engine/optimize";
import { toEnginePlan } from "@/lib/engine/plan";
import { scoreRun, type Score, type ScoreContext } from "@/lib/engine/score";
import type { SimResult } from "@/lib/engine/simulate";
import { useGame } from "@/stores/game";

export interface ZoneOutcome {
  zone: number;
  atRisk: number;
  protected: number;
  stranded: number;
  isolated: number;
  unprotectedVuln: number;
}

export function zoneOutcomes(sim: SimResult, nZones: number): ZoneOutcome[] {
  const out: ZoneOutcome[] = Array.from({ length: nZones }, (_, zone) => ({ zone, atRisk: 0, protected: 0, stranded: 0, isolated: 0, unprotectedVuln: 0 }));
  for (const a of sim.agents) {
    const z = out[a.zone];
    z.atRisk += a.weight;
    if (a.fate === "protected" || a.fate === "rescued") z.protected += a.weight;
    else {
      if (a.fate === "stranded") z.stranded += a.weight;
      if (a.fate === "isolated") z.isolated += a.weight;
      z.unprotectedVuln += a.weight * (a.s65 + a.spov + (a.kind === 2 ? 1 : 0));
    }
  }
  return out;
}

/** Everything the reveal needs, derived from the player's run, the optimizer and the room. */
export function useResults() {
  const data = useGame((s) => s.data)!;
  const sim = useGame((s) => s.sim)!;
  const reference = useGame((s) => s.reference);
  const bots = useGame((s) => s.bots);
  const baseline = useGame((s) => s.baseline)!;
  const placements = useGame((s) => s.placements);

  return useMemo(() => {
    const ctx: ScoreContext | null = reference
      ? {
          baselineVuln: reference.baseline.totals.vuln.protected,
          bestGainPerMillion: reference.bestGainPerMillion,
          critical: reference.achilles.findings.slice(0, 6).map((f) => ({ crossing: f.crossing, weight: f.isolated + f.dependents * 0.1 })),
        }
      : null;
    const you: Score | null = ctx ? scoreRun(sim, ctx) : null;
    const optimal: Score | null = ctx && reference ? scoreRun(reference.sim, ctx) : null;
    const room =
      ctx && bots
        ? [
            { name: "You", simulated: false, score: you!, sim },
            ...bots.map((b) => ({ name: b.name, style: b.style, simulated: true, score: scoreRun(b.sim, ctx), sim: b.sim })),
          ].sort((a, b) => b.score.total - a.score.total)
        : null;
    const zones = zoneOutcomes(sim, data.zones.length);
    const missed = [...zones].sort((a, b) => b.unprotectedVuln - a.unprotectedVuln)[0];

    // critical failure: the closure that cut off the most evacuees, followed through to its consequences
    const blocked = [...sim.blockedBy].sort((a, b) => b[1] - a[1]);
    const culvertId = sim.events.find((e) => e.title.startsWith("Culvert overtopped"))?.crossing;
    const failureId = blocked[0] && blocked[0][1] > 0 ? blocked[0][0] : culvertId;
    const failure = (() => {
      if (failureId === undefined) return null;
      const hit = sim.agents.filter((a) => a.blockedCrossing === failureId);
      const zonesHit = new Set(hit.map((a) => a.zone));
      return {
        crossing: data.crossings[failureId],
        closedAt: Math.min(...data.crossings[failureId].edges.map((e) => sim.edgeClose[e])),
        affected: hit.reduce((s, a) => s + a.weight, 0),
        stranded: hit.filter((a) => a.fate === "stranded").reduce((s, a) => s + a.weight, 0),
        rerouted: hit.filter((a) => a.rerouted).reduce((s, a) => s + a.weight, 0),
        isolation: sim.events.find((e) => e.zone !== undefined && zonesHit.has(e.zone) && e.title.includes("isolated")),
      };
    })();

    const crowd = bots ? crowdAnalysis(data, [...bots.map((b) => b.plan), toEnginePlan(placements, data.cfg)], baseline) : null;
    const gap = crowd?.gapZone
      ? (() => {
          const z = data.zones[crowd.gapZone.zone];
          const sh = data.zoneShares[z.id];
          let best = -1;
          let bestD = Infinity;
          data.shelters.forEach((s, i) => {
            if (s.fcls) return;
            const d = metersBetween(s.lon, s.lat, z.lon, z.lat);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          const bottleneck = reference?.achilles.findings.find((f) => f.zones.some((x) => x.zone === z.id));
          return { zone: z, shares: sh, crowd: crowd.gapZone.crowd, model: crowd.gapZone.model, nearestShelter: best >= 0 ? { site: data.shelters[best], meters: bestD } : null, bottleneck: bottleneck ? data.crossings[bottleneck.crossing] : null, outcome: zones[z.id] };
        })()
      : null;

    return { ctx, you, optimal, room, zones, missed, failure, crowd, gap, reference, sim };
  }, [data, sim, reference, bots, baseline, placements]);
}

export function debriefText(r: ReturnType<typeof useResults>, names: { zone: (i: number) => string }, cfg: import("@/config/game").ScenarioParams) {
  const t = r.sim.totals;
  const parts: string[] = [];
  const share = (t.protected + t.rescued) / t.atRisk;
  parts.push(
    `Your plan got ${Math.round(t.protected + t.rescued).toLocaleString()} of ${Math.round(t.atRisk).toLocaleString()} at-risk residents to ${cfg.hazard.type === "heat" ? "cooling" : "safety"} (${Math.round(share * 100)}%).`,
  );
  if (r.you && r.ctx) {
    const gain = Math.round(r.you.gainVsBaseline);
    parts.push(gain > 0 ? `That is ${gain.toLocaleString()} more vulnerability-weighted residents than doing nothing.` : "It barely changed the outcome compared with doing nothing.");
  }
  if (r.missed && r.missed.unprotectedVuln > 0) {
    const z = r.missed.zone;
    parts.push(
      `The biggest miss was ${names.zone(z)}: ${Math.round(r.missed.atRisk - r.missed.protected).toLocaleString()} residents there never reached ${cfg.hazard.type === "heat" ? "cooling" : "safety"}.`,
    );
  }
  if (r.failure && r.failure.affected > 0) {
    parts.push(
      `When ${r.failure.crossing.label} closed at hour ${r.failure.closedAt.toFixed(1)}, ${Math.round(r.failure.affected).toLocaleString()} evacuating residents lost their route and ${Math.round(r.failure.stranded).toLocaleString()} never made it out.`,
    );
  }
  if (r.optimal && r.you) {
    const d = r.optimal.total - r.you.total;
    parts.push(
      d > 0
        ? `The optimizer scored ${r.optimal.total}, ${d} points higher, by putting its budget where vulnerability-weighted coverage per dollar was highest.`
        : `You matched or beat the optimizer (${r.optimal.total}). Its greedy search is a reference, not a ceiling.`,
    );
  }
  if (r.gap) parts.push(`The room barely reached ${r.gap.zone.name}, which the data flags as a priority.`);
  if (t.gNoCar.total > 0 && t.gNoCar.protected / t.gNoCar.total < share - 0.2) {
    parts.push(
      `Households without a car fared worst: ${Math.round((100 * t.gNoCar.protected) / t.gNoCar.total)}% reached safety. Pickups within ${cfg.coverage.busWalkMeters / 1000} km of them are the lever.`,
    );
  }
  return parts;
}
