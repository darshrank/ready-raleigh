/**
 * Headless engine check against the generated city data.
 * Run: pnpm engine:check [city]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CITY_PACKS } from "../src/cities";
import { loadCityData } from "../src/lib/data/city-data";
import { scanAchilles } from "../src/lib/engine/achilles";
import { makeBots } from "../src/lib/engine/bots";
import { createCoverageContext, evaluatePlan } from "../src/lib/engine/coverage";
import { crowdAnalysis } from "../src/lib/engine/crowd";
import { resolveEvents } from "../src/lib/engine/events";
import { optimizePlan } from "../src/lib/engine/optimize";
import { EMPTY_PLAN } from "../src/lib/engine/plan";
import { scoreRun } from "../src/lib/engine/score";
import { simulate, type SimResult } from "../src/lib/engine/simulate";
import type { CityId } from "../src/types";

const publicDir = path.resolve(__dirname, "../public");
globalThis.fetch = (async (url: string) => {
  const file = path.join(publicDir, url);
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, "utf8")) };
}) as unknown as typeof fetch;

const t = () => performance.now();
const fmt = (n: number) => Math.round(n).toLocaleString();
const summarize = (tt: SimResult["totals"]) =>
  `atRisk ${fmt(tt.atRisk)} | safe ${fmt(tt.protected)} | rescued ${fmt(tt.rescued)} | stranded ${fmt(tt.stranded)} | isolated ${fmt(tt.isolated)} | home ${fmt(tt.sheltering)} | noCar ${fmt(tt.gNoCar.protected)}/${fmt(tt.gNoCar.total)}`;

async function check(cityId: CityId) {
  if (!existsSync(path.join(publicDir, "data", cityId, "meta.json"))) {
    console.log(`\n### ${cityId}: no data yet`);
    return;
  }
  console.log(`\n### ${cityId}`);
  let t0 = t();
  const data = await loadCityData(cityId);
  console.log(`load ${(t() - t0).toFixed(0)} ms: ${data.graph.n} nodes, ${data.graph.m} edges, ${data.origins.length} origins, ${data.safeNodes.length} safe nodes, ${data.crossings.length} crossings, ${data.shieldPoints.length} shield points`);
  const events = resolveEvents(data, 20261003);
  console.log("events", JSON.stringify({ culvert: events.culvert && data.crossings[events.culvert.crossing].label, creek: events.creekSurge && data.featureNames[events.creekSurge.sid], blackout: events.blackout && `${events.blackout.zones.length} zones @${events.blackout.hour}`, ignitions: events.ignitions.length, aftershock: events.aftershock?.hour }));
  const ctx = createCoverageContext(data);
  const base = evaluatePlan(ctx, EMPTY_PLAN);
  console.log(`static baseline: protected ${fmt(base.protected)} / ${fmt(base.atRisk)}`);
  t0 = t();
  const ach = scanAchilles(data, ctx.flood, []);
  console.log(`scan ${(t() - t0).toFixed(0)} ms (${ach.mode})`);
  for (const f of ach.findings.slice(0, 3)) console.log(`  ${data.crossings[f.crossing].label} dep ${fmt(f.dependents)} iso ${fmt(f.isolated)} +${f.addedMinutes.toFixed(1)}m closes ${f.closesAt.toFixed(1)}`);
  for (const g of ach.gaps.slice(0, 3)) console.log(`  gap ${data.zones[g.zone].name}: ${fmt(g.residents)} residents`);
  t0 = t();
  const opt = optimizePlan(ctx, ach);
  console.log(`optimize ${(t() - t0).toFixed(0)} ms: ${opt.steps.map((s) => `${s.spec}:${s.target}`).join(", ")}`);
  t0 = t();
  const simBase = simulate(data, EMPTY_PLAN, events, { recordTrips: false });
  console.log(`sim baseline ${(t() - t0).toFixed(0)} ms: ${summarize(simBase.totals)}`);
  t0 = t();
  const simOpt = simulate(data, opt.plan, events, { recordTrips: true });
  console.log(`sim optimal ${(t() - t0).toFixed(0)} ms (${simOpt.trips.length} trips, ${simOpt.agents.length} agents): ${summarize(simOpt.totals)}`);
  const ctxS = { baselineVuln: simBase.totals.vuln.protected, bestGainPerMillion: opt.bestGainPerMillion, critical: ach.findings.slice(0, 6).map((f) => ({ crossing: f.crossing, weight: f.isolated + f.dependents * 0.1 })) };
  const sOpt = scoreRun(simOpt, ctxS);
  console.log(`score optimal ${sOpt.total} ${JSON.stringify(Object.fromEntries(Object.entries(sOpt.components).map(([k, v]) => [k, Math.round(v)])))} | baseline ${scoreRun(simBase, ctxS).total}`);
  const bots = makeBots(data, ctx.flood, events.seed, CITY_PACKS[cityId].center);
  const scores = bots.map((b) => scoreRun(simulate(data, b.plan, events, { recordTrips: false }), ctxS).total);
  console.log(`bots ${scores.join(", ")}`);
  const crowd = crowdAnalysis(data, bots.map((b) => b.plan), base);
  console.log(`gap zone: ${crowd.gapZone ? data.zones[crowd.gapZone.zone].name : "none"}`);
  console.log(`events (${simOpt.events.length}): ${simOpt.events.slice(0, 8).map((e) => `h${e.hour.toFixed(1)} ${e.title}`).join(" | ")}`);
}

async function main() {
  const which = process.argv[2] as CityId | undefined;
  const cities: CityId[] = which ? [which] : ["raleigh", "miami", "new-york", "san-francisco"];
  for (const c of cities) await check(c);
}

main();
