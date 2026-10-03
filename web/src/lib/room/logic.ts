/**
 * Multiplayer room state machine. Pure (no imports from the app) so the
 * Cloudflare Durable Object in /worker runs exactly the same code.
 *
 *   lobby --host start--> playing --everyone locked / timer + grace--> reveal --host again--> lobby
 *
 * Every client simulates its own plan in the browser; the room only relays
 * who is playing, the shared round settings (city, seed, timer) and the
 * locked plans, which become the crowd at the reveal.
 */

export interface RoomPlayer {
  id: string;
  name: string;
  connected: boolean;
  submitted: boolean;
}

export interface RoomSubmission {
  playerId: string;
  name: string;
  /** EnginePlan from web/src/lib/engine/plan.ts, kept opaque here */
  plan: unknown;
  /** player's own headline numbers, for the lobby list */
  protectedPct?: number;
  submittedAt: number;
}

export interface RoomState {
  code: string;
  hostId: string | null;
  phase: "lobby" | "playing" | "reveal";
  round: number;
  cityId: string;
  seed: number;
  planningSeconds: number;
  startedAt: number | null;
  players: RoomPlayer[];
  /** only filled in the reveal phase */
  submissions: RoomSubmission[];
}

export type ClientMsg =
  | { t: "join"; playerId: string; name: string }
  | { t: "start"; cityId: string; seed: number; planningSeconds: number }
  | { t: "submit"; plan: unknown; protectedPct?: number }
  | { t: "reveal" }
  | { t: "again" };

export type ServerMsg = { t: "state"; state: RoomState; serverNow: number } | { t: "error"; message: string };

export interface RoomInternal {
  state: RoomState;
  submissions: Record<string, RoomSubmission>;
}

/** Extra time after the planning timer for slow loaders and the lock countdown. */
const GRACE_MS = 45_000;

export function newRoom(code: string): RoomInternal {
  return {
    state: { code, hostId: null, phase: "lobby", round: 0, cityId: "raleigh", seed: 0, planningSeconds: 180, startedAt: null, players: [], submissions: [] },
    submissions: {},
  };
}

export function publicState(room: RoomInternal): RoomState {
  const s = room.state;
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, submitted: !!room.submissions[p.id] })),
    submissions: s.phase === "reveal" ? Object.values(room.submissions) : [],
  };
}

export interface Effect {
  /** schedule tick() at this epoch ms; null cancels */
  alarm?: number | null;
  error?: string;
}

export function handle(room: RoomInternal, playerId: string, msg: ClientMsg, now: number): Effect {
  const s = room.state;
  const isHost = s.hostId === playerId;
  switch (msg.t) {
    case "join": {
      const name = String(msg.name || "Player").slice(0, 24);
      const p = s.players.find((x) => x.id === playerId);
      if (p) {
        p.name = name;
        p.connected = true;
      } else s.players.push({ id: playerId, name, connected: true, submitted: false });
      if (!s.hostId || !s.players.some((x) => x.id === s.hostId && x.connected)) s.hostId = playerId;
      return {};
    }
    case "start": {
      if (!isHost) return { error: "Only the host can start the round" };
      if (s.phase === "playing") return {};
      s.phase = "playing";
      s.round += 1;
      s.cityId = String(msg.cityId);
      s.seed = Math.floor(Number(msg.seed)) || 1;
      s.planningSeconds = Math.max(0, Math.min(900, Math.floor(Number(msg.planningSeconds)) || 0));
      s.startedAt = now;
      room.submissions = {};
      return { alarm: now + s.planningSeconds * 1000 + GRACE_MS };
    }
    case "submit": {
      if (s.phase !== "playing") return { error: "This round is over" };
      const p = s.players.find((x) => x.id === playerId);
      if (!p) return { error: "Join the room first" };
      room.submissions[playerId] = { playerId, name: p.name, plan: msg.plan, protectedPct: msg.protectedPct, submittedAt: now };
      if (s.players.filter((x) => x.connected).every((x) => room.submissions[x.id])) {
        s.phase = "reveal";
        return { alarm: null };
      }
      return {};
    }
    case "reveal": {
      if (!isHost || s.phase !== "playing") return {};
      s.phase = "reveal";
      return { alarm: null };
    }
    case "again": {
      if (!isHost) return {};
      s.phase = "lobby";
      s.startedAt = null;
      room.submissions = {};
      return { alarm: null };
    }
  }
  return {};
}

/** Timer fired: close the round for anyone who never locked. */
export function tick(room: RoomInternal, now: number): Effect {
  const s = room.state;
  if (s.phase === "playing" && s.startedAt !== null && now >= s.startedAt + s.planningSeconds * 1000 + GRACE_MS - 100) {
    s.phase = "reveal";
  }
  return {};
}

export function disconnect(room: RoomInternal, playerId: string) {
  const s = room.state;
  const p = s.players.find((x) => x.id === playerId);
  if (p) p.connected = false;
  if (s.hostId === playerId) s.hostId = s.players.find((x) => x.connected)?.id ?? null;
  if (s.phase === "lobby") s.players = s.players.filter((x) => x.connected);
  // the last connected player may have been the only one still planning
  if (s.phase === "playing" && s.players.some((x) => x.connected) && s.players.filter((x) => x.connected).every((x) => room.submissions[x.id])) {
    s.phase = "reveal";
  }
}
