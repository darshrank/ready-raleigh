import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, MAX_PLAYERS, PLAYER_STYLES } from '@rr/shared';
import { backToLobby, BRIEF_MS, lockGuess, nextRound, onPresence, publicState, REVEAL_MS, setReady, startParty, tick, updateSettings } from '../src/game.ts';
import type { PackRound } from '../src/pack.ts';
import { addPlayer, createRoom, GameError } from '../src/rooms.ts';

const base = { question: 'q', short: 's', square: [0, 0, 1, 1] as [number, number, number, number], source: { dataset: 'd', date: '2026', url: 'u', method: 'm' }, clues: [], explanation: 'e', interest: 1, camera: { center: [-78.65, 35.82] as [number, number], zoom: 15, pitch: 50, bearing: 0 }, type: 'A' as const, kind: 'depth_1pct', input: { kind: 'slider' as const, min: 0, max: 12, step: 0.5, units: 'ft' }, tolerance: { s: 3, units: 'ft', basis: 'b' }, truth: { value: 4 } };
const rounds = (n: number): PackRound[] => Array.from({ length: n }, (_, i) => ({ ...base, id: `r${i}` }));

function party() {
  const room = createRoom('party', { ...DEFAULT_SETTINGS, rounds: 3 }, []);
  const host = addPlayer(room, 'Host');
  host.ready = true;
  const a = addPlayer(room, 'Ana');
  const b = addPlayer(room, 'Ben');
  return { room, host, a, b };
}

test('12 distinct colour+shape pairs', () => {
  assert.equal(PLAYER_STYLES.length, MAX_PLAYERS);
  assert.equal(new Set(PLAYER_STYLES.map((p) => p.color)).size, MAX_PLAYERS);
  assert.equal(new Set(PLAYER_STYLES.map((p) => p.shape)).size, MAX_PLAYERS);
});

test('lobby: only the host changes settings / starts; everyone must be ready; names unique', () => {
  const { room, host, a, b } = party();
  assert.throws(() => addPlayer(room, 'ana'), /already has that name/);
  assert.throws(() => updateSettings(room, a, { ...room.settings, rounds: 7 }), /Only the host/);
  setReady(room, a, true);
  updateSettings(room, host, { ...room.settings, timerS: 30 });
  assert.equal(a.ready, false, 'changing settings asks players to re-confirm');
  assert.throws(() => startParty(room, a, rounds(3), 0), /Only the host/);
  assert.throws(() => startParty(room, host, rounds(3), 0), /Waiting for Ana, Ben/);
  setReady(room, a, true);
  setReady(room, b, true);
  startParty(room, host, rounds(3), 0);
  assert.equal(room.phase, 'brief');
});

test('round ends when every connected player locks; disconnected players do not block', () => {
  const { room, host, a, b } = party();
  setReady(room, a, true);
  setReady(room, b, true);
  startParty(room, host, rounds(3), 0);
  tick(room, BRIEF_MS);
  lockGuess(room, host, { value: 4 }, BRIEF_MS + 1000);
  lockGuess(room, a, { value: 2 }, BRIEF_MS + 2000);
  assert.equal(room.phase, 'play');
  b.connected = false;
  onPresence(room, BRIEF_MS + 3000);
  assert.equal(room.phase, 'reveal');
  const r = room.reveal!.results;
  assert.equal(r.length, 3);
  assert.equal(r.find((x) => x.seat === b.seat)!.score.final, 0);
  assert.ok(r.find((x) => x.seat === host.seat)!.score.final > r.find((x) => x.seat === a.seat)!.score.final);
});

test('late joiner spectates the current round and plays the next', () => {
  const { room, host, a, b } = party();
  setReady(room, a, true);
  setReady(room, b, true);
  startParty(room, host, rounds(3), 0);
  tick(room, BRIEF_MS);
  const late = addPlayer(room, 'Late');
  assert.equal(late.spectator, true);
  assert.throws(() => lockGuess(room, late, { value: 1 }, BRIEF_MS + 10), /next round/);
  for (const p of [host, a, b]) lockGuess(room, p, { value: 4 }, BRIEF_MS + 100);
  assert.equal(room.reveal!.results.length, 3, 'spectator not scored');
  nextRound(room, host, BRIEF_MS + 200);
  assert.equal(late.spectator, false);
  tick(room, BRIEF_MS * 3);
  for (const p of [host, a, b]) lockGuess(room, p, { value: 4 }, BRIEF_MS * 3 + 100);
  assert.equal(room.phase, 'play', 'round waits for the new player too');
  lockGuess(room, late, { value: 4 }, BRIEF_MS * 3 + 200);
  assert.equal(room.phase, 'reveal');
});

test('host leaves: host passes on; only the host advances; reveal auto-advances', () => {
  const { room, host, a, b } = party();
  setReady(room, a, true);
  setReady(room, b, true);
  startParty(room, host, rounds(3), 0);
  tick(room, BRIEF_MS);
  for (const p of [host, a, b]) lockGuess(room, p, { value: 4 }, BRIEF_MS + 100);
  assert.throws(() => nextRound(room, a, BRIEF_MS + 200), GameError);
  host.connected = false;
  onPresence(room, BRIEF_MS + 200);
  assert.equal(room.hostSeat, a.seat);
  assert.equal(publicState(room, a.id, 0).hostSeat, a.seat);
  assert.equal(tick(room, BRIEF_MS + 100 + REVEAL_MS + 1), true, 'nobody pressed Next: game moves on');
  assert.equal(room.phase, 'brief');
});

test('play again returns everyone to the lobby with scores reset', () => {
  const { room, host, a, b } = party();
  setReady(room, a, true);
  setReady(room, b, true);
  startParty(room, host, rounds(1), 0);
  tick(room, BRIEF_MS);
  for (const p of [host, a, b]) lockGuess(room, p, { value: 4 }, BRIEF_MS + 100);
  nextRound(room, host, BRIEF_MS + 200);
  assert.equal(room.phase, 'results');
  assert.throws(() => backToLobby(room, a), /Only the host/);
  backToLobby(room, host);
  assert.equal(room.phase, 'lobby');
  assert.ok(room.players.every((p) => p.total === 0 && !p.ready));
});
