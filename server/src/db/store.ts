// Where plays are kept. Tiger Data (Postgres + TimescaleDB) when DATABASE_URL is set, else memory.
// Both stores have the same interface; failSoft() wraps Tiger so a database outage never breaks a game.
import type { InterventionType, Mode, Plan, ScoreResult } from '@shared';

export interface PlacementRow {
  type: InterventionType;
  /** 'site:<id>', 'road:<id>' or 'cell:<index>'. */
  target: string;
  /** The cell the piece sits on; null for a protected road. */
  cell: number | null;
}

export interface PlayRecord {
  id: string;
  createdAt: Date;
  plan: Plan;
  score: ScoreResult;
  placements: PlacementRow[];
  /** Room games: the mayoral candidate portrait the player ran as. */
  candidate?: string | null;
}

export interface PickCount extends PlacementRow {
  picks: number;
}

export interface Crowd {
  plays: number;
  picks: PickCount[];
}

/** Every bus pickup placed in a mode, with who placed it, for the demand report. */
export interface PickupPicks {
  plays: number;
  /** Distinct players with at least one play. */
  players: number;
  /** stopId: the pickup was an existing bus stop the player chose to use. */
  picks: { cell: number; player: string; stopId?: string }[];
}

export interface PlayStore {
  readonly kind: 'tiger' | 'memory';
  savePlay(play: PlayRecord): Promise<void>;
  /** How many plays there are in this mode and how often each spot was picked. */
  crowd(mode: Mode): Promise<Crowd>;
  /** Bus pickups placed in this mode since `since`. */
  pickups(mode: Mode, since: Date): Promise<PickupPicks>;
  /** Plays in this mode with a piece on any of `targets`, newest first (civic signals, P16). */
  pickers(mode: Mode, targets: string[], limit: number): Promise<Picker[]>;
  /** The best score in this mode so far, or null before the first play. */
  bestScore(mode: Mode): Promise<number | null>;
  close(): Promise<void>;
}

export interface Picker {
  playId: string;
  playerId: string;
}

export class MemoryStore implements PlayStore {
  readonly kind = 'memory';
  readonly plays: PlayRecord[] = [];

  async savePlay(play: PlayRecord) {
    this.plays.push(play);
  }

  async crowd(mode: Mode): Promise<Crowd> {
    const picks = new Map<string, PickCount>();
    let plays = 0;
    for (const play of this.plays) {
      if (play.plan.mode !== mode) continue;
      plays++;
      for (const p of play.placements) {
        const key = `${p.type}|${p.target}`;
        const have = picks.get(key);
        if (have) have.picks++;
        else picks.set(key, { ...p, picks: 1 });
      }
    }
    return { plays, picks: [...picks.values()] };
  }

  async pickups(mode: Mode, since: Date): Promise<PickupPicks> {
    const plays = this.plays.filter((p) => p.plan.mode === mode && p.createdAt >= since);
    return {
      plays: plays.length,
      players: new Set(plays.map((p) => p.plan.playerId)).size,
      picks: plays.flatMap((p) => p.placements
        .filter((r) => r.type === 'bus_pickup' && r.cell !== null)
        .map((r) => ({ cell: r.cell!, player: p.plan.playerId, ...(r.target.startsWith('stop:') ? { stopId: r.target.slice(5) } : {}) }))),
    };
  }

  async pickers(mode: Mode, targets: string[], limit: number): Promise<Picker[]> {
    const want = new Set(targets);
    return this.plays
      .filter((p) => p.plan.mode === mode && p.placements.some((r) => want.has(r.target)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((p) => ({ playId: p.id, playerId: p.plan.playerId }));
  }

  async bestScore(mode: Mode): Promise<number | null> {
    const scores = this.plays.filter((p) => p.plan.mode === mode).map((p) => p.score.score);
    return scores.length ? Math.max(...scores) : null;
  }

  async close() {}
}

interface Log {
  warn(obj: unknown, msg: string): void;
}

/**
 * Tiger first, memory as the fallback. A failed write goes to memory; a failed read answers from
 * memory, so the crowd still includes plays saved while the database was down.
 */
export function failSoft(primary: PlayStore, log: Log): PlayStore {
  const backup = new MemoryStore();
  return {
    kind: primary.kind,
    async savePlay(play) {
      try {
        await primary.savePlay(play);
      } catch (err) {
        log.warn({ err }, 'savePlay failed; keeping the play in memory');
        await backup.savePlay(play);
      }
    },
    async crowd(mode) {
      const local = await backup.crowd(mode);
      try {
        return mergeCrowds(await primary.crowd(mode), local);
      } catch (err) {
        log.warn({ err }, 'crowd read failed; answering from memory');
        return local;
      }
    },
    async pickups(mode, since) {
      const local = await backup.pickups(mode, since);
      try {
        const remote = await primary.pickups(mode, since);
        // Players in both could be counted twice; the memory side only holds plays from an outage.
        return { plays: remote.plays + local.plays, players: remote.players + local.players, picks: [...remote.picks, ...local.picks] };
      } catch (err) {
        log.warn({ err }, 'pickups read failed; answering from memory');
        return local;
      }
    },
    async pickers(mode, targets, limit) {
      const local = await backup.pickers(mode, targets, limit);
      try {
        return [...local, ...(await primary.pickers(mode, targets, limit))].slice(0, limit);
      } catch (err) {
        log.warn({ err }, 'pickers read failed; answering from memory');
        return local;
      }
    },
    async bestScore(mode) {
      const local = await backup.bestScore(mode);
      try {
        const remote = await primary.bestScore(mode);
        return remote === null ? local : local === null ? remote : Math.max(remote, local);
      } catch (err) {
        log.warn({ err }, 'bestScore read failed; answering from memory');
        return local;
      }
    },
    async close() {
      await primary.close();
    },
  };
}

function mergeCrowds(a: Crowd, b: Crowd): Crowd {
  if (b.plays === 0) return a;
  const picks = new Map(a.picks.map((p) => [`${p.type}|${p.target}`, { ...p }]));
  for (const p of b.picks) {
    const have = picks.get(`${p.type}|${p.target}`);
    if (have) have.picks += p.picks;
    else picks.set(`${p.type}|${p.target}`, { ...p });
  }
  return { plays: a.plays + b.plays, picks: [...picks.values()] };
}
