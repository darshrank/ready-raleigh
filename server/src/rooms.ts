// Room state machine for P9 (pattern ported from the aum branch, pocket-rivals MIT): synchronous
// actions validate and record input, tick(room, now) moves time. No sockets in here, so it is
// easy to test; roomSocket.ts wires it to /ws/rooms/:code.
//
// lobby -> planning -> results -> lobby (next election)
import { randomUUID } from 'node:crypto';
import {
  CANDIDATES, LOCK_GRACE_MS, MAX_PLAYERS, PLANNING_SECONDS, ROOM_CITIES, isCityId,
  type CandidateId, type CityId, type Placement, type Plan, type RoomResult, type RoomState, type ScoreResult,
} from '@shared';

const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
/** Same alphabet as the landing page's codes: no I or O, so codes read cleanly off a projector. */
export const CODE_RE = /^[A-HJ-NP-Z]{4}$/;

export class RoomError extends Error {}

export interface Player {
  id: string; // secret, lets a reloaded phone resume
  seat: number;
  name: string;
  candidate: CandidateId;
  connected: boolean;
  lockedAt: number | null;
  placements: Placement[] | null;
  result: ScoreResult | null;
  /** This round's stored play (its civic record and cards), set by the scorer. */
  playId: string | null;
}

export interface Room {
  code: string;
  phase: RoomState['phase'];
  /** The city of the next (or current) election; the host picks it in the lobby. */
  city: CityId;
  round: number;
  endsAt: number | null;
  players: Player[];
  results: RoomResult[] | null;
  hostSeat: number;
  touchedAt: number;
}

/** Scores a plan with the server's engine; throws on an invalid plan. */
export type Scorer = (plan: Plan) => ScoreResult;

export const rooms = new Map<string, Room>();

export function getOrCreateRoom(code: string, now = Date.now()): Room {
  const c = code.toUpperCase();
  if (!CODE_RE.test(c)) throw new RoomError('Room codes are 4 letters.');
  let room = rooms.get(c);
  if (!room) {
    room = { code: c, phase: 'lobby', city: 'raleigh', round: 0, endsAt: null, players: [], results: null, hostSeat: 0, touchedAt: now };
    rooms.set(c, room);
  }
  return room;
}

export function getRoom(code: string): Room {
  const room = rooms.get(code.toUpperCase());
  if (!room) throw new RoomError('Room not found. Check the code with the host.');
  return room;
}

const touch = (room: Room, now = Date.now()) => void (room.touchedAt = now);

function cleanName(name: unknown): string {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!n) throw new RoomError('Enter your name.');
  return n;
}

function checkCandidate(room: Room, candidate: unknown, self?: Player): CandidateId {
  if (!CANDIDATES.includes(candidate as CandidateId)) throw new RoomError('Pick a candidate.');
  if (room.players.some((p) => p !== self && p.candidate === candidate)) throw new RoomError('That candidate is taken.');
  return candidate as CandidateId;
}

/** Join the ballot. Allowed in the lobby only, so every candidate plans the same round. */
export function join(room: Room, name: unknown, candidate: unknown): Player {
  if (room.phase !== 'lobby') throw new RoomError('This election is under way. Join when the next one opens.');
  if (room.players.length >= MAX_PLAYERS) throw new RoomError(`The ballot is full (${MAX_PLAYERS} candidates).`);
  const n = cleanName(name);
  if (room.players.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new RoomError('Someone here already has that name.');
  const player: Player = {
    id: randomUUID(),
    seat: room.players.length,
    name: n,
    candidate: checkCandidate(room, candidate),
    connected: true,
    lockedAt: null,
    playId: null,
    placements: null,
    result: null,
  };
  room.players.push(player);
  touch(room);
  return player;
}

export function findPlayer(room: Room, playerId: unknown): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new RoomError('You are not on this ballot.');
  return p;
}

export function pick(room: Room, player: Player, candidate: unknown): void {
  if (room.phase !== 'lobby') throw new RoomError('Candidates are set until the next election.');
  player.candidate = checkCandidate(room, candidate, player);
  touch(room);
}

const requireHost = (room: Room, player: Player) => {
  if (player.seat !== room.hostSeat) throw new RoomError('Only the host can do that.');
};

/** The host picks the city of the next election (lobby only). */
export function setCity(room: Room, player: Player, city: unknown): void {
  requireHost(room, player);
  if (room.phase !== 'lobby') throw new RoomError('Pick the city before the election starts.');
  if (!isCityId(city)) throw new RoomError('That city is not on the map.');
  if (!ROOM_CITIES.includes(city)) throw new RoomError('That city is coming soon for rooms.');
  room.city = city;
  touch(room);
}

