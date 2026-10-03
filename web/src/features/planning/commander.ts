"use client";

import { CITY_PACKS } from "@/cities";
import { ROUND, type InterventionSpec } from "@/config/game";
import { protectableCrossings } from "@/features/map/layers";
import { evaluatePlan } from "@/lib/engine/coverage";
import { candidateSets, withAdd } from "@/lib/engine/optimize";
import { toEnginePlan } from "@/lib/engine/plan";
import { spent, useGame } from "@/stores/game";

export interface Candidate {
  id: string;
  spec: InterventionSpec;
  target: number;
  lon: number;
  lat: number;
  label: string;
  residents: number;
  vulnerable: number;
}

/**
 * Engine facts for the AI Commander: candidate moves scored by the planning
 * estimate, the riskiest neighborhoods and known bottlenecks. Gemini may only
 * quote numbers from here.
 */
export function commanderContext() {
  const s = useGame.getState();
  const data = s.data!;
  const ctx = s.coverage!;
  const cfg = data.cfg;
  const plan = toEnginePlan(s.placements, cfg);
  const left = ROUND.budget - spent(s.placements, cfg);
  const now = evaluatePlan(ctx, plan);
  const sets = candidateSets(ctx, s.achilles);
  const taken = new Set(s.placements.map((p) => `${p.kind}:${p.target}`));
  const pool: Omit<Candidate, "residents" | "vulnerable" | "id">[] = [];
  for (const spec of cfg.interventions) {
    if (spec.cost > left) continue;
    if (spec.effect === "shelter") pool.push(...sets.shelters.slice(0, 5).map((t) => ({ spec, target: t, lon: data.shelters[t].lon, lat: data.shelters[t].lat, label: data.shelters[t].name })));
    else if (spec.effect === "pickup") pool.push(...sets.busStops.slice(0, 5).map((t) => ({ spec, target: t, lon: data.busStops[t].lon, lat: data.busStops[t].lat, label: data.busStops[t].name || "Bus stop" })));
    else if (spec.effect === "protectRoad") {
      const ids = sets.crossings.length ? sets.crossings.slice(0, 4) : protectableCrossings(data, ctx.flood.edgeClose).sort((a, b) => a.cls - b.cls || b.len - a.len).slice(0, 4).map((c) => c.id);
      pool.push(...ids.map((t) => ({ spec, target: t, lon: data.crossings[t].lon, lat: data.crossings[t].lat, label: data.crossings[t].label })));
    } else if (spec.effect === "shield" && spec.snapsTo === "shieldPoint") {
      pool.push(...sets.shields.filter((p) => p.kind === spec.shieldKind).slice(0, 3).map((p) => ({ spec, target: p.id, lon: p.lon, lat: p.lat, label: p.label })));
    } else if (spec.effect === "protectSite") {
      pool.push(...plan.shelters.filter((t) => !plan.protectedSites.includes(t)).map((t) => ({ spec, target: t, lon: data.shelters[t].lon, lat: data.shelters[t].lat, label: data.shelters[t].name })));
    }
  }
  const candidates: Candidate[] = pool
    .filter((c) => !taken.has(`${c.spec.id}:${c.target}`))
    .map((c) => {
      const ev = evaluatePlan(ctx, withAdd(plan, c.spec, c.target, c.lon, c.lat));
      return { ...c, id: `${c.spec.id}:${c.target}`, residents: Math.round(ev.protected - now.protected), vulnerable: Math.round(ev.vulnProtected - now.vulnProtected) };
    })
    .filter((c) => c.residents > 0 || c.spec.effect === "protectRoad")
    .sort((a, b) => b.vulnerable / b.spec.cost - a.vulnerable / a.spec.cost)
    .slice(0, 8);

  const zones = data.zones
    .map((z) => ({ z, open: now.zoneAtRisk[z.id] - now.zoneProtected[z.id] }))
    .filter((x) => x.open > 50)
    .sort((a, b) => b.open - a.open)
    .slice(0, 5)
    .map(({ z, open }) => {
      const sh = data.zoneShares[z.id];
      return { name: z.name, unprotectedResidents: Math.round(open), noCarPct: Math.round(sh.snv * 100), olderPct: Math.round(sh.s65 * 100), povertyPct: Math.round(sh.spov * 100) };
    });

  const pack = CITY_PACKS[data.cityId];
  const context = {
    city: pack.name,
    scenario: pack.scenarioTitle,
    hazard: pack.hazard,
    budgetLeft: left,
    budgetTotal: ROUND.budget,
    estimate: { protectedResidents: Math.round(now.protected), atRisk: Math.round(now.atRisk), sharePct: Math.round((100 * now.protected) / Math.max(1, now.atRisk)) },
    placed: s.placements.map((p) => ({ kind: cfg.interventions.find((i) => i.id === p.kind)?.label ?? p.kind, label: p.label })),
    candidates: candidates.map((c) => ({ id: c.id, kind: c.spec.label, label: c.label, cost: c.spec.cost, addsResidents: c.residents, addsVulnerabilityWeighted: c.vulnerable })),
    riskiestNeighborhoods: zones,
    bottlenecks: (s.achilles?.findings ?? []).slice(0, 3).map((f) => ({ road: data.crossings[f.crossing].label, dependents: Math.round(f.dependents), isolatedIfFails: Math.round(f.isolated) })),
    coolingGaps: (s.achilles?.gaps ?? []).slice(0, 3).map((g) => ({ neighborhood: data.zones[g.zone].name, residents: g.residents })),
    notes: ["Rescue teams and medical sites act during the simulation and are not in this estimate.", "Scenario simulation, not an emergency forecast."],
  };
  return { context, candidates };
}
