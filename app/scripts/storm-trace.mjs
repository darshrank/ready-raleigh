// Trace the storm with the optimal plan (dev only; needs `npm run dev` on :5173).
// usage: node app/scripts/storm-trace.mjs <width> <height> [cpuThrottle] [query] [traceFile]
// e.g.   node app/scripts/storm-trace.mjs 1440 900
//        node app/scripts/storm-trace.mjs 390 844 4 quality=medium
// Prints drive.mjs's trace summary for the whole storm and for after its first second, then the
// per-frame change counters (app/src/dev/fx.ts) from storm time 1 s on. Runs on the GPU (GPU=1).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [w = '1440', h = '900', throttle = '1', query = '', traceFile = ''] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const TRACE_MS = 24000; // the storm (23 s) and the start of the clear
const steps = [
  { waitFor: "window.__plan && window.__map && window.__fx && __plan.getState().phase==='planning'", timeout: 90000 },
  {
    eval: "fetch('/data/optimal_flood.json').then(r=>r.json()).then(o=>{__plan.setState({placements:o.plan.placements,nextId:10});return o.plan.placements.length})",
  },
  { wait: 4000 },
  ...(+throttle > 1 ? [{ throttle: +throttle }] : []),
  { eval: '__fx.reset(), __plan.getState().endPlanning(), __plan.getState().phase' },
  { trace: TRACE_MS, ...(traceFile ? { file: traceFile } : {}) },
  { eval: 'JSON.stringify(__fx.summary(1000))' },
];
const dir = mkdtempSync(join(tmpdir(), 'storm'));
const stepsFile = join(dir, 'steps.json');
writeFileSync(stepsFile, JSON.stringify(steps));
const url = `http://localhost:5173/solo?skip${query ? `&${query}` : ''}`;
const out = spawnSync('node', [join(here, 'drive.mjs'), url, w, h, stepsFile], {
  env: { ...process.env, GPU: '1' },
  encoding: 'utf8',
  maxBuffer: 1 << 28,
});
process.stdout.write(out.stdout);
process.stderr.write(out.stderr);
