// Phase machine (pattern from pocket-rivals server/game.js, MIT): synchronous actions validate
// and record input; `tick(room, now)` moves time-driven phases. Deterministic given `now`.
//
// lobby → brief → play → reveal → brief → … → results
import { LENSES, type GameSettings, type GuessInput, type LensId, type LngLat, type PlayerRoundResult, type PublicState } from '@rr/shared';
import { publicRound, type PackRound } from './pack.ts';
import { GameError, styleFor, touch, type Player, type Room } from './rooms.ts';
import { rankPlayers, scoreRound } from './scoring.ts';

export const BRIEF_MS = 3500;
/** Party reveals advance on their own after this long if the host doesn't press Next. */
export const REVEAL_MS = 25_000;

function requirePhase(room: Room, phase: Room['phase']): void {
  if (room.phase !== phase) throw new GameError(`Can't do that right now (game is in "${room.phase}").`);
}

const current = (room: Room): PackRound => room.rounds[room.roundIndex]!;
const active = (room: Room) => room.players.filter((p) => p.connected && !p.spectator);
const isHost = (room: Room, p: Player) => room.hostSeat === p.seat;

export function startGame(room: Room, now: number): void {
  requirePhase(room, 'lobby');
  if (!room.players.length) throw new GameError('Nobody is here yet.');
  if (!room.rounds.length) throw new GameError('No rounds available for this map.');
  room.roundIndex = 0;
  beginBrief(room, now);
}

// ------------------------------------------------------------------ party lobby
export function setReady(room: Room, player: Player, ready: boolean): void {
  requirePhase(room, 'lobby');
  player.ready = Boolean(ready);
  touch(room);
}

export function updateSettings(room: Room, player: Player, settings: GameSettings): void {
  requirePhase(room, 'lobby');
  if (!isHost(room, player)) throw new GameError('Only the host can change settings.');
  room.settings = settings;
  for (const p of room.players) if (!isHost(room, p)) p.ready = false; // settings changed: re-confirm
  touch(room);
}

/** Host starts once every connected player is ready. `rounds` are drawn by the caller (pack). */
export function startParty(room: Room, player: Player, rounds: Room['rounds'], now: number): void {
  requirePhase(room, 'lobby');
  if (!isHost(room, player)) throw new GameError('Only the host can start.');
  const waiting = room.players.filter((p) => p.connected && !isHost(room, p) && !p.ready);
  if (waiting.length) throw new GameError(`Waiting for ${waiting.map((p) => p.name).join(', ')} to be ready.`);
  room.rounds = rounds;
  startGame(room, now);
}

/** Party: back to the lobby with the same people (and anyone who was spectating). */
export function backToLobby(room: Room, player: Player): void {
  requirePhase(room, 'results');
  if (!isHost(room, player)) throw new GameError('Only the host can start a new game.');
  room.phase = 'lobby';
  room.history = [];
  room.reveal = null;
  room.roundIndex = 0;
  for (const p of room.players) {
    p.total = 0;
    p.lockMsTotal = 0;
    p.spectator = false;
    p.ready = false;
    p.guess = null;
    p.lockedAt = null;
    p.lenses = [];
  }
  touch(room);
}

/** Connection changes: hand host to the next connected player; a round ends if everyone left has locked. */
export function onPresence(room: Room, now: number): void {
  const host = room.players[room.hostSeat];
  if (!host?.connected) {
    const next = room.players.find((p) => p.connected && !p.spectator) ?? room.players.find((p) => p.connected);
    if (next) room.hostSeat = next.seat;
  }
  if (room.phase === 'play') {
    const act = active(room);
    if (act.length && act.every((p) => p.lockedAt !== null)) endPlay(room, now);
  }
}

function beginBrief(room: Room, now: number): void {
  room.phase = 'brief';
  room.reveal = null;
  room.briefUntil = now + BRIEF_MS;
  room.deadline = null;
  room.playStartedAt = null;
  room.revealUntil = null;
  for (const p of room.players) {
    p.spectator = false; // mid-game joiners play from the next round
    p.guess = null;
    p.lockedAt = null;
    p.lenses = [];
  }
  touch(room);
}

function beginPlay(room: Room, now: number): void {
  room.phase = 'play';
  room.playStartedAt = now;
  room.deadline = now + room.settings.timerS * 1000;
  room.briefUntil = null;
  touch(room);
}

export function useLens(room: Room, player: Player, lens: LensId): void {
  requirePhase(room, 'play');
  if (!LENSES.includes(lens)) throw new GameError('Unknown lens.');
  if (room.settings.rules !== 'normal') throw new GameError('Lenses are off in this game.');
  if (player.lockedAt !== null) throw new GameError('You already locked in.');
  if (player.spectator) throw new GameError('You join in next round.');
  if (!player.lenses.includes(lens)) player.lenses.push(lens);
  touch(room);
}

