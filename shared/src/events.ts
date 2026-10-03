import type { GameSettings, GuessInput, LensId, PublicState } from './game.ts';

// Typed Socket.IO events. Never emit an event that is not declared here.

export interface ServerInfo {
  base: string;
  aiLive: boolean;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok?: false; error: string }) => void;

export interface ServerToClientEvents {
  hello: (info: ServerInfo) => void;
  state: (state: PublicState) => void;
}

export interface ClientToServerEvents {
  ping: (ack: (res: { ok: true; t: number }) => void) => void;
  'solo:start': (p: { name?: string; settings?: Partial<GameSettings> }, ack: Ack<{ code: string; playerId: string }>) => void;
  'room:resume': (p: { code: string; playerId: string }, ack: Ack<{ code: string; playerId: string }>) => void;
  'round:lens': (p: { lens: LensId }, ack: Ack) => void;
  'round:lock': (p: GuessInput, ack: Ack) => void;
  'round:next': (p: Record<string, never>, ack: Ack) => void;
  'game:again': (p: Record<string, never>, ack: Ack<{ code: string; playerId: string }>) => void;
  'room:create': (p: { name: string; settings?: Partial<GameSettings> }, ack: Ack<{ code: string; playerId: string }>) => void;
  'room:join': (p: { code: string; name: string }, ack: Ack<{ code: string; playerId: string }>) => void;
  'room:settings': (p: { settings: Partial<GameSettings> }, ack: Ack) => void;
  'room:start': (p: Record<string, never>, ack: Ack) => void;
  'player:ready': (p: { ready: boolean }, ack: Ack) => void;
  'tv:watch': (p: { code: string }, ack: Ack<{ code: string }>) => void;
}

export type InterServerEvents = Record<string, never>;

export interface SocketData {
  code?: string;
  playerId?: string;
}
