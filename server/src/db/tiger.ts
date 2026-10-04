// Tiger Data store: plays and placements in TimescaleDB hypertables, crowd counts from the
// real-time continuous aggregates. prepareTiger() applies schema.sql and reloads the reference data.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { type DataBundle, floodRiskShare, weightedPeople } from '@shared';
import type { TransitStops } from '../data';
import { type Crowd, type PickCount, type PickupPicks, type PlayRecord, type PlayStore, cityOfPlay } from './store';

/**
 * Pool options from a connection URL. sslmode is turned into an explicit `ssl` option: node-postgres
 * already verifies the certificate for sslmode=require and warns about it on every connect.
 */
export function poolConfig(url: string): pg.PoolConfig {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get('sslmode');
  parsed.searchParams.delete('sslmode');
  return {
    connectionString: parsed.toString(),
    ssl: sslmode && sslmode !== 'disable' ? { rejectUnauthorized: true } : undefined,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  };
}

export class TigerStore implements PlayStore {
  readonly kind = 'tiger';
  constructor(readonly pool: pg.Pool) {}

  async savePlay({ id, createdAt, plan, score, placements, candidate = null }: PlayRecord) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO plays (id, created_at, mode, room_code, player_id, player_name, score, best_possible,
           protected_people, stranded_people, protected_weighted, at_risk_weighted, spent, plan, result, candidate, city)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [id, createdAt, plan.mode, plan.roomCode, plan.playerId, plan.playerName, score.score,
          score.bestPossible, score.protectedPeople, score.strandedPeople, score.protectedWeighted,
          score.atRiskWeighted, plan.spent, plan, score, candidate, cityOfPlay(plan)],
      );
      if (placements.length > 0) {
        await client.query(
          `INSERT INTO placements (created_at, play_id, mode, room_code, type, target, cell, city)
           SELECT $1, $2, $3, $4, t.type, t.target, t.cell, $8
           FROM unnest($5::text[], $6::text[], $7::int[]) AS t(type, target, cell)`,
          [createdAt, id, plan.mode, plan.roomCode, placements.map((p) => p.type),
            placements.map((p) => p.target), placements.map((p) => p.cell), cityOfPlay(plan)],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async crowd(mode: string, city: string = 'raleigh'): Promise<Crowd> {
    const [plays, picks] = await Promise.all([
      this.pool.query<{ plays: number }>('SELECT count(*)::int AS plays FROM plays WHERE mode = $1 AND city = $2', [mode, city]),
      this.pool.query<PickCount>(
        `SELECT type, target, cell, sum(picks)::int AS picks FROM crowd_hourly
         WHERE mode = $1 AND city = $2 GROUP BY type, target, cell`, [mode, city]),
    ]);
    return { plays: plays.rows[0]?.plays ?? 0, picks: picks.rows };
  }

  async pickups(mode: string, since: Date, city: string = 'raleigh'): Promise<PickupPicks> {
    const [counts, picks] = await Promise.all([
      this.pool.query<{ plays: number; players: number }>(
        `SELECT count(*)::int AS plays, count(DISTINCT player_id)::int AS players
         FROM plays WHERE mode = $1 AND city = $3 AND created_at >= $2`, [mode, since, city]),
      this.pool.query<{ cell: number; player: string; target: string }>(
        `SELECT p.cell, pl.player_id AS player, p.target
         FROM placements p JOIN plays pl ON pl.id = p.play_id AND pl.created_at = p.created_at
         WHERE p.type = 'bus_pickup' AND p.mode = $1 AND pl.city = $3 AND p.cell IS NOT NULL AND p.created_at >= $2`, [mode, since, city]),
    ]);
    const rows = picks.rows.map(({ cell, player, target }) => ({ cell, player, ...(target.startsWith('stop:') ? { stopId: target.slice(5) } : {}) }));
    return { plays: counts.rows[0]?.plays ?? 0, players: counts.rows[0]?.players ?? 0, picks: rows };
  }

  async pickers(mode: string, targets: string[], limit: number): Promise<{ playId: string; playerId: string }[]> {
    const { rows } = await this.pool.query<{ playId: string; playerId: string }>(
      `SELECT DISTINCT ON (pl.created_at, pl.id) pl.id::text AS "playId", pl.player_id AS "playerId"
       FROM placements p JOIN plays pl ON pl.id = p.play_id AND pl.created_at = p.created_at
       WHERE p.mode = $1 AND p.target = ANY($2::text[])
       ORDER BY pl.created_at DESC, pl.id LIMIT $3`, [mode, targets, limit]);
    return rows;
  }

  async bestScore(mode: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ best: number | null }>('SELECT max(score) AS best FROM plays WHERE mode = $1', [mode]);
    return rows[0]?.best ?? null;
  }

  async close() {
    await this.pool.end();
  }
}

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** schema.sql as single statements (continuous aggregates cannot run in a multi-statement query). */
export function schemaStatements(sql = SCHEMA): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

