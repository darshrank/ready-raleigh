import Fastify from 'fastify';
import type { GameData } from './data';
import { MemoryStore, type PlayStore } from './db/store';
import { type LiveStore, MemoryLiveStore } from './live/store';
import { summarize } from './live/summary';
import { rankPlanner } from './planner';
import { BadPlay, buildPlay } from './plays';
import { lanAddresses } from './net';
import { roomServer } from './roomSocket';
import { registerVoice, voiceReady } from './voice';

export interface ServerOptions {
  /** Where plays go. Defaults to memory. */
  store?: PlayStore;
  /** The game data; null when it could not be loaded (plays then keep the client's score). */
  data?: () => GameData | null;
  /** Live gauges and weather (P15). Defaults to an empty memory store. */
  live?: LiveStore;
}

/** Builds the server without listening, so tests can inject requests. */
export function buildServer({ store = new MemoryStore(), data = () => null, live = new MemoryLiveStore() }: ServerOptions = {}) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/api/health', async () => ({ ok: true, voice: voiceReady() }));
  registerVoice(app);

  // Where phones join a room: PUBLIC_URL (our domain or a tunnel) when set, else this machine's LAN
  // address. The page adds its own port, since in development it is served by Vite, not here.
  app.get('/api/join-base', async () => ({ publicUrl: process.env.PUBLIC_URL || null, lan: lanAddresses()[0] ?? null }));

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

  // Live feeds: the latest reading per gauge, with trend and flood stage, plus weather.
  app.get('/api/live/gauges', async () => {
    const now = new Date();
    const [gauges, readings] = await Promise.all([live.gauges(), live.recent(new Date(now.getTime() - 3 * 3600_000))]);
    return { store: live.kind, ...summarize(gauges, readings, now) };
  });

  // Hourly history for one gauge (or 'nws:<id>'), from the gauge_hourly continuous aggregate.
  app.get<{ Params: { site: string }; Querystring: { hours?: string } }>('/api/live/gauges/:site', async (req, reply) => {
    const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours ?? 48) || 48));
    const site = req.params.site;
    if (!/^[\w:/,.-]{1,40}$/.test(site)) return reply.code(400).send({ error: 'bad site' });
    const rows = await live.hourly(site, new Date(Date.now() - hours * 3600_000));
    return { store: live.kind, site, hours, rows };
  });

  // Rooms (P9): candidates plan the same storm; locked platforms are scored and stored like plays.
  const rooms = roomServer({ store, data, log: app.log });
  app.server.on('upgrade', rooms.onUpgrade);
  app.addHook('onClose', async () => {
    await rooms.close();
    await store.close();
  });

  return app;
}
