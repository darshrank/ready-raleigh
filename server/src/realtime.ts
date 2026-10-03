// Socket.IO wiring (pattern from pocket-rivals server/index.js, MIT): resolve the caller's
// room/player, turn GameErrors into ack({error}), broadcast per-viewer state.
import type { Server, Socket } from 'socket.io';
import { DEFAULT_SETTINGS, LENSES, ROUND_COUNTS, TIMERS_S, type ClientToServerEvents, type GameSettings, type InterServerEvents, type ServerToClientEvents, type SocketData } from '@rr/shared';
import { backToLobby, lockGuess, nextRound, onPresence, publicState, setReady, startGame, startParty, tick, updateSettings, useLens } from './game.ts';
import { publicBase } from './net.ts';
import { drawRounds, loadRounds } from './pack.ts';
import { addPlayer, cleanName, createRoom, findPlayer, GameError, getRoom, rooms, sweepOldRooms, type Room } from './rooms.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type S = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface RealtimeConfig {
  port: number;
  protocol: 'http' | 'https';
  publicUrl?: string;
}

export function sanitizeSettings(raw: Partial<GameSettings> | undefined, base: GameSettings = DEFAULT_SETTINGS): GameSettings {
  const s = { ...base, ...(raw ?? {}) };
  return {
    area: /^[a-z0-9_-]+$/.test(String(s.area)) ? String(s.area) : base.area,
    rounds: (ROUND_COUNTS as readonly number[]).includes(Number(s.rounds)) ? Number(s.rounds) : base.rounds,
    timerS: (TIMERS_S as readonly number[]).includes(Number(s.timerS)) ? Number(s.timerS) : base.timerS,
    rules: ['normal', 'no_lenses', 'pro'].includes(String(s.rules)) ? (s.rules as GameSettings['rules']) : base.rules,
  };
}

const tvRoom = (code: string) => `tv:${code}`;

