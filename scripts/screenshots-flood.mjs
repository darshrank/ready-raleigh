// M2 acceptance: /debug/flood shows a stage slider raising water over 3D buildings.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://localhost:5173') + '/debug/flood?area=crabtree';
const out = 'screenshots/m2';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};
for (const s of [
  { name: 'phone-390x844', width: 390, height: 844, mobile: true },
  { name: 'tv-1920x1080', width: 1920, height: 1080, mobile: false },
]) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: s.mobile ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 90_000 });
  const idle = () => page.waitForFunction(() => { const m = window.__rr.map; return m.loaded() && m.areTilesLoaded() && !m.isMoving(); }, null, { timeout: 90_000 });
  await idle();
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const m = window.__rr.map;
    const water = m.querySourceFeatures('water').length;
    const bld = m.queryRenderedFeatures({ layers: ['pack-buildings-3d'] }).length;
    return { water, bld, stage: document.body.dataset.stage, text: document.querySelector('.stage__num')?.textContent };
  });
  check(info.water > 0, `[${s.name}] water polygons drawn at ${info.text} (${info.water} features)`);
  check(info.bld > 0, `[${s.name}] pack buildings rendered in 3D (${info.bld} visible)`);
  await page.screenshot({ path: `${out}/${s.name}-1pct.png` });
  // Move the slider down to a low stage: water must shrink.
  await page.evaluate(() => { const el = document.querySelector('.slider'); el.value = '30'; el.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.body.dataset.stage === '30', null, { timeout: 30_000 });
  await idle();
  await page.waitForTimeout(800);
  const low = await page.evaluate(() => ({ text: document.querySelector('.stage__num')?.textContent, area: document.querySelector('.stat__v')?.textContent }));
  check(low.text === '15.0 ft', `[${s.name}] slider moves to ${low.text}; wet area ${low.area}`);
  await page.screenshot({ path: `${out}/${s.name}-15ft.png` });
  check(errors.length === 0, `[${s.name}] no page errors ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close();
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
