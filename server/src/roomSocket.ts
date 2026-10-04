// /ws/rooms/:code: the room protocol (shared/src/room.ts) over raw `ws`, on Fastify's server.
// Every locked platform is scored with buildPlay (the same checks and score as POST /api/plays)
// and saved through the play store, so room games land in Tiger Data with the candidate.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { score, type CityId, type ClientMsg, type Plan, type RoomState, type ServerMsg } from '@shared';
import type { GameData } from './data';
import type { PlayRecord, PlayStore } from './db/store';
import { BadPlay, buildPlay } from './plays';
import type { CivicRecord } from './solana/civic';
import {
  RoomError, again, findPlayer, getOrCreateRoom, getRoom, join, lock, pick, presence, publicState, setCity,
  start, sweep, tick, type Player, type Room,
} from './rooms';

const ROOM_PATH = /^\/ws\/rooms\/([A-Za-z]{4})$/;

interface Conn {
  ws: WebSocket;
  code: string;
  playerId: string | null; // null: the TV or a phone that has not joined yet
}

export interface RoomServerOptions {
  store: PlayStore;
  /** Game data per city (null when a city's data is not loaded). */
  data: (city?: CityId) => GameData | null;
  log: { warn: (obj: unknown, msg: string) => void };
  /** The civic record (P16): each locked platform is fingerprinted, the election anchored when it ends. */
  civic?: CivicRecord;
  /** An election just ended (results are in); after its plays are recorded. */
  onFinish?: (room: Room) => void;
}

export function roomServer({ store, data, log, civic, onFinish }: RoomServerOptions) {
  const wss = new WebSocketServer({ noServer: true });
  const conns = new Map<string, Set<Conn>>();
  // The optimizer's score per city, for "% of the best plan".
  const best = new Map<CityId, number>();
  const bestPossible = (city: CityId) => {
    const game = data(city);
    if (!best.has(city) && game) best.set(city, score(game.optimal('flood'), game.bundle).score);
    return best.get(city) ?? null;
  };

  /** Civic records still being written per room, and the elections already handed on. */
  const recording = new Map<string, Promise<unknown>[]>();
  const finished = new Set<string>();
  const electionOver = (room: Room) => {
    const key = `${room.code}:${room.round}`;
    if (room.phase !== 'results' || finished.has(key)) return;
    finished.add(key);
    const pending = recording.get(room.code) ?? [];
    recording.delete(room.code);
    void Promise.allSettled(pending).then(() => {
      void civic?.flush();
      onFinish?.(room);
    });
  };

  const send = (ws: WebSocket, msg: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const broadcast = (room: Room) => {
    electionOver(room);
    const now = Date.now();
    for (const c of conns.get(room.code) ?? []) {
      const viewer = c.playerId ? room.players.find((p) => p.id === c.playerId) ?? null : null;
      const state: RoomState = publicState(room, viewer, now, bestPossible(room.city));
      send(c.ws, { t: 'state', state });
    }
  };

  const timer = setInterval(() => {
    const now = Date.now();
    for (const code of conns.keys()) {
      try {
        const room = getRoom(code);
        if (tick(room, now)) broadcast(room);
      } catch {}
    }
    sweep(now);
  }, 250);
  timer.unref();

  /** Score with the server's engine and save the play (Tiger Data, or memory). */
  const scorer = (room: Room, player: Player) => (plan: Plan) => {
    let record: PlayRecord;
    try {
      record = buildPlay({ plan }, data(room.city));
    } catch (err) {
      if (err instanceof BadPlay) throw new RoomError(data(room.city) ? `That plan is not valid: ${err.problems[0]}` : 'The game data is not loaded on the server.');
      throw err;
    }
    store.savePlay({ ...record, candidate: player.candidate }).catch((e) => log.warn({ err: e, room: room.code }, 'room play not saved'));
    player.playId = record.id;
    if (civic) {
      const p = civic.recordPlay(record).catch((e) => log.warn({ err: e, room: room.code }, 'civic: room play not fingerprinted'));
      recording.set(room.code, [...(recording.get(room.code) ?? []), p]);
    }
    return record.score;
  };

  function handle(conn: Conn, msg: ClientMsg) {
    const now = Date.now();
    const room = msg.t === 'join' && msg.create ? getOrCreateRoom(conn.code, now) : getRoom(conn.code);
    if (msg.t === 'look') return send(conn.ws, { t: 'state', state: publicState(room, null, now, bestPossible(room.city)) });
    if (msg.t === 'join') {
      const player = join(room, msg.name, msg.candidate);
      conn.playerId = player.id;
      send(conn.ws, { t: 'joined', playerId: player.id, seat: player.seat });
      return broadcast(room);
    }
    if (msg.t === 'resume') {
      const player = findPlayer(room, msg.playerId);
      // Newest tab wins: an older socket for the same player stops counting.
      for (const c of conns.get(room.code) ?? []) if (c !== conn && c.playerId === player.id) c.playerId = null;
      conn.playerId = player.id;
      presence(room, player, true);
      send(conn.ws, { t: 'joined', playerId: player.id, seat: player.seat });
      return broadcast(room);
    }
    const player = findPlayer(room, conn.playerId);
    if (msg.t === 'start') start(room, player, now);
    else if (msg.t === 'again') again(room, player);
    else if (msg.t === 'city') setCity(room, player, msg.city);
    else if (msg.t === 'pick') pick(room, player, msg.candidate);
    else if (msg.t === 'lock') lock(room, player, msg.placements, scorer(room, player), now);
    else throw new RoomError('Unknown message.');
    broadcast(room);
  }

  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const match = ROOM_PATH.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!match) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn: Conn = { ws, code: match[1]!.toUpperCase(), playerId: null };
      if (!conns.has(conn.code)) conns.set(conn.code, new Set());
      conns.get(conn.code)!.add(conn);
      ws.on('message', (raw) => {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(String(raw)) as ClientMsg;
          if (typeof msg?.t !== 'string') throw new Error();
        } catch {
          return send(ws, { t: 'error', message: 'Bad message.' });
        }
        try {
          handle(conn, msg);
        } catch (err) {
          if (!(err instanceof RoomError)) log.warn({ err }, 'room message failed');
          send(ws, { t: 'error', message: err instanceof RoomError ? err.message : 'Something went wrong.' });
        }
      });
      ws.on('close', () => {
        conns.get(conn.code)?.delete(conn);
        if (!conns.get(conn.code)?.size) conns.delete(conn.code);
        const room = (() => {
          try {
            return getRoom(conn.code);
          } catch {
            return null;
          }
        })();
        const player = room && conn.playerId ? room.players.find((p) => p.id === conn.playerId) : null;
        const stillHere = player && [...(conns.get(conn.code) ?? [])].some((c) => c.playerId === player.id);
        if (room && player && !stillHere) {
          presence(room, player, false);
          broadcast(room);
        }
      });
    });
  }

  async function close() {
    clearInterval(timer);
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  return { onUpgrade, close };
}
