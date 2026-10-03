import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceM, estimateBase, finalScore, lensMultiplier, MAX_SCORE, pinBase, rankPlayers, scoreRound, timeBonus } from '../src/scoring.ts';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('distance: 0.01° of latitude ≈ 1112 m', () => {
  near(distanceM([-78.65, 35.8], [-78.65, 35.81]), 1111.95, 0.5);
});

test('pin: exact hit = 5000; one scale away = 5000/e; nearest truth point counts', () => {
  near(pinBase([-78.65, 35.8], [[-78.65, 35.8]], 283).base, MAX_SCORE);
  const p = [-78.65, 35.81] as [number, number];
  const d = distanceM([-78.65, 35.8], p);
  near(pinBase([-78.65, 35.8], [p], d).base, MAX_SCORE / Math.E, 1e-9);
  const two = pinBase([-78.65, 35.8], [[-78.6, 35.8], [-78.65, 35.8005]], 283);
  near(two.d, 55.6, 0.2);
});

test('estimate: 5000·exp(−|g−t|/s), symmetric', () => {
  near(estimateBase(4.6, 4.6, 3.15).base, 5000);
  near(estimateBase(1.45, 4.6, 3.15).base, 5000 * Math.exp(-1));
  near(estimateBase(7.75, 4.6, 3.15).base, estimateBase(1.45, 4.6, 3.15).base);
});

test('lens penalty: ×0.9 per lens', () => {
  assert.equal(lensMultiplier(0), 1);
  near(lensMultiplier(1), 0.9);
  near(lensMultiplier(3), 0.729);
  near(finalScore(4000, 2, 999999, 60000).final, Math.round(4000 * 0.81));
});

test('time bonus: +5% at t=0, linear to 0 at T/3, none after', () => {
  near(timeBonus(0, 60000), 0.05);
  near(timeBonus(10000, 60000), 0.025);
  assert.equal(timeBonus(20000, 60000), 0);
  assert.equal(timeBonus(50000, 60000), 0);
  assert.equal(finalScore(3000, 0, 0, 60000).final, 3150);
});

test('cap: a perfect, fast round scores exactly 5000, never more', () => {
  assert.equal(finalScore(5000, 0, 0, 60000).final, MAX_SCORE);
  assert.equal(scoreRound({ kind: 'estimate', guess: 4.6, truth: 4.6, s: 3.15, units: 'ft' }, 0, 1, 60000).final, 5000);
});

test('no guess scores 0 but still reports the lens multiplier', () => {
  const s = scoreRound({ kind: 'pin', guess: null, truth: [[-78.65, 35.8]], s: 283 }, 1, null, 60000);
  assert.equal(s.final, 0);
  assert.equal(s.error, null);
  near(s.lensMultiplier, 0.9);
});

test('ties: equal totals are broken by earlier total lock-in time', () => {
  assert.deepEqual(rankPlayers([{ seat: 0, total: 9000, lockMs: 30000 }, { seat: 1, total: 9000, lockMs: 12000 }, { seat: 2, total: 9500, lockMs: 90000 }]), [2, 1, 0]);
});
