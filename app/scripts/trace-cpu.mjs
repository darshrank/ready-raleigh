// Top functions by sampled self time in a trace taken with {trace, cpu:true} (dev only).
// node app/scripts/trace-cpu.mjs trace.json [top]
import { readFileSync } from 'node:fs';
const { traceEvents } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const top = +(process.argv[3] ?? 30);
// Only the page's main thread (the one running the animation frames).
const rafs = new Map();
for (const e of traceEvents) if (e.name === 'FireAnimationFrame') rafs.set(`${e.pid}:${e.tid}`, (rafs.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
const main = [...rafs].sort((a, b) => b[1] - a[1])[0]?.[0];
// A profile's chunks share the id of its 'Profile' event, which carries the profiled thread.
const ids = new Set(traceEvents.filter((e) => e.name === 'Profile' && `${e.pid}:${e.tid}` === main).map((e) => e.id));
const nodes = new Map();
const self = new Map();
const parent = new Map();
let total = 0;
for (const e of traceEvents) {
  if (e.name !== 'ProfileChunk' || !ids.has(e.id)) continue;
  const p = e.args?.data?.cpuProfile;
  for (const n of p?.nodes ?? []) {
    nodes.set(`${e.id}:${n.id}`, n.callFrame);
    if (n.parent) parent.set(`${e.id}:${n.id}`, `${e.id}:${n.parent}`);
  }
  const deltas = e.args?.data?.timeDeltas ?? [];
  (p?.samples ?? []).forEach((s, i) => {
    const k = `${e.id}:${s}`;
    const dt = (deltas[i] ?? 0) / 1000;
    self.set(k, (self.get(k) ?? 0) + dt);
    total += dt;
  });
}
const byFn = new Map();
const incl = new Map();
for (const [k, ms] of self) {
  const f = nodes.get(k);
  if (!f) continue;
  const name = `${f.functionName || '(anon)'} ${(f.url ?? '').split('/').slice(-1)[0]?.split('?')[0]}:${f.lineNumber}`;
  byFn.set(name, (byFn.get(name) ?? 0) + ms);
  // inclusive: walk up once per distinct function on the stack
  const seen = new Set();
  for (let c = k; c; c = parent.get(c)) {
    const g = nodes.get(c);
    if (!g) break;
    const nm = `${g.functionName || '(anon)'} ${(g.url ?? '').split('/').slice(-1)[0]?.split('?')[0]}:${g.lineNumber}`;
    if (seen.has(nm)) continue;
    seen.add(nm);
    incl.set(nm, (incl.get(nm) ?? 0) + ms);
  }
}
console.log(`sampled ${total.toFixed(0)} ms`);
console.log('--- self');
for (const [n, ms] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(ms.toFixed(1).padStart(8), n);
console.log('--- inclusive');
for (const [n, ms] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(ms.toFixed(1).padStart(8), n);
