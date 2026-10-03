// Finds the best plan for each mode and writes optimal_<mode>.json next to the data it read.
//
//   npm run optimize               # flood and heat, data folder from DATA_DIR / VITE_DATA_BASE
//   npm run optimize -- flood      # one mode
//   DATA_DIR=app/public/data npm run optimize
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUDGET } from '../src/config';
import type { OptimalPlan } from '../src/data';
import { floodRiskShare, optimize, score } from '../src/engine';
import type { Mode } from '../src/types';
import { dataDir, loadBundle } from './bundle';

const modes = (process.argv.slice(2).filter((a) => a === 'flood' || a === 'heat') as Mode[]);
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), dataDir());
const data = loadBundle(dir);
console.log(`optimize: ${data.cells.length} cells, ${data.sites.length} sites, ${data.floodRoads.length} roads from ${dir}`);

for (const mode of modes.length > 0 ? modes : (['flood', 'heat'] as Mode[])) {
  const residents = data.cells.reduce((sum, c) => sum + c.pop, 0);
  const atRiskPeople = data.cells.reduce((sum, c) => sum + c.pop * floodRiskShare(c), 0);
  if (mode === 'flood') {
    console.log(`  at risk: ${atRiskPeople.toFixed(3)} people / ${residents.toFixed(3)} residents (${(100 * atRiskPeople / residents).toFixed(2)}%)`);
    if (atRiskPeople > .2 * residents) throw new Error('At-risk residents exceed 20%; stop and review data realism before further optimization.');
  }
  const t0 = performance.now();
  const { plan, stats } = optimize(mode, data);
  const ms = performance.now() - t0;
  const result = score(plan, data);
  const out: OptimalPlan = { mode, built: new Date().toISOString().slice(0, 10), budget: BUDGET, plan, score: result };
  const file = join(dir, `optimal_${mode}.json`);
  writeFileSync(file, JSON.stringify(out) + '\n');
  const picks = plan.placements.map((p) => `${p.type}:${p.siteId ?? p.roadId ?? p.cell}`).join(', ');
  console.log(
    `${mode}: score ${result.score.toFixed(1)}, $${(plan.spent / 1e6).toFixed(2)}M, ` +
      `${stats.candidates} candidates, ${stats.evaluations} gain evals, ${ms.toFixed(0)} ms -> ${file}`,
  );
  console.log(`  ${picks}`);
  if (mode === 'flood') {
    const single = data.sites.map((s) => {
      const p = { ...plan, placements: [{ id: 'single', type: 'shelter' as const, siteId: s.id }] };
      return { siteId: s.id, name: s.name, ...score(p, data) };
    });
    single.sort((a, b) => b.score - a.score || a.siteId.localeCompare(b.siteId));
    const largest = single[0];
    const report = {
      residents, atRiskPeople, atRiskWeighted: result.atRiskWeighted,
      atRiskResidentShare: atRiskPeople / residents,
      cutOffCells: data.cells.filter((c) => c.cutOff).length,
      cellsPerFloodStep: Object.fromEntries([1, 2, 3, null].map((s) => [String(s), data.cells.filter((c) => c.floodStep === s).length])),
      optimalScore: result.score, optimalProtectedPeople: result.protectedPeople,
      largestSingleShelter: largest ? { siteId: largest.siteId, name: largest.name, weightedScore: largest.score,
        protectedPeople: largest.protectedPeople, atRiskPeopleShare: largest.protectedPeople / atRiskPeople } : null,
      largestSingleShelterPeople: Math.max(0, ...single.map((s) => s.protectedPeople)),
      optimizerMs: ms, stats,
    };
    writeFileSync(join(dir, 'balance_report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}
