// M0 acceptance: open the client at phone and TV sizes, verify the 3D map
// (terrain on, pitch 55°, bearing snaps to 45° after a drag-rotate), and save screenshots.
// Usage: npm run dev (in another terminal), then npm run screenshots [-- --url http://localhost:5173]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5173';
const out = 'screenshots/m0';
mkdirSync(out, { recursive: true });

const sizes = [
  { name: 'phone-390x844', width: 390, height: 844, mobile: true },
  { name: 'tv-1920x1080', width: 1920, height: 1080, mobile: false },
];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};

for (const s of sizes) {
  // Reduced motion: the landing orbit is off, so camera checks are deterministic.
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: s.mobile ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  const waitIdle = () =>
    page.waitForFunction(() => {
      const m = window.__rr.map;
      return m.loaded() && m.areTilesLoaded() && !m.isMoving();
    }, null, { timeout: 60_000 });
  await waitIdle();
  await page.waitForTimeout(1500);

  const st = await page.evaluate(() => {
    const m = window.__rr.map;
    const c = m.getCenter();
    return {
      pitch: m.getPitch(),
      bearing: m.getBearing(),
      terrain: m.getTerrain(),
      elevAtCenter: m.queryTerrainElevation(c),
      has3dBuildings: Boolean(m.getLayer('building-3d')),
      fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    };
  });
  check(Math.abs(st.pitch - 55) < 0.01, `[${s.name}] pitch = ${st.pitch}`);
  check(st.terrain?.source === 'terrain-dem' && st.terrain.exaggeration === 1.4, `[${s.name}] terrain = ${JSON.stringify(st.terrain)}`);
  check(typeof st.elevAtCenter === 'number' && st.elevAtCenter > 0, `[${s.name}] terrain elevation at center = ${st.elevAtCenter?.toFixed(1)} m (exaggerated)`);
  check(st.has3dBuildings, `[${s.name}] 3D building layer present`);
  check(st.fonts.some((f) => /Space Grotesk/.test(f)) && st.fonts.some((f) => /Inter/.test(f)), `[${s.name}] fonts loaded: ${[...new Set(st.fonts)].join(', ')}`);
  await page.screenshot({ path: `${out}/${s.name}.png` });

  if (!s.mobile) {
    // Wait until camera animations finish (software GL can be slow at 1080p).
    const settle = async () => {
      await page.waitForTimeout(100);
      await page.waitForFunction(() => !window.__rr.map.isMoving(), null, { timeout: 15_000 });
      return page.evaluate(() => window.__rr.map.getBearing());
    };
    // Release after a free drag-rotate: the handler sees rotateend with a mouse event.
    const release = (deg) =>
      page.evaluate(async (deg) => {
        const m = window.__rr.map;
        m.fire('rotatestart', { originalEvent: new MouseEvent('mousedown') });
        m.setBearing(deg);
        m.fire('rotateend', { originalEvent: new MouseEvent('mouseup') });
      }, deg).then(settle);
    for (const [deg, want] of [[31, 45], [-17, 0], [-70, -90], [160, 180]]) {
      const got = await release(deg);
      check(Math.abs(got - want) < 0.01, `[${s.name}] drag released at ${deg}° → snaps to ${got.toFixed(1)}° (want ${want})`);
    }

    // Real keyboard input: Shift+→ must advance a full 45° step, not snap back.
    await page.evaluate(() => window.__rr.map.setBearing(0));
    await page.locator('.maplibregl-canvas').focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(500); // keyboard ease (300 ms) then our snap ease
    const kb = await settle();
    check(Math.abs(Math.abs(kb) - 45) < 0.01, `[${s.name}] Shift+→ rotates one 45° step: ${kb.toFixed(1)}°`);
    const b = kb;

    await page.getByRole('button', { name: 'Rotate right 45°' }).click();
    const b2 = await settle();
    check(Math.abs(((b2 - b + 540) % 360) - 180 - 45) < 0.01, `[${s.name}] "Rotate right" button turns +45°: ${b.toFixed(0)} → ${b2.toFixed(0)}`);
    await waitIdle();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${s.name}-rotated.png` });
  }
  check(errors.length === 0, `[${s.name}] no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

// Error state: block the basemap style and confirm the styled error card + retry.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/styles/liberty', (r) => r.abort());
  await page.goto(url);
  const alert = page.getByRole('alert');
  await alert.waitFor({ timeout: 20_000 });
  check(await alert.getByRole('button', { name: 'Try again' }).isVisible(), '[error-state] error card with retry shown when basemap fails');
  await page.screenshot({ path: `${out}/phone-error-state.png` });
  await ctx.close();
}

// Loading state: hold the style request open.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/styles/liberty', () => {}); // never resolves
  await page.goto(url);
  await page.getByRole('status').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(700);
  check(true, '[loading-state] loading overlay shown while basemap loads');
  await page.screenshot({ path: `${out}/phone-loading-state.png` });
  await ctx.close();
}

await browser.close();
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
