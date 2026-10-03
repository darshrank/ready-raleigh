// Room store, joining/resuming, and the state each client sees.
// Ported from pocket-rivals server/rooms.js (MIT): codes without look-alike characters,
// secret player ids for resuming after a phone sleeps, per-viewer public state, TTL sweep.
import crypto from 'node:crypto';
import { MAX_PLAYERS, PLAYER_STYLES, type GameSettings, type GuessInput, type LensId, type Phase, type Reveal } from '@rr/shared';
import type { PackRound } from './pack.ts';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
export { MAX_PLAYERS };

export class GameError extends Error {}

export interface Player {
  id: string; // secret; used to resume
  seat: number;
  name: string;
  connected: boolean;
  socketId: string | null;
  total: number;
  lockMsTotal: number;
  guess: GuessInput | null;
  lockedAt: number | null;
  lenses: LensId[];
  ready: boolean;
  spectator: boolean;
}

export interface Room {
  code: string;
  mode: 'solo' | 'party';
  phase: Phase;
  settings: GameSettings;
  rounds: PackRound[]; // drawn for this game (truth included — never sent before reveal)
  roundIndex: number;
  briefUntil: number | null;
  playStartedAt: number | null;
  deadline: number | null;
  players: Player[];
  reveal: Reveal | null;
  history: Reveal[];
  hostSeat: number;
  tvSockets: Set<string>;
  revealUntil: number | null;
  touchedAt: number;
}

export const rooms = new Map<string, Room>();

function makeCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

export function cleanName(name: unknown, fallback?: string): string {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!n && fallback) return fallback;
  if (!n) throw new GameError('Please enter your name.');
  return n;
}

export function createRoom(mode: Room['mode'], settings: GameSettings, rounds: PackRound[]): Room {
  const room: Room = {
    code: makeCode(),
    mode,
    phase: 'lobby',
    settings,
    rounds,
    roundIndex: 0,
    briefUntil: null,
    playStartedAt: null,
    deadline: null,
    players: [],
    reveal: null,
    history: [],
    hostSeat: 0,
    tvSockets: new Set(),
    revealUntil: null,
    touchedAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code: unknown): Room {
  const room = rooms.get(String(code ?? '').trim().toUpperCase());
  if (!room) throw new GameError('Room not found. Check the code?');
  return room;
}

/** Join a room. Mid-game joiners spectate the current round and play from the next. */
export function addPlayer(room: Room, name: string): Player {
  if (room.players.length >= MAX_PLAYERS) throw new GameError(`That room is full (${MAX_PLAYERS} players).`);
  if (room.mode === 'solo' && room.players.length) throw new GameError('That is a solo game.');
  if (room.phase === 'results') throw new GameError('That game just ended — ask the host for a new room.');
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new GameError('Someone here already has that name.');
  const player: Player = {
    id: crypto.randomUUID(),
    seat: room.players.length,
    name,
    connected: true,
    socketId: null,
    total: 0,
    lockMsTotal: 0,
    guess: null,
    lockedAt: null,
    lenses: [],
    ready: false,
    spectator: room.phase !== 'lobby',
  };
  room.players.push(player);
  touch(room);
  return player;
}

export function findPlayer(room: Room, playerId: unknown): Player {
  const p = room.players.find((pl) => pl.id === playerId);
  if (!p) throw new GameError('You are not in this room.');
  return p;
}

export function touch(room: Room): void {
  room.touchedAt = Date.now();
}

export function styleFor(seat: number) {
  return PLAYER_STYLES[seat % PLAYER_STYLES.length]!;
}

export function sweepOldRooms(now = Date.now()): void {
  for (const [code, room] of rooms) if (now - room.touchedAt > ROOM_TTL_MS) rooms.delete(code);
}
