// M4 acceptance: 3 phones + 1 TV play a 5-round party game. Reveals on the TV show every player's
// guess; scores on the TV match each phone; killing and reopening a phone tab resumes the game.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = 'screenshots/m4';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};
const errors = [];
const phoneCtx = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  return page;
};
const ready = (page) => page.waitForSelector('body[data-ready="true"]', { timeout: 90_000 });

// Host creates the room.
const hostCtx = await phoneCtx();
const host = watch(await hostCtx.newPage(), 'host');
await host.goto(base + '/');
await ready(host);
await host.click('[data-party]');
await host.fill('#join-name', 'Hana');
await host.click('[data-join-submit]');
await host.waitForSelector('.lobby__code');
const code = (await host.locator('.lobby__code').textContent()).trim();
check(/^[A-Z2-9]{4}$/.test(code), `room created: ${code}`);

// TV joins.
const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const tv = watch(await tvCtx.newPage(), 'tv');
await tv.goto(`${base}/tv/${code}`);
await tv.waitForSelector('.lobby--tv');

// Player 2 via the QR link, player 3 via "Join with code".
const p2Ctx = await phoneCtx();
const p2 = watch(await p2Ctx.newPage(), 'p2');
await p2.goto(`${base}/r/${code}`);
await ready(p2);
await p2.fill('#join-name', 'Omar');
await p2.click('[data-join-submit]');
let p3Ctx = await phoneCtx();
let p3 = watch(await p3Ctx.newPage(), 'p3');
await p3.goto(base + '/');
await ready(p3);
await p3.click('[data-join]');
await p3.fill('#join-code', code.toLowerCase());
await p3.fill('#join-name', 'Lin');
await p3.click('[data-join-submit]');

await tv.waitForFunction(() => document.querySelectorAll('.avatar').length === 3, null, { timeout: 15_000 });
check(true, 'TV lobby shows 3 avatars');
check((await host.locator('[data-start]').isDisabled()) === true, 'host cannot start until everyone is ready');
await p2.click('[data-ready-btn]');
await p3.click('[data-ready-btn]');
try {
  await host.waitForFunction(() => !document.querySelector('[data-start]').disabled, null, { timeout: 10_000 });
} catch (e) {
  for (const [n, pg] of [['host', host], ['p2', p2], ['p3', p3]]) console.log(n, pg.url(), (await pg.locator('#ui').innerText()).replace(/\s+/g, ' ').slice(0, 300));
  throw e;
}
await tv.waitForTimeout(1500);
await tv.screenshot({ path: `${out}/tv-lobby.png` });
await host.screenshot({ path: `${out}/phone-lobby-host.png` });
await p2.screenshot({ path: `${out}/phone-lobby-player.png` });
await host.click('[data-start]');

let phones = [host, p2, p3];
for (let i = 0; i < 5; i++) {
  if (i === 2) {
    // Kill Lin's tab and reopen the join link: the stored session resumes the game.
    await p3.close();
    p3 = watch(await p3Ctx.newPage(), 'p3-reopened');
    await p3.goto(`${base}/r/${code}`);
    await ready(p3);
    phones = [host, p2, p3];
  }
  for (const ph of phones) await ph.waitForSelector('[data-lock]', { timeout: 40_000 });
  if (i === 2) check(true, 'reopened phone tab resumed into the running game');
  await host.waitForTimeout(1200);
  const isPin = (await host.locator('.pin-hint').count()) > 0;
  for (const [k, ph] of phones.entries()) {
    if (isPin) {
      const box = await ph.locator('#map').boundingBox();
      await ph.touchscreen.tap(box.x + box.width * (0.3 + 0.2 * k), box.y + box.height * 0.25);
      await ph.waitForFunction(() => !document.querySelector('[data-lock]').disabled, null, { timeout: 8000 });
    } else {
      await ph.locator('.game-sheet .slider').fill(String(2 + k));
    }
    if (i === 0 && k === 0) await tv.screenshot({ path: `${out}/tv-play.png` });
    await ph.click('[data-lock]');
  }
  await tv.waitForFunction((n) => document.body.dataset.revealRound === String(n), i, { timeout: 30_000 });
  await tv.waitForTimeout(4500);
  const rows = await tv.locator('.board__row').count();
  check(rows === 3, `round ${i + 1}: TV scoreboard lists all 3 players`);
  if (isPin) {
    const g = Number(await tv.evaluate(() => document.body.dataset.revealGuesses));
    check(g === 3, `round ${i + 1}: TV reveal shows all 3 coloured guesses (${g})`);
  }
  check((await p2.locator('[data-next]').count()) === 0, `round ${i + 1}: only the host has "Next"`);
  if (i < 2) await tv.screenshot({ path: `${out}/tv-reveal${i + 1}-${isPin ? 'pin' : 'estimate'}.png` });
  if (i === 0) await p2.screenshot({ path: `${out}/phone-controller-reveal.png` });
  // Party reveals auto-advance after 25 s; slow software-GL screenshots can take longer than that.
  try {
    await host.click('[data-next]', { timeout: 3000 });
  } catch (e) {
    console.log('next click failed:', e.message.split('\n').filter((l) => /intercepts|outside|not visible|not stable|waiting for|retrying/.test(l)).slice(-3).join(' | '));
    await host.screenshot({ path: `${out}/_host-next-r${i + 1}.png` });
    const moved = await tv.evaluate((n) => document.body.dataset.revealRound !== String(n) || !!document.querySelector('.podium') || !document.querySelector('.board'), i);
    check(moved || (await host.locator('[data-lock], .podium').count()) > 0, `round ${i + 1}: reveal auto-advanced after 25 s (host didn't press Next)`);
  }
}

await tv.waitForSelector('.podium', { timeout: 30_000 });
await tv.waitForTimeout(1500);
await tv.screenshot({ path: `${out}/tv-results.png` });
await host.screenshot({ path: `${out}/phone-results-host.png` });
const tvScores = await tv.$$eval('.board__row', (rows) => rows.map((r) => [r.dataset.seat, r.querySelector('.board__score').textContent]));
for (const [k, ph] of phones.entries()) {
  await ph.waitForSelector('.board__row');
  const mine = await ph.$$eval('.board__row', (rows) => rows.map((r) => [r.dataset.seat, r.querySelector('.board__score').textContent]));
  check(JSON.stringify(mine) === JSON.stringify(tvScores), `phone ${k + 1} scoreboard matches the TV (${tvScores.map((x) => x[1]).join(', ')})`);
}
check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
