// Typed Socket.IO client + session resume (pocket-rivals pattern: secret player id kept locally).
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, PublicState, ServerToClientEvents } from '@rr/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const KEY = 'rr.session';

export interface Session {
  code: string;
  playerId: string;
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {}
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let socket: GameSocket | null = null;
let tvCode: string | null = null;

/** TV mode: watch a room (re-attaches automatically after reconnects). */
export async function watchAsTv(code: string): Promise<void> {
  tvCode = code.toUpperCase();
  getSocket();
  await call('tv:watch', { code: tvCode });
}
let lastState: PublicState | null = null;
const listeners = new Set<(s: PublicState) => void>();
const statusListeners = new Set<(connected: boolean) => void>();
/** Server clock − local clock (ms), from the latest state. */
export let clockOffset = 0;

export function getSocket(): GameSocket {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('state', (s) => {
    clockOffset = s.serverNow - Date.now();
    lastState = s;
    for (const fn of listeners) fn(s);
  });
  socket.on('connect', () => {
    for (const fn of statusListeners) fn(true);
    if (tvCode) {
      socket!.emit('tv:watch', { code: tvCode }, () => {});
      return;
    }
    const sess = loadSession();
    if (sess) socket!.emit('room:resume', sess, (r) => 'error' in r && saveSession(null));
  });
  socket.on('disconnect', () => {
    for (const fn of statusListeners) fn(false);
  });
  return socket;
}

export function onState(fn: (s: PublicState) => void): () => void {
  listeners.add(fn);
  if (lastState) fn(lastState);
  return () => listeners.delete(fn);
}

export function onConnection(fn: (connected: boolean) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** Promise-wrapped emit; rejects with the server's error message. */
export function call<E extends keyof ClientToServerEvents>(
  ev: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
): Promise<Record<string, unknown>> {
  const s = getSocket();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server didn’t answer. Check your connection.')), 8000);
    (s.emit as (ev: string, p: unknown, ack: (r: Record<string, unknown>) => void) => void)(ev, payload, (r) => {
      clearTimeout(timer);
      if (r && 'error' in r) reject(new Error(String(r.error)));
      else resolve(r);
    });
  });
}

export const serverNow = () => Date.now() + clockOffset;
