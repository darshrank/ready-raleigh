import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '@rr/shared';
import { BRIEF_MS, lockGuess, nextRound, publicState, startGame, tick, useLens } from '../src/game.ts';
import { drawRounds, rng, type PackRound } from '../src/pack.ts';
import { addPlayer, createRoom, GameError } from '../src/rooms.ts';

const base = { question: 'q', short: 's', square: [0, 0, 1, 1] as [number, number, number, number], source: { dataset: 'd', date: '2026', url: 'u', method: 'm' }, clues: ['creek_low_bowl'], explanation: 'because', interest: 1 };
const A = (id: string, x: number): PackRound => ({ ...base, id, type: 'A', kind: 'depth_1pct', camera: { center: [-78.65 + x, 35.82], zoom: 17, pitch: 60, bearing: 0 }, input: { kind: 'slider', min: 0, max: 12, step: 0.5, units: 'ft' }, tolerance: { s: 3, units: 'ft', basis: 'b' }, truth: { value: 4 } });
const B = (id: string, x: number): PackRound => ({ ...base, id, type: 'B', kind: 'first_road', camera: { center: [-78.65 + x, 35.82], zoom: 15, pitch: 50, bearing: 0 }, input: { kind: 'pin' }, tolerance: { s: 283, units: 'm', basis: 'b' }, truth: { points: [[-78.65 + x, 35.82]] } });
const BANK = [A('a1', 0), A('a2', 0.02), A('a3', 0.04), B('b1', 0.01), B('b2', 0.03), B('b3', 0.05)];

function solo(rounds = 3) {
  const room = createRoom('solo', { ...DEFAULT_SETTINGS, rounds }, drawRounds(BANK, rounds, rng(1)));
  const p = addPlayer(room, 'Ana');
  return { room, p };
}

test('draws alternate A, B, A and are reproducible with a seed', () => {
  const d1 = drawRounds(BANK, 3, rng(42)).map((r) => r.id);
  const d2 = drawRounds(BANK, 3, rng(42)).map((r) => r.id);
  assert.deepEqual(d1, d2);
  assert.deepEqual(drawRounds(BANK, 3, rng(42)).map((r) => r.type), ['A', 'B', 'A']);
});

test('truth is hidden until the reveal', () => {
  const { room, p } = solo();
  startGame(room, 0);
  tick(room, BRIEF_MS);
  const s = publicState(room, p.id, BRIEF_MS);
  assert.equal(s.phase, 'play');
  assert.ok(s.round);
  assert.ok(!('truth' in s.round!));
  assert.ok(!('explanation' in s.round!));
  assert.equal(s.reveal, null);
  assert.ok(!JSON.stringify(s).includes('because'));
});

test('a full solo game: brief → play → reveal … → results, scores add up', () => {
  const { room, p } = solo(3);
  startGame(room, 0);
  let now = 0;
  const totals: number[] = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(room.phase, 'brief');
    assert.equal(tick(room, now + BRIEF_MS - 1), false);
    now += BRIEF_MS;
    assert.equal(tick(room, now), true);
    assert.equal(room.phase, 'play');
    const r = room.rounds[i]!;
    now += 5000;
    lockGuess(room, p, r.input.kind === 'pin' ? { point: r.truth.points![0] } : { value: r.truth.value }, now);
    assert.equal(room.phase, 'reveal', 'solo player locking ends the round');
    const res = room.reveal!.results[0]!;
    assert.equal(res.score.final, 5000, 'perfect guess, fast lock → capped at 5000');
    totals.push(res.score.final);
    nextRound(room, p, now);
  }
  assert.equal(room.phase, 'results');
  assert.equal(p.total, totals.reduce((a, b) => a + b, 0));
  assert.equal(publicState(room, p.id, now).history.length, 3);
});

test('timer runs out: unlocked player scores 0', () => {
  const { room, p } = solo();
  startGame(room, 0);
  tick(room, BRIEF_MS);
  assert.equal(tick(room, BRIEF_MS + 60_000), true);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.reveal!.results[0]!.score.final, 0);
  assert.equal(p.total, 0);
});

test('lenses: each costs 10%; not allowed under "no lenses" rules or after locking', () => {
  const { room, p } = solo();
  startGame(room, 0);
  tick(room, BRIEF_MS);
  useLens(room, p, 'elevation');
  useLens(room, p, 'elevation'); // same lens twice counts once
  useLens(room, p, 'water');
  const r = room.rounds[0]!;
  lockGuess(room, p, { value: r.truth.value }, BRIEF_MS + 59_000);
  assert.equal(room.reveal!.results[0]!.score.final, Math.round(5000 * 0.81));
  assert.throws(() => useLens(room, p, 'people'), GameError);

  const { room: r2, p: p2 } = solo();
  r2.settings.rules = 'no_lenses';
  startGame(r2, 0);
  tick(r2, BRIEF_MS);
  assert.throws(() => useLens(r2, p2, 'water'), /Lenses are off/);
});

test('slider guesses are clamped to the input range; bad pins are rejected', () => {
  const { room, p } = solo();
  startGame(room, 0);
  tick(room, BRIEF_MS);
  lockGuess(room, p, { value: 99 }, BRIEF_MS + 1);
  assert.equal(room.reveal!.results[0]!.guess!.value, 12);
  nextRound(room, p, BRIEF_MS + 2);
  tick(room, BRIEF_MS * 3);
  assert.throws(() => lockGuess(room, p, { point: [500, 1] }, BRIEF_MS * 3 + 1), /off the map/);
  assert.throws(() => lockGuess(room, p, {}, BRIEF_MS * 3 + 1), /Drop a pin/);
});

test('actions in the wrong phase are rejected', () => {
  const { room, p } = solo();
  assert.throws(() => lockGuess(room, p, { value: 1 }, 0), GameError);
  startGame(room, 0);
  assert.throws(() => nextRound(room, p, 0), GameError);
});
