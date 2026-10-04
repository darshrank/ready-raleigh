// Headless Chrome driver for checking the app (dev only, no dependencies; Node 22 WebSocket).
// Example: node app/scripts/drive.mjs http://localhost:5173/solo 390 844 '[{"waitFor":"!!window.__plan"},{"tap":"B(Shelter)"},{"tap":"G(-78.5939,35.8188)"},{"eval":"__plan.getState().placements"},{"shot":"out.png"}]'
// usage: node app/scripts/drive.mjs <url> <width> <height> <steps.json | inline JSON>
// steps: [{wait:ms}] [{click:[x,y]}] [{tap:[x,y]}] [{drag:[x1,y1,x2,y2]}] [{touchDrag:[x1,y1,x2,y2]}]
//        [{key:"ArrowLeft"}] [{eval:"expr"}] [{shot:"out.png"}] [{probe:ms}] (main-thread latency log)
//        [{waitFor:"expr", timeout:ms}] [{throttle:4}] (CPU slowdown, 1 = off)
//        [{trace:ms, file:"trace.json"}] (Chrome performance trace; the summary from trace-stats.mjs is printed)
// Coordinates may be strings: "G(lon,lat)" is a map point, "B(text)" the first visible button with that text.
// Chrome path is macOS; set CHROME to override. GPU=1 renders on the GPU (Metal) instead of
// swiftshader: use it for frame rates and for the storm, which swiftshader runs at about 2 fps.
// REDUCE=1 emulates prefers-reduced-motion: reduce.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, w, h, stepsArg] = process.argv.slice(2);
const steps = JSON.parse(existsSync(stepsArg) ? readFileSync(stepsArg, 'utf8') : stepsArg);
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`,
  ...(process.env.GPU ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'chr'))}`, 'about:blank',
], { stdio: 'ignore' });
// Never leave a headless Chrome running (an orphan keeps animating and loads the machine).
process.on('exit', () => chrome.kill());
process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let k = 0; k < 50 && !target; k++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
let traceEvents = null; let traceDone = null;
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Tracing.dataCollected' && traceEvents) traceEvents.push(...m.params.value);
  if (m.method === 'Tracing.tracingComplete' && traceDone) traceDone();
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'log'].includes(m.params.type))
    console.log('console.' + m.params.type + ':', m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  if (m.method === 'Runtime.exceptionThrown') console.log('exception:', m.params.exceptionDetails.exception?.description?.slice(0, 600));
});
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const evalv = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
await send('Runtime.enable'); await send('Page.enable');
const mobile = +w < 600;
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: mobile ? 2 : 1, mobile });
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (process.env.REDUCE) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
const t0 = Date.now();
await send('Page.navigate', { url });
const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const touch = async (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
// A coordinate can be [x, y] or a JS expression string returning [x, y]; drags take two of those.
const pt = async (v) => (typeof v === 'string' ? await evalv(v) : v);
const pts = async (v) => (Array.isArray(v) && v.length === 4 && typeof v[0] === 'number' ? v : [...(await pt(v[0])), ...(await pt(v[1]))]);
// Screen point of a map lon/lat: G(lon, lat)
const G = (lon, lat) => `(()=>{const m=window.__map,r=m.getContainer().getBoundingClientRect(),p=m.project([${lon},${lat}]);return [r.left+p.x,r.top+p.y]})()`;
// Center of the first button whose text includes T: B(T)
const B = (t) => `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&b.textContent.includes(${JSON.stringify(t)}));const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`;
const expand = (v) => (typeof v === 'string' ? v.replace(/^G\(([-\d.]+),\s*([-\d.]+)\)$/, (_, a, b) => G(a, b)).replace(/^B\((.+)\)$/, (_, t) => B(t)) : Array.isArray(v) ? v.map(expand) : v);
for (const raw of steps) {
  const s = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, ['click', 'move', 'tap', 'drag', 'touchDrag'].includes(k) ? expand(v) : v]));
  if (s.wait) await sleep(s.wait);
  if (s.probe) {
    // Main-thread responsiveness: worst Runtime.evaluate round trip while polling.
    let worst = 0; const end = Date.now() + s.probe;
    while (Date.now() < end) { const a = Date.now(); await evalv('1'); worst = Math.max(worst, Date.now() - a); await sleep(100); }
    console.log(`probe: worst main-thread round trip ${worst} ms`);
  }
  if (s.waitFor) {
    const end = Date.now() + (s.timeout ?? 60000); let v;
    while (Date.now() < end && !(v = await evalv(s.waitFor))) await sleep(100);
    console.log(`waitFor ${s.waitFor.slice(0, 60)} -> ${JSON.stringify(v)} at ${Date.now() - t0} ms after navigate`);
  }
  if (s.click) {
    const [x, y] = await pt(s.click);
    await mouse('mouseMoved', x, y); await sleep(150);
    await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(400);
  }
  if (s.move) { await mouse('mouseMoved', ...(await pt(s.move))); await sleep(300); }
  if (s.tap) { await touch('touchStart', [await pt(s.tap)]); await sleep(60); await touch('touchEnd', []); await sleep(400); }
  if (s.drag) {
    const [x1, y1, x2, y2] = await pts(s.drag);
    await mouse('mouseMoved', x1, y1); await sleep(100); await mouse('mousePressed', x1, y1);
    for (let k = 1; k <= 10; k++) { await mouse('mouseMoved', x1 + ((x2 - x1) * k) / 10, y1 + ((y2 - y1) * k) / 10, { buttons: 1 }); await sleep(30); }
    await mouse('mouseReleased', x2, y2); await sleep(400);
  }
  if (s.touchDrag) {
    const [x1, y1, x2, y2] = await pts(s.touchDrag);
    await touch('touchStart', [[x1, y1]]);
    for (let k = 1; k <= 10; k++) { await touch('touchMove', [[x1 + ((x2 - x1) * k) / 10, y1 + ((y2 - y1) * k) / 10]]); await sleep(30); }
    await touch('touchEnd', []); await sleep(400);
  }
  if (s.key) {
    const key = s.key; const text = key.length === 1 ? key : key === 'Enter' ? '\r' : undefined;
    const codes = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Delete: 46, Escape: 27, Tab: 9, Backspace: 8 };
    const vk = codes[key] ?? key.toUpperCase().charCodeAt(0);
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key, text, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk });
    await sleep(200);
  }
  if (s.throttle) { await send('Emulation.setCPUThrottlingRate', { rate: s.throttle }); console.log(`cpu throttle ${s.throttle}x`); }
  if (s.trace) {
    traceEvents = [];
    const done = new Promise((r) => (traceDone = r));
    await send('Tracing.start', {
      categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink.user_timing', 'gpu', 'viz', 'benchmark', '__metadata'].join(','),
      transferMode: 'ReportEvents',
    });
    await sleep(s.trace);
    await send('Tracing.end');
    await done;
    const { summarize } = await import('./trace-stats.mjs');
    if (s.file) writeFileSync(s.file, JSON.stringify({ traceEvents }));
    console.log('trace:', JSON.stringify(summarize(traceEvents, s.from ?? 0)));
    if (!s.from) console.log('trace from 1 s:', JSON.stringify(summarize(traceEvents, 1000)));
    traceEvents = null;
  }
  if (s.eval) console.log('eval:', JSON.stringify(await evalv(s.eval)));
  if (s.shot) { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(s.shot, Buffer.from(data, 'base64')); console.log('saved', s.shot); }
}
ws.close(); chrome.kill();
process.exit(0);
