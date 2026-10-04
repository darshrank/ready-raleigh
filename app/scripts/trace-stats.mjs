// Frame-time summary of a Chrome performance trace (drive.mjs {trace}). Dev only.
// node app/scripts/trace-stats.mjs trace.json [fromMs] [toMs] | --names
//
// What it reports, per frame of the page (times in ms):
// - main: the renderer main-thread task that ran the frame's requestAnimationFrame callbacks
//   (MapLibre's render with the interleaved deck.gl draw, the storm's layer rebuild, FloodView,
//   rain, counters). This is the CPU cost of a frame.
// - gpu: GPU-process GPUTask time between one frame task and the next (the GL work it issued).
// - frame: max(main, gpu) per frame, the number checked against the budget.
// - fps: presented compositor frames per second (PipelineReporter, STATE_PRESENTED_*).
// - user: averages of performance.measure() entries (dev instrumentation), per frame.
import { readFileSync } from 'node:fs';

export function eventNames(events) {
  const n = new Map();
  for (const e of events) n.set(`${e.cat}|${e.name}|${e.ph}`, (n.get(`${e.cat}|${e.name}|${e.ph}`) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]);
}

const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const stats = (xs) => ({ avg: r1(avg(xs)), p95: r1(pct(xs, 95)), max: r1(xs.reduce((a, b) => Math.max(a, b), 0)), n: xs.length });

export function summarize(events, fromMs = 0, toMs = Infinity) {
  const threads = new Map();
  const procs = new Map();
  for (const e of events) {
    if (e.ph !== 'M') continue;
    if (e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
    if (e.name === 'process_name') procs.set(e.pid, e.args.name);
  }
  const key = (e) => `${e.pid}:${e.tid}`;
  // The page's main thread: the one running the animation frames.
  const rafs = events.filter((e) => e.name === 'FireAnimationFrame' && e.ph === 'X');
  const byThread = new Map();
  for (const e of rafs) byThread.set(key(e), (byThread.get(key(e)) ?? 0) + 1);
  const main = [...byThread.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!main) return { error: 'no animation frames in the trace' };
  // The window starts at the page's first animation frame in the trace (some processes report
  // events stamped long before tracing started).
  let t0 = Infinity;
  let tEnd = 0;
  for (const e of rafs) if (key(e) === main) (t0 = Math.min(t0, e.ts)), (tEnd = Math.max(tEnd, e.ts + e.dur));
  const inWindow = (e) => e.ts >= t0 + fromMs * 1000 && e.ts <= t0 + toMs * 1000;

  const tasks = events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && key(e) === main).sort((a, b) => a.ts - b.ts);
  const rafTs = rafs.filter((e) => key(e) === main).map((e) => e.ts).sort((a, b) => a - b);
  const frames = [];
  let j = 0;
  for (const t of tasks) {
    while (j < rafTs.length && rafTs[j] < t.ts) j++;
    if (j < rafTs.length && rafTs[j] <= t.ts + t.dur) frames.push(t);
  }
  const win = frames.filter(inWindow);

  // GPU work between consecutive frame tasks.
  const gpuMain = [...threads.entries()].find(([k, n]) => n === 'CrGpuMain' && procs.get(+k.split(':')[0]) === 'GPU Process')?.[0];
  const gpuTasks = events.filter((e) => e.name === 'GPUTask' && e.ph === 'X' && key(e) === gpuMain).sort((a, b) => a.ts - b.ts);
  const gpu = [];
  let g = 0;
  for (let i = 0; i < frames.length; i++) {
    const start = frames[i].ts;
    const end = frames[i + 1]?.ts ?? Infinity;
    let sum = 0;
    while (g < gpuTasks.length && gpuTasks[g].ts < start) g++;
    let k = g;
    while (k < gpuTasks.length && gpuTasks[k].ts < end) sum += gpuTasks[k++].dur;
    if (inWindow(frames[i])) gpu.push(sum / 1000);
  }
  const mainMs = win.map((t) => t.dur / 1000);
  const frameMs = mainMs.map((m, i) => Math.max(m, gpu[i] ?? 0));

  // Presented frames.
  const seen = new Map();
  for (const e of events) {
    if (e.name !== 'PipelineReporter' || e.ph !== 'b' || !inWindow(e)) continue;
    const r = e.args?.frame_reporter ?? e.args?.chrome_frame_reporter;
    if (!r) continue;
    const prev = seen.get(r.frame_sequence);
    if (!prev || /PRESENTED/.test(r.state)) seen.set(r.frame_sequence, r.state);
  }
  const presented = [...seen.values()].filter((s) => /PRESENTED/.test(s)).length;
  const dropped = [...seen.values()].filter((s) => /DROPPED/.test(s)).length;
  const span = (Math.min(toMs, (tEnd - t0) / 1000) - fromMs) / 1000;

  // Dev user timings (performance.measure), per name.
  const user = {};
  const open = new Map();
  for (const e of events) {
    if (!e.cat?.includes('blink.user_timing') || !inWindow(e)) continue;
    if (e.ph === 'X') (user[e.name] ??= []).push(e.dur / 1000);
    else if (e.ph === 'b') open.set(`${e.name}:${e.id ?? e.id2?.local}`, e.ts);
    else if (e.ph === 'e') {
      const k = `${e.name}:${e.id ?? e.id2?.local}`;
      if (open.has(k)) (user[e.name] ??= []).push((e.ts - open.get(k)) / 1000), open.delete(k);
    }
  }
  return {
    window: [fromMs, toMs === Infinity ? 'end' : toMs],
    frame: stats(frameMs),
    main: stats(mainMs),
    gpu: stats(gpu),
    fps: r1(presented / Math.max(0.001, span)),
    presented,
    dropped,
    user: Object.fromEntries(Object.entries(user).map(([k, v]) => [k, stats(v)])),
  };
}

if (process.argv[1]?.endsWith('trace-stats.mjs')) {
  const { traceEvents } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (process.argv.includes('--names')) for (const [k, v] of eventNames(traceEvents).slice(0, 80)) console.log(v, k);
  else console.log(JSON.stringify(summarize(traceEvents, +(process.argv[3] ?? 0), +(process.argv[4] ?? Infinity)), null, 1));
}