function validGuess(round: PackRound, input: GuessInput): GuessInput {
  if (round.input.kind === 'slider') {
    const v = Number(input.value);
    if (!Number.isFinite(v)) throw new GameError('Move the slider to make a guess.');
    const { min, max } = round.input;
    return { value: Math.min(max, Math.max(min, v)) };
  }
  const p = input.point;
  if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new GameError('Drop a pin on the map first.');
  const [lon, lat] = p as LngLat;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new GameError('That pin is off the map.');
  return { point: [lon, lat] };
}

export function lockGuess(room: Room, player: Player, input: GuessInput, now: number): void {
  requirePhase(room, 'play');
  if (player.spectator) throw new GameError('You join in next round — watch this one.');
  if (player.lockedAt !== null) throw new GameError('You already locked in.');
  player.guess = validGuess(current(room), input);
  player.lockedAt = now;
  touch(room);
  if (active(room).every((p) => p.lockedAt !== null)) endPlay(room, now);
}

function endPlay(room: Room, now: number): void {
  const round = current(room);
  const timerMs = room.settings.timerS * 1000;
  const results: PlayerRoundResult[] = room.players.filter((p) => !p.spectator).map((p) => {
    const msToLock = p.lockedAt === null ? null : p.lockedAt - (room.playStartedAt ?? now);
    const score =
      round.input.kind === 'pin'
        ? scoreRound({ kind: 'pin', guess: p.guess?.point ?? null, truth: round.truth.points ?? [], s: round.tolerance.s }, p.lenses.length, msToLock, timerMs)
        : scoreRound({ kind: 'estimate', guess: p.guess?.value ?? null, truth: round.truth.value ?? 0, s: round.tolerance.s, units: round.input.units }, p.lenses.length, msToLock, timerMs);
    p.total += score.final;
    p.lockMsTotal += msToLock ?? timerMs;
    return { seat: p.seat, guess: p.guess, lenses: [...p.lenses], msToLock, score };
  });
  room.reveal = { roundId: round.id, short: round.short, kind: round.kind, truth: round.truth, explanation: round.explanation, clues: round.clues, results };
  room.history.push(room.reveal);
  room.phase = 'reveal';
  room.deadline = null;
  room.revealUntil = room.mode === 'party' ? now + REVEAL_MS : null;
  touch(room);
}

export function nextRound(room: Room, player: Player | null, now: number): void {
  requirePhase(room, 'reveal');
  if (room.mode === 'party' && player && !isHost(room, player)) throw new GameError('Only the host can continue.');
  if (room.roundIndex >= room.rounds.length - 1) {
    room.phase = 'results';
    room.reveal = null;
    touch(room);
    return;
  }
  room.roundIndex += 1;
  beginBrief(room, now);
}

/** Advance time-driven phases. Returns true if the phase changed (caller broadcasts). */
export function tick(room: Room, now: number): boolean {
  if (room.phase === 'brief' && room.briefUntil !== null && now >= room.briefUntil) {
    beginPlay(room, now);
    return true;
  }
  if (room.phase === 'play' && room.deadline !== null && now >= room.deadline) {
    endPlay(room, now);
    return true;
  }
  if (room.phase === 'reveal' && room.revealUntil !== null && now >= room.revealUntil) {
    nextRound(room, null, now);
    return true;
  }
  return false;
}

export function ranking(room: Room): number[] {
  return rankPlayers(room.players.map((p) => ({ seat: p.seat, total: p.total, lockMs: p.lockMsTotal })));
}

/** What one player may see. Truth only appears inside `reveal` / `history`. */
export function publicState(room: Room, viewerId: string | null, now: number, joinBase = ''): PublicState {
  const you = room.players.find((p) => p.id === viewerId) ?? null;
  const round = room.rounds[room.roundIndex];
  return {
    code: room.code,
    mode: room.mode,
    phase: room.phase,
    settings: room.settings,
    roundIndex: room.roundIndex,
    totalRounds: room.rounds.length,
    round: round && room.phase !== 'lobby' && room.phase !== 'results' ? publicRound(round) : null,
    briefUntil: room.briefUntil,
    deadline: room.deadline,
    serverNow: now,
    you: you?.seat ?? null,
    yourGuess: you?.guess ?? null,
    players: room.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      ...styleFor(p.seat),
      score: p.total,
      locked: p.lockedAt !== null,
      lensesUsed: room.phase === 'play' && p !== you ? [] : p.lenses,
      connected: p.connected,
      ready: p.ready,
      spectator: p.spectator,
    })),
    reveal: room.phase === 'reveal' ? room.reveal : null,
    history: room.phase === 'results' ? room.history : [],
    ranking: ranking(room),
    hostSeat: room.hostSeat,
    tvConnected: room.tvSockets.size > 0,
    revealUntil: room.revealUntil,
    joinUrl: `${joinBase}/r/${room.code}`,
  };
}