/** Applies the schema and reloads cells/sites/roads if the data build changed. Returns what it did. */
export async function prepareTiger(pool: pg.Pool, data?: DataBundle, transit?: TransitStops | null) {
  for (const statement of schemaStatements()) await pool.query(statement);
  if (transit) await seedTransit(pool, transit);
  if (!data) return { seeded: false };
  const build = data.meta?.buildDate ?? 'unknown';
  const last = await pool.query<{ build_date: string; cells: number; sites: number }>(
    'SELECT build_date, cells, sites FROM data_builds ORDER BY loaded_at DESC LIMIT 1');
  const row = last.rows[0];
  if (row && row.build_date === build && row.cells === data.cells.length && row.sites === data.sites.length) {
    return { seeded: false, build };
  }
  await seedReference(pool, data, build);
  return { seeded: true, build };
}

async function seedReference(pool: pg.Pool, data: DataBundle, build: string) {
  const { cells, sites, floodRoads } = data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE cells, sites, flood_roads');
    await client.query(
      `INSERT INTO cells SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::float8[], $5::float8[],
         $6::float8[], $7::float8[], $8::float8[], $9::smallint[], $10::float8[], $11::bool[], $12::float8[],
         $13::float8[], $14::float8[])`,
      [cells.map((c) => c.i), cells.map((c) => c.h3), cells.map((c) => c.hood), cells.map((c) => c.pop),
        cells.map((c) => c.pop65), cells.map((c) => c.lowInc), cells.map((c) => c.noCarHH),
        cells.map((c) => weightedPeople(c)), cells.map((c) => c.floodStep), cells.map((c) => c.floodFrac),
        cells.map((c) => c.cutOff), cells.map((c) => weightedPeople(c) * floodRiskShare(c)),
        cells.map((c) => c.heatC), cells.map((c) => c.treePct)],
    );
    await client.query(
      `INSERT INTO sites SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[],
         $6::int[], $7::smallint[])`,
      [sites.map((s) => s.id), sites.map((s) => s.name), sites.map((s) => s.kind), sites.map((s) => s.lon),
        sites.map((s) => s.lat), sites.map((s) => s.cell), sites.map((s) => s.floodStep)],
    );
    // unnest flattens a 2D array, so each road's unlocks go in as one row at a time.
    for (const r of floodRoads) {
      await client.query('INSERT INTO flood_roads VALUES ($1, $2, $3, $4)', [r.id, r.name, r.floodStep, r.unlocks]);
    }
    await client.query('INSERT INTO data_builds (build_date, cells, sites) VALUES ($1, $2, $3)',
      [build, cells.length, sites.length]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Existing bus stops, reloaded when the transit file was rebuilt. */
async function seedTransit(pool: pg.Pool, transit: TransitStops) {
  const { rows } = await pool.query<{ built: string | null }>('SELECT max(built) AS built FROM transit_stops');
  if (rows[0]?.built === transit.built) return;
  const { stops, sources } = transit;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE transit_stops');
    await client.query(
      `INSERT INTO transit_stops (agency, name, lon, lat, feed_end, built)
       SELECT * FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::date[], $6::text[])`,
      [stops.map((s) => sources[s[3]]?.agency ?? ''), stops.map((s) => s[2]), stops.map((s) => s[0]),
        stops.map((s) => s[1]), stops.map((s) => sources[s[3]]?.feedEnd ?? null), stops.map(() => transit.built)],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
