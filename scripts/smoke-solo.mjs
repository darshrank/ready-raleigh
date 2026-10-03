// M3 acceptance: Playwright plays one full solo game (5 rounds) at phone and TV sizes,
// checks numbers open source sheets, and saves screenshots of every phase.
// Usage: npm run dev (other terminal), then node scripts/smoke-solo.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = 'screenshots/m3';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};

for (const s of [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'tv', width: 1920, height: 1080, mobile: false },
]) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: s.mobile ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(base + '/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 90_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${s.name}-landing.png` });
  await page.click('[data-play-solo]');
  let total = 0;
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector('[data-lock]', { timeout: 30_000 });
    await page.waitForFunction(() => window.__rr.map.loaded() && !window.__rr.map.isMoving(), null, { timeout: 30_000 });
    await page.waitForTimeout(1200);
    const isPin = await page.locator('.pin-hint').count();
    if (isPin) {
      const box = await page.locator('#map').boundingBox();
      const x = box.x + box.width * 0.45;
      const y = box.y + box.height * (s.mobile ? 0.25 : 0.45);
      if (s.mobile) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      try {
        await page.waitForFunction(() => !document.querySelector('[data-lock]').disabled, null, { timeout: 5000 });
      } catch (e) {
        await page.screenshot({ path: `${out}/${s.name}-FAIL-pin.png` });
        const at = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return `${el.tagName}.${el.className}`; }, [x, y]);
        throw new Error(`pin not placed; element at tap point: ${at}`);
      }
    } else {
      await page.locator('.game-sheet .slider').fill('3');
    }
    if (i === 0) {
      await page.locator('.lens').first().click(); // use one lens in round 1 (−10%)
      await page.waitForTimeout(1500);
    }
    if (i < 2) await page.screenshot({ path: `${out}/${s.name}-round${i + 1}-${isPin ? 'pin' : 'estimate'}.png` });
    await page.click('[data-lock]');
    await page.waitForSelector('[data-next]', { timeout: 30_000 });
    await page.waitForTimeout(4000); // reveal sequence (guesses, ripple, camera, water)
    // The count-up ends on the server's number (slow software GL can stretch the animation).
    await page.waitForFunction(() => { const el = document.querySelector('.reveal__score'); return el && el.textContent.replace(/,/g, '') === el.dataset.final; }, null, { timeout: 30_000 });
    const score = Number((await page.locator('.reveal__score').textContent()).replace(/,/g, ''));
    check(Number.isFinite(score) && score >= 0 && score <= 5000, `[${s.name}] round ${i + 1}: score ${score}`);
    total += score;
    if (i < 2) await page.screenshot({ path: `${out}/${s.name}-reveal${i + 1}.png` });
    if (i === 0) {
      // Every number is tappable → source sheet.
      await page.locator('.reveal__answers .sourced').click();
      const dlg = page.getByRole('dialog');
      await dlg.waitFor();
      const txt = await dlg.textContent();
      check(/Dataset/.test(txt) && /Method/.test(txt) && /Date/.test(txt), `[${s.name}] answer opens a source sheet (dataset, date, method)`);
      await page.screenshot({ path: `${out}/${s.name}-source-sheet.png` });
      await page.keyboard.press('Escape');
      check(/lens/.test(await page.locator('.bchips').textContent()), `[${s.name}] lens penalty shown in breakdown`);
    }
    await page.click('[data-next]');
  }
  await page.waitForSelector('body[data-results="true"]', { timeout: 30_000 });
  await page.waitForFunction(() => { const el = document.querySelector('.results__total'); return el && el.textContent.replace(/,/g, '') === el.dataset.final; }, null, { timeout: 30_000 });
  const shown = Number((await page.locator('.results__total').textContent()).replace(/,/g, ''));
  check(shown === total, `[${s.name}] results total ${shown} = sum of round scores ${total}`);
  check((await page.locator('.results__list li').count()) === 5, `[${s.name}] results list has 5 rounds`);
  await page.screenshot({ path: `${out}/${s.name}-results.png` });
  check(errors.length === 0, `[${s.name}] no page errors ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}
await browser.close();
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
