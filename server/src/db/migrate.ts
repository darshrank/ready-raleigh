// npm run db:migrate -w server: apply schema.sql to Tiger Data and reload the reference data.
// The server does the same on start; this is for checking the database by hand.
import pg from 'pg';
import { loadGameData } from '../data';
import { poolConfig, prepareTiger } from './tiger';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (root .env)');
  process.exit(1);
}
const pool = new pg.Pool(poolConfig(url));
try {
  const game = loadGameData();
  const t0 = performance.now();
  const result = await prepareTiger(pool, game.bundle);
  console.log(`schema applied; ${result.seeded ? `reference data loaded (build ${result.build})` : 'reference data up to date'} ` +
    `from ${game.dir} in ${Math.round(performance.now() - t0)} ms`);
  const counts = await pool.query(`SELECT (SELECT count(*) FROM plays)::int AS plays,
    (SELECT count(*) FROM placements)::int AS placements, (SELECT count(*) FROM cells)::int AS cells,
    (SELECT count(*) FROM sites)::int AS sites, (SELECT count(*) FROM flood_roads)::int AS flood_roads`);
  console.log(counts.rows[0]);
} finally {
  await pool.end();
}
