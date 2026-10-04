import pg from 'pg';
import { score } from '@shared';
import { buildServer } from './app';
import { type GameData, loadGameData } from './data';
import { MemoryStore, type PlayStore, failSoft } from './db/store';
import { TigerStore, poolConfig, prepareTiger } from './db/tiger';
import { startLiveFeeds, studyArea } from './live/job';
import { type LiveStore, MemoryLiveStore, TigerLiveStore, failSoftLive } from './live/store';
import { devnetChain, loadAuthority } from './solana/chain';
import { civicRecord } from './solana/civic';
import { type CivicStore, MemoryCivicStore, TigerCivicStore } from './solana/store';

const port = Number(process.env.PORT || 8787);

let game: GameData | null = null;
let dataError: unknown;
try {
  game = loadGameData();
} catch (err) {
  dataError = err;
}

// Tiger Data when DATABASE_URL is set and the schema applies; memory otherwise.
let store: PlayStore = new MemoryStore();
let live: LiveStore = new MemoryLiveStore();
let civicStore: CivicStore = new MemoryCivicStore();
let storeNote = 'DATABASE_URL not set; plays are kept in memory';
if (process.env.DATABASE_URL) {
  const pool = new pg.Pool(poolConfig(process.env.DATABASE_URL));
  pool.on('error', () => {}); // idle client errors; queries report their own
  try {
    const prepared = await prepareTiger(pool, game?.bundle, game?.transit);
    store = new TigerStore(pool);
    live = new TigerLiveStore(pool);
    civicStore = new TigerCivicStore(pool);
    storeNote = `Tiger Data ready${prepared.seeded ? `, reference data loaded (build ${prepared.build})` : ''}`;
  } catch (err) {
    await pool.end().catch(() => {});
    storeNote = `Tiger Data unavailable (${(err as Error).message}); plays are kept in memory`;
  }
}

const log = { warn: (obj: unknown, msg: string) => app.log.warn(obj, msg) };
if (live.kind === 'tiger') live = failSoftLive(live, log);
// The civic record on Solana devnet (P16): the team key is the demo "local government".
const authority = loadAuthority();
const chain = authority.key ? devnetChain(authority.key) : null;
const civic = civicRecord({
  store: civicStore,
  chain,
  dataBuild: () => game?.bundle.meta?.buildDate ?? 'unknown',
  log: { info: (m) => app.log.info(m), warn: (o, m) => app.log.warn(o, m) },
});
const app = buildServer({ store: store.kind === 'tiger' ? failSoft(store, log) : store, data: () => game, live, civic });
app.log.info(chain ? `Solana devnet record on, authority ${chain.address} (${civicStore.kind})` : `Solana record off: ${authority.reason}`);
if (chain) chain.balanceSol().then((sol) => app.log.info(`Solana authority balance: ${sol} SOL (devnet)`), () => {});
app.log.info(storeNote);
if (game) {
  app.log.info(`game data: ${game.bundle.cells.length} cells, ${game.bundle.sites.length} sites from ${game.dir}`);
  // Warm the optimizer runs that score() and the planner cache (a few seconds, once).
  setImmediate(() => {
    score(game!.optimal('flood'), game!.bundle);
    game!.extended('flood');
    app.log.info('optimizer baselines ready');
  });
} else {
  app.log.warn({ err: dataError }, 'game data not loaded; plays keep the client score, /api/planner is off');
}

// Live river gauges and weather (P15), around the study area. LIVE_FEEDS=false turns them off.
if (game && process.env.LIVE_FEEDS !== 'false') {
  const { bbox, center } = studyArea(game.bundle);
  startLiveFeeds({ store: live, bbox, center, log: { info: (m) => app.log.info(m), warn: (o, m) => app.log.warn(o, m) } });
}

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
