import Fastify from 'fastify';
import type { GameData } from './data';
import { MemoryStore, type PlayStore } from './db/store';
import { type LiveStore, MemoryLiveStore } from './live/store';
import { summarize } from './live/summary';
import { busDemand, demandCsv, demandGeoJson } from './demand';
import { rankPlanner } from './planner';
import { BadPlay, buildPlay, cityOf } from './plays';
import { lanAddresses } from './net';
import { roomServer } from './roomSocket';
import { type Gemini, gemini as defaultGemini } from './ai/gemini';
import { cardService } from './cards/cards';
import type { Minter } from './cards/mint';
import { registerCards } from './cards/routes';
import { registerNews } from './news';
import { type CivicRecord, civicRecord } from './solana/civic';
import { registerCivic } from './solana/routes';
import { civicSignals } from './solana/signals';
import { MemoryCivicStore, type Signal } from './solana/store';
import { registerVoice, voiceReady } from './voice';
import { type CityId, isCityId } from '@shared';

export interface ServerOptions {
  /** Where plays go. Defaults to memory. */
  store?: PlayStore;
  /** The game data per city (default Raleigh); null when it could not be loaded (plays then keep the client's score). */
  data?: (city?: CityId) => GameData | null;
  /** Live gauges and weather (P15). Defaults to an empty memory store. */
  live?: LiveStore;
  /** The civic record on Solana (P16). Defaults to memory with the chain off. */
  civic?: CivicRecord;
  /** A play earned a card for a civic signal (tests listen here; cards hook in too). */
  onAward?: (signal: Signal, play: { playId: string; playerId: string }) => void;
  /** Mints claimed cards; null until the card collection exists. */
  minter?: Minter | null;
  gemini?: Gemini;
  /** Paint card art with Gemini (tests turn it off). */
  cardArt?: boolean;
}

/** Builds the server without listening, so tests can inject requests. */
export function buildServer({ store = new MemoryStore(), data = () => null, live = new MemoryLiveStore(), civic, onAward, minter = null, gemini = defaultGemini, cardArt = true }: ServerOptions = {}) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const record = civic ?? civicRecord({
    store: new MemoryCivicStore(),
    chain: null,
    dataBuild: () => data()?.bundle.meta?.buildDate ?? 'unknown',
    log: { info: (m) => app.log.info(m), warn: (o, m) => app.log.warn(o, m) },
  });
  registerCivic(app, record);
  const civicLog = { info: (m: string) => app.log.info(m), warn: (o: unknown, m: string) => app.log.warn(o, m) };
  // Contribution cards: earned through signals and room elections, minted when claimed.
  const cards = cardService({ civic: record, gemini, log: civicLog, minter, art: cardArt });
  registerCards(app, cards);
  // Civic signals: the rules run after each fingerprinted play (room or solo).
  const signals = civicSignals({
    plays: store, civic: record, data, log: civicLog,
    onAward: (signal, play) => {
      onAward?.(signal, play);
      void cards.fromSignal(signal, play).catch((err) => app.log.warn({ err }, 'cards: award failed'));
    },
  });
  record.onRecorded((play) => void signals.onPlay(play));

  app.get('/api/health', async () => ({ ok: true, voice: voiceReady(), ai: gemini.ready() }));
  registerVoice(app);
  registerNews(app);

  // Where phones join a room: PUBLIC_URL (our domain or a tunnel) when set, else this machine's LAN
  // address. The page adds its own port, since in development it is served by Vite, not here.
  app.get('/api/join-base', async () => ({ publicUrl: process.env.PUBLIC_URL || null, lan: lanAddresses()[0] ?? null }));

  app.post('/api/plays', async (req, reply) => {
    try {
      const play = buildPlay(req.body, data(cityOf(req.body)));
      await store.savePlay(play);
      // Fingerprinted now, anchored on Solana with the next batch. Never holds up the answer.
      record.recordPlay(play).catch((err) => app.log.warn({ err }, 'civic: play not fingerprinted'));
      return reply.code(201).send({ id: play.id, score: play.score, store: store.kind });
    } catch (err) {
      if (err instanceof BadPlay) return reply.code(400).send({ error: 'invalid play', problems: err.problems });
      throw err;
    }
  });

  app.get<{ Querystring: { mode?: string; city?: string } }>('/api/planner', async (req, reply) => {
    const mode = req.query.mode ?? 'flood';
    if (mode !== 'flood' && mode !== 'heat') return reply.code(400).send({ error: 'mode must be flood or heat' });
    const city = req.query.city ?? 'raleigh';
    if (!isCityId(city)) return reply.code(400).send({ error: 'unknown city' });
    const game = data(city);
    if (!game) return reply.code(503).send({ error: 'game data not loaded' });
    const crowd = await store.crowd(mode, city);
    return { store: store.kind, city, ...rankPlanner(mode, game.bundle, game.optimal(mode), game.extended(mode), crowd) };
  });

  // Bus pickup demand for transit and emergency planners: ?mode=flood&city=raleigh&days=30&minPlayers=5&format=json|csv|geojson
  app.get<{ Querystring: { mode?: string; city?: string; days?: string; minPlayers?: string; format?: string } }>(
    '/api/planner/bus-demand', async (req, reply) => {
      const mode = req.query.mode ?? 'flood';
      if (mode !== 'flood' && mode !== 'heat') return reply.code(400).send({ error: 'mode must be flood or heat' });
      const city = req.query.city ?? 'raleigh';
      if (!isCityId(city)) return reply.code(400).send({ error: 'unknown city' });
      const game = data(city);
      if (!game) return reply.code(503).send({ error: 'game data not loaded' });
      const days = Number(req.query.days);
      const since = Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 86_400_000) : new Date(0);
      const minPlayers = req.query.minPlayers === undefined ? undefined : Number(req.query.minPlayers) || undefined;
      const report = busDemand({ mode, data: game.bundle, transit: game.transit, pickups: await store.pickups(mode, since, city), since, minPlayers });
      const stamp = report.generatedAt.slice(0, 10);
      if (req.query.format === 'csv') {
        return reply.type('text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="bus-pickup-demand-${stamp}.csv"`).send(demandCsv(report));
      }
      if (req.query.format === 'geojson') {
        return reply.type('application/geo+json')
          .header('Content-Disposition', `attachment; filename="bus-pickup-demand-${stamp}.geojson"`).send(demandGeoJson(report));
      }
      return { store: store.kind, ...report };
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
  const rooms = roomServer({
    store, data, log: app.log, civic: record,
    // The election's winner is the mayor-elect: their card, with the room's numbers.
    onFinish: (room) => {
      const top = room.results?.[0];
      const winner = top?.submitted ? room.players.find((p) => p.seat === top.seat) : undefined;
      if (!top || !winner?.playId) return;
      void cards.award({
        kind: 'mayor_elect', playId: winner.playId, playerId: winner.id, spot: null, signal: null,
        facts: { protectedPeople: Math.round(top.protectedPeople), score: Math.round(top.score * 10) / 10, candidates: room.results!.length, room: room.code },
      }).catch((err) => app.log.warn({ err }, 'cards: mayor-elect award failed'));
    },
  });
  app.server.on('upgrade', rooms.onUpgrade);
  app.addHook('onClose', async () => {
    await rooms.close();
    record.close();
    await store.close();
  });

  return app;
}