/** The host opens the polls: planning starts for every candidate at once. */
export function start(room: Room, player: Player, now: number): void {
  requireHost(room, player);
  if (room.phase !== 'lobby') throw new RoomError('The election already started.');
  if (!room.players.some((p) => p.connected)) throw new RoomError('Waiting for candidates to join.');
  room.phase = 'planning';
  room.round += 1;
  room.endsAt = now + PLANNING_SECONDS * 1000;
  room.results = null;
  for (const p of room.players) {
    p.lockedAt = null;
    p.placements = null;
    p.result = null;
    p.playId = null;
  }
  touch(room, now);
}

/** A candidate submits their platform. The server scores it; invalid plans are refused. */
export function lock(room: Room, player: Player, placements: unknown, scorer: Scorer, now: number): ScoreResult {
  if (room.phase !== 'planning') throw new RoomError('Planning is over.');
  if (player.lockedAt !== null) throw new RoomError('Your platform is already in.');
  if (!Array.isArray(placements)) throw new RoomError('No plan was sent.');
  const plan: Plan = {
    roomCode: room.code,
    playerId: player.id,
    playerName: player.name,
    mode: 'flood',
    placements: placements as Placement[],
    spent: 0, // the scorer recomputes it
    city: room.city,
  };
  const result = scorer(plan);
  player.placements = plan.placements;
  player.result = result;
  player.lockedAt = now;
  touch(room, now);
  if (room.players.filter((p) => p.connected).every((p) => p.lockedAt !== null)) finish(room);
  return result;
}

/** Everyone in (or out of time): rank the platforms. Ties go to the earlier lock. */
function finish(room: Room): void {
  const ranked = [...room.players].sort(
    (a, b) => (b.result?.score ?? -1) - (a.result?.score ?? -1) || (a.lockedAt ?? Infinity) - (b.lockedAt ?? Infinity) || a.seat - b.seat,
  );
  room.results = ranked.map((p, i) => ({
    seat: p.seat,
    name: p.name,
    candidate: p.candidate,
    rank: i + 1,
    score: p.result?.score ?? 0,
    protectedPeople: p.result?.protectedPeople ?? 0,
    strandedPeople: p.result?.strandedPeople ?? 0,
    placements: p.placements ?? [],
    submitted: p.result !== null,
  }));
  room.phase = 'results';
  room.endsAt = null;
}

/** The host: back to the lobby for another election with the same candidates. */
export function again(room: Room, player: Player): void {
  requireHost(room, player);
  if (room.phase !== 'results') throw new RoomError('Finish this election first.');
  room.phase = 'lobby';
  room.results = null;
  touch(room);
}

/** A phone came or went. A round never waits on someone who left. */
export function presence(room: Room, player: Player, connected: boolean): void {
  player.connected = connected;
  // Host hand-off (from the aum branch): the next connected candidate runs the room.
  if (!room.players[room.hostSeat]?.connected) {
    const next = room.players.find((p) => p.connected);
    if (next) room.hostSeat = next.seat;
  }
  if (room.phase === 'planning') {
    const here = room.players.filter((p) => p.connected);
    if (here.length && here.every((p) => p.lockedAt !== null)) finish(room);
  }
  touch(room);
}

/** Time: planning closes LOCK_GRACE_MS after the clock (phones send their plan at 0:00). */
export function tick(room: Room, now: number): boolean {
  if (room.phase === 'planning' && room.endsAt !== null && now >= room.endsAt + LOCK_GRACE_MS) {
    finish(room);
    return true;
  }
  return false;
}

export function publicState(room: Room, viewer: Player | null, now: number, bestPossible: number | null): RoomState {
  return {
    code: room.code,
    phase: room.phase,
    city: room.city,
    round: room.round,
    endsAt: room.endsAt,
    serverNow: now,
    you: viewer?.seat ?? null,
    hostSeat: room.hostSeat,
    players: room.players.map((p) => ({ seat: p.seat, name: p.name, candidate: p.candidate, connected: p.connected, locked: p.lockedAt !== null })),
    results: room.phase === 'results' ? room.results : null,
    bestPossible,
    playId: viewer?.playId ?? null,
  };
}

export function sweep(now = Date.now()): void {
  for (const [code, room] of rooms) if (now - room.touchedAt > ROOM_TTL_MS) rooms.delete(code);
}
