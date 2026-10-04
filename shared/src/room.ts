// Rooms (P9): every player is a mayoral candidate planning the same storm. No central screen:
// the player who opens the room is the host (starts each election) and plays like everyone else.
// Wire protocol for /ws/rooms/:code. JSON messages, one per WebSocket frame.
import type { Placement } from './types';

/** Candidate portraits in app/public/candidates/<id>.svg (Open Peeps, CC0). Picker order. */
export const CANDIDATES = [
  'peep-17', 'peep-52', 'peep-34', 'peep-92', 'peep-6', 'peep-96', 'peep-4', 'peep-8',
  'peep-18', 'peep-23', 'peep-38', 'peep-46', 'peep-49', 'peep-76', 'peep-83', 'peep-98',
] as const;
export type CandidateId = (typeof CANDIDATES)[number];

export const MAX_PLAYERS = 12;
/** After the planning clock runs out, phones get this long to send their plan. */
export const LOCK_GRACE_MS = 5_000;

export type RoomPhase = 'lobby' | 'briefing' | 'planning' | 'results';
/** The narrated briefing every candidate watches before the planning clock starts (host can skip). */
export const BRIEFING_SECONDS = 35;

/** The city packs a game can be played in (app/src/cities.ts has their names and art). */
export const CITY_IDS = ['raleigh', 'miami', 'san-francisco', 'new-york'] as const;
export type CityId = (typeof CITY_IDS)[number];
export const isCityId = (v: unknown): v is CityId => typeof v === 'string' && (CITY_IDS as readonly string[]).includes(v);
/** Cities a room can play. New York and San Francisco come later (their hazard models are flood stand-ins). */
export const ROOM_CITIES: readonly CityId[] = ['raleigh', 'miami'];

export interface RoomPlayer {
  seat: number;
  name: string;
  candidate: CandidateId;
  connected: boolean;
  /** Planning: the candidate has sent their platform. */
  locked: boolean;
}

/** One candidate's platform after the round, scored by the server's engine. */
export interface RoomResult {
  seat: number;
  name: string;
  candidate: CandidateId;
  rank: number;
  score: number;
  protectedPeople: number;
  strandedPeople: number;
  placements: Placement[];
  /** false: no plan arrived before the clock ran out (scores 0). */
  submitted: boolean;
}

export interface RoomState {
  code: string;
  phase: RoomPhase;
  /** The city of this election; the host picks it in the lobby. */
  city: CityId;
  round: number;
  /** Planning ends (ms since epoch, server clock). */
  endsAt: number | null;
  /** Server clock at send time, so clients can correct their own. */
  serverNow: number;
  /** Your seat; null for a visitor who has not joined. */
  you: number | null;
  /** The host's seat: starts the election and the next one. Passes on if the host leaves. */
  hostSeat: number;
  players: RoomPlayer[];
  /** Ranked, best first. Only in the results phase. */
  results: RoomResult[] | null;
  /** The best possible score on this data (the optimizer), for "% of the best plan". */
  bestPossible: number | null;
  /** Your stored play this round, for its civic record and cards (P16); null until it is scored. */
  playId: string | null;
}

export type ClientMsg =
  | { t: 'look' } // before joining: the room's state, or an error if there is no such room
  /** `create`: open the room if it does not exist yet (the host's first message). */
  | { t: 'join'; name: string; candidate: CandidateId; create?: boolean }
  | { t: 'resume'; playerId: string }
  | { t: 'pick'; candidate: CandidateId }
  | { t: 'start' }
  /** Host, in the lobby: the city of the next election. */
  | { t: 'city'; city: CityId }
  | { t: 'lock'; placements: Placement[] }
  | { t: 'again' };

export type ServerMsg =
  | { t: 'state'; state: RoomState }
  | { t: 'joined'; playerId: string; seat: number }
  | { t: 'error'; message: string };
