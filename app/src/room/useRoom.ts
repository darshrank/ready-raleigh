// One WebSocket per page to /ws/rooms/:code (proxied to the server by Vite). Reconnects on its own;
// a phone that joined keeps its secret id in localStorage, so a reload resumes the same candidate.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CandidateId, ClientMsg, Placement, RoomState, ServerMsg } from '@shared';
import type { CityId } from '@shared/room';

const key = (code: string) => `rr.room.${code}`;
export const savedPlayer = (code: string): string | null => {
  try {
    return localStorage.getItem(key(code));
  } catch {
    return null;
  }
};
const savePlayer = (code: string, id: string | null) => {
  try {
    if (id) localStorage.setItem(key(code), id);
    else localStorage.removeItem(key(code));
  } catch {}
};

export interface Room {
  state: RoomState | null;
  connected: boolean;
  error: string | null;
  clearError: () => void;
  /** Server clock minus ours (ms): add to Date.now() to compare with server times. */
  offset: number;
  /** `create`: open the room (the player hosting it). */
  join: (name: string, candidate: CandidateId, create?: boolean) => void;
  pick: (candidate: CandidateId) => void;
  start: () => void;
  lock: (placements: Placement[]) => void;
  again: () => void;
  /** Host, in the lobby: the city of the next election. */
  city: (city: CityId) => void;
}

export function useRoom(code: string): Room {
  const [state, setState] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wait = 500;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/ws/rooms/${code}`);
      ws.current = sock;
      sock.onopen = () => {
        wait = 500;
        setConnected(true);
        const id = savedPlayer(code);
        if (id) sock.send(JSON.stringify({ t: 'resume', playerId: id } satisfies ClientMsg));
        else sock.send(JSON.stringify({ t: 'look' } satisfies ClientMsg));
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMsg;
        if (msg.t === 'state') {
          setOffset(msg.state.serverNow - Date.now());
          setState(msg.state);
        } else if (msg.t === 'joined') savePlayer(code, msg.playerId);
        else if (msg.t === 'error') {
          // A stale id (the server restarted, or the room expired): forget it and show the join form.
          if (/not on this ballot/.test(msg.message) && savedPlayer(code)) {
            savePlayer(code, null);
            ws.current?.send(JSON.stringify({ t: 'look' } satisfies ClientMsg));
          }
          setError(msg.message);
        }
      };
      sock.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, (wait = Math.min(wait * 2, 5000)));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, [code]);

  const send = useCallback((msg: ClientMsg) => {
    setError(null);
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
    else setError('Reconnecting to the room. Try again in a moment.');
  }, []);

  return {
    state,
    connected,
    error,
    clearError: useCallback(() => setError(null), []),
    offset,
    join: useCallback((name, candidate, create) => send({ t: 'join', name, candidate, create }), [send]),
    pick: useCallback((candidate) => send({ t: 'pick', candidate }), [send]),
    start: useCallback(() => send({ t: 'start' }), [send]),
    lock: useCallback((placements) => send({ t: 'lock', placements }), [send]),
    again: useCallback(() => send({ t: 'again' }), [send]),
    city: useCallback((city: CityId) => send({ t: 'city', city }), [send]),
  };
}
