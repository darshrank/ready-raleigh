// Compare storm frame times between URL query variants, alternating runs to even out machine
// load, and print the median of each metric per variant (dev only; needs `npm run dev`).
// usage: node app/scripts/storm-ab.mjs <width> <height> <cpuThrottle> <reps> <query> [query...]
// e.g.   node app/scripts/storm-ab.mjs 1440 900 1 3 realism=off ""
// A query of "" is the default page. Each run is storm-trace.mjs (24 s of the storm, from 1 s on).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [w, h, throttle, reps, ...queries] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const results = new Map(queries.map((q) => [q, []]));
for (let r = 0; r < +reps; r++) {
  for (const q of queries) {
    const out = spawnSync('node', [join(here, 'storm-trace.mjs'), w, h, throttle, q], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const line = out.stdout.split('\n').find((l) => l.startsWith('trace from 1 s:'));
    if (!line) {
      console.error(`run failed for "${q}"`, out.stdout.slice(-500), out.stderr.slice(-500));
      continue;
    }
    const s = JSON.parse(line.slice('trace from 1 s:'.length));
    results.get(q).push(s);
    console.log(`run ${r + 1} "${q}": avg ${s.frame.avg} p95 ${s.frame.p95} max ${s.frame.max} fps ${s.fps} gpu ${s.gpu.avg}`);
  }
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
console.log(`\nmedians over ${reps} runs (${w}x${h}, CPU ${throttle}x):`);
for (const [q, rs] of results) {
  const m = (f) => median(rs.map(f));
  console.log(
    `  ${JSON.stringify(q).padEnd(24)} frame avg ${m((s) => s.frame.avg)}  p95 ${m((s) => s.frame.p95)}  max ${m((s) => s.frame.max)}  fps ${m((s) => s.fps)}  gpu avg ${m((s) => s.gpu.avg)}`,
  );
}
