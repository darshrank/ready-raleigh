// Calls to the game server (proxied under /api by Vite). Every call fails soft: the game works
// without the server, it just does not add to the planners' data or the leaderboards.
import type { DebriefFacts } from '@shared/debrief';
import type { NewsFacts, NewsScript } from '@shared/news';
import type { Placement } from '@shared/types';
import type { CityId } from './cities';
import { soloPlan } from './plan/usePlanScore';

const PLAYER_KEY = 'ready-raleigh-player';
const NAME_KEY = 'ready-raleigh-player-name';

/**
 * An anonymous id per browser, so the planner reports count people rather than games. Random, not
 * tied to any name or account.
 */
export function playerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

/** The name on the leaderboard: the player's own, else "Mayor" and four letters of their id. */
export function playerName(): string {
  try {
    const name = localStorage.getItem(NAME_KEY)?.trim();
    if (name) return name;
  } catch {
    // no storage: the default name
  }
  return `Mayor ${playerId().replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

/** Stores a finished solo game on its city (the server scores it again). Never throws: null when not stored. */
export async function saveSoloPlay(placements: Placement[], city: CityId): Promise<string | null> {
  try {
    const plan = { ...soloPlan(placements), playerId: playerId(), playerName: playerName(), city };
    const res = await fetch('/api/plays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? ((await res.json()) as { id: string }).id : null;
  } catch {
    // Server down or offline: the game goes on.
    return null;
  }
}

/** One row of a city's leaderboard (server/src/leaderboard.ts). */
export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  protectedPeople: number;
  strandedPeople: number;
  spent: number;
  at: string;
  you: boolean;
}

export interface Leaderboard {
  store: 'tiger' | 'memory';
  city: string;
  players: number;
  plays: number;
  entries: BoardEntry[];
  /** This player's row, also when it is below the top. */
  you: BoardEntry | null;
}

/**
 * The city's leaderboard, or null when the server cannot be reached. `asPlayer` marks whose row is
 * "you": the browser's id for solo plays, the room's player id for an election.
 */
/** How many players the results show from the top of the board (the asker's row comes too). */
export const BOARD_TOP = 5;

export async function fetchLeaderboard(city: CityId, asPlayer: string = playerId()): Promise<Leaderboard | null> {
  try {
    const q = new URLSearchParams({ city, mode: 'flood', playerId: asPlayer, limit: String(BOARD_TOP) });
    const res = await fetch(`/api/leaderboard?${q}`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as Leaderboard) : null;
  } catch {
    return null;
  }
}

/** Sets the player's name here and on the server's boards. False if the server did not take it. */
export async function renamePlayer(name: string): Promise<boolean> {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not remembered on this browser; the server still has it.
  }
  try {
    const res = await fetch('/api/players/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: playerId(), name }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const aiOn = import.meta.env.VITE_FEATURE_AI !== 'false';

/** The results' debrief written by Gemini (POST /api/debrief), or null: the page shows its template. */
export async function fetchDebrief(facts: DebriefFacts): Promise<string | null> {
  if (!aiOn) return null;
  try {
    const res = await fetch('/api/debrief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { text?: unknown };
    return typeof j.text === 'string' && j.text.trim() ? j.text.trim() : null;
  } catch {
    return null;
  }
}

/** The storm's reports written by Gemini (POST /api/news), or null: the desk then reads its templates. */
export async function fetchNews(facts: NewsFacts): Promise<NewsScript | null> {
  if (!aiOn) return null;
  try {
    const res = await fetch('/api/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const script = (await res.json()) as NewsScript;
    return Array.isArray(script?.lines) ? script : null;
  } catch {
    return null;
  }
}
