"use client";

import { useMemo } from "react";
import { playerId, useRoom } from "@/features/room/room-store";
import { crowdAnalysis } from "@/lib/engine/crowd";
import { metersBetween } from "@/lib/engine/optimize";
import { toEnginePlan, type EnginePlan } from "@/lib/engine/plan";
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

export interface RoomRow {
  name: string;
  kind: "you" | "player" | "simulated" | "ai";
  score: number;
  reached: number;
  vulnerable: number;
  spent: number;
  pending?: boolean;
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

export function grade(score: number) {
  return score >= 80 ? "S" : score >= 70 ? "A" : score >= 60 ? "B" : score >= 50 ? "C" : "D";
}

/** Everything the reveal needs, derived from the player's run, the optimizer and the room. */
export function useResults() {
  const data = useGame((s) => s.data)!;
  const sim = useGame((s) => s.sim)!;
  const reference = useGame((s) => s.reference);
  const bots = useGame((s) => s.bots);
  const baseline = useGame((s) => s.baseline)!;
  const placements = useGame((s) => s.placements);
  const mode = useGame((s) => s.mode);
  const room = useRoom((s) => s.room);
  const myName = useRoom((s) => s.name);

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
    const multiplayer = mode === "multiplayer" && !!room;
    const pid = playerId();
    const others = multiplayer ? room!.players.filter((p) => p.id !== pid) : [];

    let rows: RoomRow[] | null = null;
    let otherPlans: EnginePlan[] = [];
    if (you && optimal) {
      const mine: RoomRow = { name: multiplayer ? `${myName} (you)` : "You", kind: "you", score: you.total, reached: you.shares.overall, vulnerable: you.shares.vulnerable, spent: you.spent };
      const ai: RoomRow = { name: "AI optimizer", kind: "ai", score: optimal.total, reached: optimal.shares.overall, vulnerable: optimal.shares.vulnerable, spent: optimal.spent };
      if (multiplayer) {
        const players = others.map<RoomRow>((p) =>
            p.result
              ? { name: p.name, kind: "player", score: p.result.score, reached: p.result.reached / Math.max(1, p.result.atRisk), vulnerable: p.result.vulnerableShare, spent: p.result.spent }
              : { name: p.name, kind: "player", score: -1, reached: 0, vulnerable: 0, spent: p.spent, pending: true },
          );
        otherPlans = others.filter((p) => p.result).map((p) => p.result!.plan);
        rows = [mine, ai, ...players];
      } else {
        const stand = (bots ?? []).map<RoomRow>((b) => {
          const sc = scoreRun(b.sim, ctx!);
          return { name: b.name, kind: "simulated", score: sc.total, reached: sc.shares.overall, vulnerable: sc.shares.vulnerable, spent: sc.spent };
        });
        rows = [mine, ai, ...stand];
        otherPlans = (bots ?? []).map((b) => b.plan);
      }
      rows?.sort((a, b) => b.score - a.score);
    }

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

    const crowd = otherPlans.length ? crowdAnalysis(data, [...otherPlans, toEnginePlan(placements, data.cfg)], baseline) : null;
    const gap = crowd?.gapZone
      ? (() => {
          const z = data.zones[crowd.gapZone.zone];
          const sh = data.zoneShares[z.id];
          let bestD = Infinity;
          data.shelters.forEach((s) => {
            if (s.fcls) return;
            bestD = Math.min(bestD, metersBetween(s.lon, s.lat, z.lon, z.lat));
          });
          return { zone: z, shares: sh, crowd: crowd.gapZone.crowd, nearestShelterKm: Number.isFinite(bestD) ? bestD / 1000 : null, outcome: zones[z.id] };
        })()
      : null;

    return { ctx, you, optimal, rows, multiplayer, zones, missed, failure, crowd, gap, reference, sim };
  }, [data, sim, reference, bots, baseline, placements, mode, room, myName]);
}

export type Results = ReturnType<typeof useResults>;

/** Engine facts for the Gemini debrief. */
export function debriefContext(r: Results, zoneName: (i: number) => string) {
  const t = r.sim.totals;
  const share = (t.protected + t.rescued) / t.atRisk;
  return {
    score: r.you?.total,
    grade: r.you ? grade(r.you.total) : null,
    optimizerScore: r.optimal?.total,
    reachedSafetyPct: Math.round(share * 100),
    atRisk: Math.round(t.atRisk),
    reachedSafety: Math.round(t.protected + t.rescued),
    stranded: Math.round(t.stranded),
    cutOff: Math.round(t.isolated),
    noCarReachedPct: t.gNoCar.total > 0 ? Math.round((100 * t.gNoCar.protected) / t.gNoCar.total) : null,
    olderReachedPct: t.g65.total > 0 ? Math.round((100 * t.g65.protected) / t.g65.total) : null,
    biggestMiss: r.missed && r.missed.unprotectedVuln > 0 ? { neighborhood: zoneName(r.missed.zone), residentsNotSafe: Math.round(r.missed.atRisk - r.missed.protected) } : null,
    criticalFailure: r.failure && r.failure.affected > 0 ? { road: r.failure.crossing.label, closedAtHour: Number(r.failure.closedAt.toFixed(1)), residentsLostRoute: Math.round(r.failure.affected), neverMadeIt: Math.round(r.failure.stranded) } : null,
    roomOverlooked: r.gap ? r.gap.zone.name : null,
    rank: r.rows ? r.rows.findIndex((x) => x.kind === "you") + 1 : null,
    players: r.rows?.length ?? null,
  };
}

/** Deterministic debrief, used when Gemini is not available. */
export function debriefText(r: Results, names: { zone: (i: number) => string }, cfg: import("@/config/game").ScenarioParams) {
  const t = r.sim.totals;
  const parts: string[] = [];
  const share = (t.protected + t.rescued) / t.atRisk;
  const safe = cfg.hazard.type === "heat" ? "cooling" : "safety";
  parts.push(`Your plan got ${Math.round(t.protected + t.rescued).toLocaleString()} of ${Math.round(t.atRisk).toLocaleString()} at-risk residents to ${safe} (${Math.round(share * 100)}%).`);
  if (r.missed && r.missed.unprotectedVuln > 0) parts.push(`The biggest miss was ${names.zone(r.missed.zone)}: ${Math.round(r.missed.atRisk - r.missed.protected).toLocaleString()} residents there never reached ${safe}.`);
  if (r.failure && r.failure.affected > 0) parts.push(`When ${r.failure.crossing.label} failed at hour ${r.failure.closedAt.toFixed(1)}, ${Math.round(r.failure.affected).toLocaleString()} evacuating residents lost their route.`);
  if (r.optimal && r.you) {
    const d = r.optimal.total - r.you.total;
    parts.push(d > 0 ? `The optimizer scored ${r.optimal.total}, ${d} points higher, by spending where vulnerability-weighted coverage per dollar was highest.` : `You matched or beat the optimizer (${r.optimal.total}).`);
  }
  if (t.gNoCar.total > 0 && t.gNoCar.protected / t.gNoCar.total < share - 0.2) parts.push(`Households without a car fared worst: ${Math.round((100 * t.gNoCar.protected) / t.gNoCar.total)}% reached ${safe}. Pickups near them are the lever.`);
  return parts;
}