export function attachRealtime(io: IO, cfg: RealtimeConfig = { port: 3000, protocol: 'http' }): void {
  const bases = new Map<string, string>(); // room code -> join base (from the creator's Host header)
  const broadcast = (room: Room) => {
    const now = Date.now();
    const base = bases.get(room.code) ?? cfg.publicUrl ?? '';
    for (const p of room.players) if (p.socketId) io.to(p.socketId).emit('state', publicState(room, p.id, now, base));
    if (room.tvSockets.size) io.to(tvRoom(room.code)).emit('state', publicState(room, null, now, base));
  };

  // Time-driven phases (brief → play, play → reveal on timeout, party reveal auto-advance).
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) if (tick(room, now)) broadcast(room);
  }, 200).unref();
  setInterval(() => sweepOldRooms(), 10 * 60 * 1000).unref();

  io.on('connection', (socket: S) => {
    socket.emit('hello', { base: '', aiLive: Boolean(process.env.GEMINI_API_KEY) });
    socket.on('ping', (ack) => ack({ ok: true, t: Date.now() }));
    const joinBase = () => publicBase({ host: socket.handshake.headers.host, protocol: cfg.protocol, port: cfg.port, publicUrl: cfg.publicUrl });

    const handle =
      <P, R extends object>(fn: (p: P) => R | void) =>
      (payload: P, ack: (r: ({ ok: true } & R) | { error: string }) => void = () => {}) => {
        try {
          ack({ ok: true, ...((fn(payload ?? ({} as P)) ?? {}) as R) });
        } catch (err) {
          if (!(err instanceof GameError)) console.error('[socket]', err);
          ack({ error: err instanceof GameError ? err.message : 'Something went wrong.' });
        }
      };
    const current = () => {
      const room = getRoom(socket.data.code);
      return { room, player: findPlayer(room, socket.data.playerId) };
    };
    const attach = (room: Room, playerId: string) => {
      const player = findPlayer(room, playerId);
      if (player.socketId && player.socketId !== socket.id) io.sockets.sockets.get(player.socketId)?.disconnect(true); // newest tab wins
      player.socketId = socket.id;
      player.connected = true;
      socket.data = { code: room.code, playerId };
      onPresence(room, Date.now());
      return player;
    };
    const newSolo = (name: string, settings: GameSettings) => {
      const bank = loadRounds(settings.area);
      const room = createRoom('solo', settings, drawRounds(bank.rounds, settings.rounds));
      const player = addPlayer(room, name);
      attach(room, player.id);
      startGame(room, Date.now());
      broadcast(room);
      return { code: room.code, playerId: player.id };
    };

    socket.on('solo:start', handle(({ name, settings }) => newSolo(cleanName(name, 'You'), sanitizeSettings(settings))));

    socket.on('room:create', handle(({ name, settings }) => {
      const s = sanitizeSettings(settings);
      loadRounds(s.area); // fail early if the map isn't built
      const room = createRoom('party', s, []);
      bases.set(room.code, joinBase());
      const player = addPlayer(room, cleanName(name));
      player.ready = true; // the host is ready by definition
      attach(room, player.id);
      broadcast(room);
      return { code: room.code, playerId: player.id };
    }));
    socket.on('room:join', handle(({ code, name }) => {
      const room = getRoom(code);
      if (room.mode !== 'party') throw new GameError('That is a solo game.');
      const player = addPlayer(room, cleanName(name));
      attach(room, player.id);
      broadcast(room);
      return { code: room.code, playerId: player.id };
    }));
    socket.on('room:resume', handle(({ code, playerId }) => {
      const room = getRoom(code);
      attach(room, playerId);
      broadcast(room);
      return { code: room.code, playerId };
    }));
    socket.on('room:settings', handle(({ settings }) => {
      const { room, player } = current();
      const s = sanitizeSettings(settings, room.settings);
      loadRounds(s.area);
      updateSettings(room, player, s);
      broadcast(room);
    }));
    socket.on('player:ready', handle(({ ready }) => {
      const { room, player } = current();
      setReady(room, player, ready);
      broadcast(room);
    }));
    socket.on('room:start', handle(() => {
      const { room, player } = current();
      startParty(room, player, drawRounds(loadRounds(room.settings.area).rounds, room.settings.rounds), Date.now());
      broadcast(room);
    }));
    socket.on('tv:watch', handle(({ code }) => {
      const room = getRoom(code);
      if (room.mode !== 'party') throw new GameError('TV mode is for party games.');
      room.tvSockets.add(socket.id);
      socket.join(tvRoom(room.code));
      socket.data = { code: room.code };
      broadcast(room);
      return { code: room.code };
    }));
    socket.on('round:lens', handle(({ lens }) => {
      const { room, player } = current();
      if (!LENSES.includes(lens)) throw new GameError('Unknown lens.');
      useLens(room, player, lens);
      broadcast(room);
    }));
    socket.on('round:lock', handle((guess) => {
      const { room, player } = current();
      lockGuess(room, player, guess, Date.now());
      broadcast(room);
    }));
    socket.on('round:next', handle(() => {
      const { room, player } = current();
      nextRound(room, player, Date.now());
      broadcast(room);
    }));
    socket.on('game:again', handle(() => {
      const { room, player } = current();
      if (room.phase !== 'results') throw new GameError('Finish this game first.');
      if (room.mode === 'party') {
        backToLobby(room, player);
        broadcast(room);
        return { code: room.code, playerId: player.id };
      }
      return newSolo(player.name, room.settings);
    }));

    socket.on('disconnect', () => {
      const { code, playerId } = socket.data ?? {};
      const room = code ? rooms.get(code) : undefined;
      if (!room) return;
      if (room.tvSockets.delete(socket.id)) broadcast(room);
      const p = room.players.find((x) => x.id === playerId);
      if (p && p.socketId === socket.id) {
        p.connected = false;
        p.socketId = null;
        onPresence(room, Date.now());
        broadcast(room);
      }
    });
  });
}
