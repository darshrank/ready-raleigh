// GET /api/leaderboard: every player's best play in one city, ranked. Pure, so the memory store
// and Tiger Data rank the same way, and plays kept in memory during an outage merge in cleanly.

/** A player's best play in a city and mode (one per player, from a store). */
export interface PlayerBest {
  playerId: string;
  name: string;
  score: number;
  protectedPeople: number;
  strandedPeople: number;
  spent: number;
  createdAt: Date;
  /** How many plays the player has there. */
  plays: number;
}

/** One row of the board. Player ids stay on the server; `you` marks the asking player's row. */
export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  protectedPeople: number;
  strandedPeople: number;
  spent: number;
  /** When the best play was made (ISO). */
  at: string;
  you: boolean;
}

export interface Board {
  players: number;
  plays: number;
  /** The top of the board, best first. */
  entries: BoardEntry[];
  /** The asking player's row, also when it is below the top; null if they have not played here. */
  you: BoardEntry | null;
}

const earlier = (a: PlayerBest, b: PlayerBest) => a.createdAt.getTime() < b.createdAt.getTime();

/**
 * Plays from before names were asked for say "You" (or nothing). On a shared board they read as
 * the default name the player's browser now uses: "Mayor" and four letters of their id (app/src/api.ts).
 */
export function boardName(name: string, playerId: string): string {
  const n = name.trim();
  if (n && n !== 'You' && n !== 'Anonymous') return n;
  return `Mayor ${playerId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

/** Best score first; a tie goes to whoever got there first. The same player twice keeps the better play. */
export function rankBoard(bests: PlayerBest[], limit: number, playerId?: string): Board {
  const byPlayer = new Map<string, PlayerBest>();
  for (const b of bests) {
    const have = byPlayer.get(b.playerId);
    if (!have) {
      byPlayer.set(b.playerId, b);
      continue;
    }
    const better = b.score > have.score || (b.score === have.score && earlier(b, have)) ? b : have;
    byPlayer.set(b.playerId, { ...better, plays: have.plays + b.plays });
  }
  const ranked = [...byPlayer.values()].sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime());
  const entry = (b: PlayerBest, i: number): BoardEntry => ({
    rank: i + 1,
    name: boardName(b.name, b.playerId),
    score: Math.round(b.score * 10) / 10,
    protectedPeople: Math.round(b.protectedPeople),
    strandedPeople: Math.round(b.strandedPeople),
    spent: b.spent,
    at: b.createdAt.toISOString(),
    you: !!playerId && b.playerId === playerId,
  });
  const mine = playerId ? ranked.findIndex((b) => b.playerId === playerId) : -1;
  return {
    players: ranked.length,
    plays: ranked.reduce((n, b) => n + b.plays, 0),
    entries: ranked.slice(0, limit).map(entry),
    you: mine >= 0 ? entry(ranked[mine]!, mine) : null,
  };
}

/** A name for the board: no control characters, single spaces, at most 24 characters. */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}
