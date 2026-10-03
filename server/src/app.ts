import Fastify from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { GameData } from './data';
import { MemoryStore, type PlayStore } from './db/store';
import { rankPlanner } from './planner';
import { BadPlay, buildPlay } from './plays';

const ROOM_PATH = /^\/ws\/rooms\/([A-Za-z0-9-]{1,32})$/;

export interface ServerOptions {
  /** Where plays go. Defaults to memory. */
  store?: PlayStore;
  /** The game data; null when it could not be loaded (plays then keep the client's score). */
  data?: () => GameData | null;
}

/** Builds the server without listening, so tests can inject requests. */
export function buildServer({ store = new MemoryStore(), data = () => null }: ServerOptions = {}) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/plays', async (req, reply) => {
    try {
      const play = buildPlay(req.body, data());
      await store.savePlay(play);
      return reply.code(201).send({ id: play.id, score: play.score, store: store.kind });
    } catch (err) {
      if (err instanceof BadPlay) return reply.code(400).send({ error: 'invalid play', problems: err.problems });
      throw err;
    }
  });

  app.get<{ Querystring: { mode?: string } }>('/api/planner', async (req, reply) => {
    const mode = req.query.mode ?? 'flood';
    if (mode !== 'flood' && mode !== 'heat') return reply.code(400).send({ error: 'mode must be flood or heat' });
    const game = data();
    if (!game) return reply.code(503).send({ error: 'game data not loaded' });
    const crowd = await store.crowd(mode);
    return { store: store.kind, ...rankPlanner(mode, game.bundle, game.optimal(mode), game.extended(mode), crowd) };
  });

  // Rooms: echo for now (P1). P9 replaces this with the room state machine.
  const wss = new WebSocketServer({ noServer: true });
  app.server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const match = ROOM_PATH.exec(path);
    if (!match) {
      socket.destroy();
      return;
    }
    const code = match[1]!.toUpperCase();
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: 'hello', room: code }));
      ws.on('message', (data) => ws.send(data.toString()));
    });
  });
  app.addHook('onClose', async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await store.close();
  });

  return app;
}
