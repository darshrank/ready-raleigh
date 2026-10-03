// Game state shared by server and client. Truth values never appear in a PublicRound;
// they're only sent inside `Reveal`, after the round is over.
import type { Source } from './source.ts';

export type Phase = 'lobby' | 'brief' | 'play' | 'reveal' | 'results';
export type LensId = 'elevation' | 'water' | 'surface' | 'people';
export const LENSES: LensId[] = ['elevation', 'water', 'surface', 'people'];
export type Rules = 'normal' | 'no_lenses' | 'pro';
export type LngLat = [number, number];

export type RoundInput =
  | { kind: 'slider'; min: number; max: number; step: number; units: string }
  | { kind: 'pin' };

export interface RoundPhoto {
  file: string; // relative to /packs/<area>/
  lon: number;
  lat: number;
  distance_m: number;
  captured_at: string;
  creator: string | null;
  license: string;
  url: string;
}

export interface PublicRound {
  id: string;
  type: 'A' | 'B';
  kind: string;
  question: string;
  short: string;
  camera: { center: LngLat; zoom: number; pitch: number; bearing: number };
  square: [number, number, number, number];
  focus?: { building_id?: string; block_group?: string; point: LngLat };
  input: RoundInput;
  tolerance: { s: number; units: string; basis: string };
  photo?: RoundPhoto;
  source: Source;
}

export interface Truth {
  value?: number;
  points?: LngLat[];
  stage_ft?: number;
  name?: string;
  tract?: string;
  claims?: number;
}

export interface GuessInput {
  value?: number;
  point?: LngLat;
}

export interface ScoreBreakdown {
  base: number; // before lens penalty and time bonus
  lensMultiplier: number;
  timeBonus: number; // fraction, 0–0.05
  final: number;
  error: number | null; // |guess − truth| (units) or distance (m); null if no guess
  errorUnits: string;
}

export interface PlayerRoundResult {
  seat: number;
  guess: GuessInput | null;
  lenses: LensId[];
  msToLock: number | null;
  score: ScoreBreakdown;
}

export interface Reveal {
  roundId: string;
  short: string;
  kind: string;
  truth: Truth;
  explanation: string;
  clues: string[];
  results: PlayerRoundResult[];
}

export interface PublicPlayer {
  seat: number;
  name: string;
  color: string;
  shape: string;
  score: number;
  locked: boolean;
  lensesUsed: LensId[];
  connected: boolean;
  ready: boolean;
  /** joined mid-game: watches the current round, plays from the next one */
  spectator: boolean;
}

export interface GameSettings {
  area: string;
  rounds: number;
  timerS: number;
  rules: Rules;
}

export interface PublicState {
  code: string;
  mode: 'solo' | 'party';
  phase: Phase;
  settings: GameSettings;
  roundIndex: number;
  totalRounds: number;
  round: PublicRound | null;
  /** epoch ms; the client renders countdowns against `serverNow` to correct clock skew */
  briefUntil: number | null;
  deadline: number | null;
  serverNow: number;
  you: number | null;
  yourGuess: GuessInput | null;
  players: PublicPlayer[];
  reveal: Reveal | null;
  history: Reveal[];
  ranking: number[]; // seats, best first (ties: earlier total lock-in wins)
  hostSeat: number;
  /** a TV view is watching: phones act as controllers (reveal animation plays on the TV) */
  tvConnected: boolean;
  /** party reveals auto-advance at this time if the host doesn't (epoch ms) */
  revealUntil: number | null;
  /** join link for QR codes (`<base>/r/CODE`) */
  joinUrl: string;
}

/** Player colours (colour-blind-safe set, always paired with a shape) — PLAN.md §8.2. */
export const PLAYER_STYLES: { color: string; shape: string }[] = [
  { color: '#3B82F6', shape: '●' },
  { color: '#F59E0B', shape: '▲' },
  { color: '#10B981', shape: '■' },
  { color: '#EF4444', shape: '◆' },
  { color: '#8B5CF6', shape: '★' },
  { color: '#EC4899', shape: '⬟' },
  { color: '#14B8A6', shape: '⬢' },
  { color: '#F97316', shape: '✚' },
  // M4: four more pairs so 12 players stay distinct; shape carries identity for colour-blind players.
  { color: '#84CC16', shape: '▼' },
  { color: '#0EA5E9', shape: '✦' },
  { color: '#D946EF', shape: '◐' },
  { color: '#A8A29E', shape: '✖' },
];
export const MAX_PLAYERS = 12;

export const DEFAULT_SETTINGS: GameSettings = { area: 'crabtree', rounds: 5, timerS: 60, rules: 'normal' };
export const ROUND_COUNTS = [3, 5, 7] as const;
export const TIMERS_S = [30, 60, 90] as const;
