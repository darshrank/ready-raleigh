// Finds the best plan for each mode and writes optimal_<mode>.json next to the data it read.
//
//   npm run optimize               # flood and heat, data folder from DATA_DIR / VITE_DATA_BASE
//   npm run optimize -- flood      # one mode
//   DATA_DIR=app/public/data npm run optimize
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUDGET } from '../src/config';
import type { OptimalPlan } from '../src/data';
import { optimize, score } from '../src/engine';
import type { Mode } from '../src/types';
import { dataDir, loadBundle } from './bundle';

const modes = (process.argv.slice(2).filter((a) => a === 'flood' || a === 'heat') as Mode[]);
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), dataDir());
const data = loadBundle(dir);
console.log(`optimize: ${data.cells.length} cells, ${data.sites.length} sites, ${data.floodRoads.length} roads from ${dir}`);

for (const mode of modes.length > 0 ? modes : (['flood', 'heat'] as Mode[])) {
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
}
