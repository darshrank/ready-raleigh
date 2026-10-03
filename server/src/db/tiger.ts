// Tiger Data store: plays and placements in TimescaleDB hypertables, crowd counts from the
// real-time continuous aggregates. prepareTiger() applies schema.sql and reloads the reference data.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { type DataBundle, floodRiskShare, weightedPeople } from '@shared';
import type { Crowd, PickCount, PlayRecord, PlayStore } from './store';

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
           protected_people, stranded_people, protected_weighted, at_risk_weighted, spent, plan, result, candidate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [id, createdAt, plan.mode, plan.roomCode, plan.playerId, plan.playerName, score.score,
          score.bestPossible, score.protectedPeople, score.strandedPeople, score.protectedWeighted,
          score.atRiskWeighted, plan.spent, plan, score, candidate],
      );
      if (placements.length > 0) {
        await client.query(
          `INSERT INTO placements (created_at, play_id, mode, room_code, type, target, cell)
           SELECT $1, $2, $3, $4, t.type, t.target, t.cell
           FROM unnest($5::text[], $6::text[], $7::int[]) AS t(type, target, cell)`,
          [createdAt, id, plan.mode, plan.roomCode, placements.map((p) => p.type),
            placements.map((p) => p.target), placements.map((p) => p.cell)],
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

  async crowd(mode: string): Promise<Crowd> {
    const [plays, picks] = await Promise.all([
      this.pool.query<{ plays: number }>(
        'SELECT coalesce(sum(plays), 0)::int AS plays FROM leaderboard_hourly WHERE mode = $1', [mode]),
      this.pool.query<PickCount>(
        `SELECT type, target, cell, sum(picks)::int AS picks FROM placements_hourly
         WHERE mode = $1 GROUP BY type, target, cell`, [mode]),
    ]);
    return { plays: plays.rows[0]?.plays ?? 0, picks: picks.rows };
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
export async function prepareTiger(pool: pg.Pool, data?: DataBundle) {
  for (const statement of schemaStatements()) await pool.query(statement);
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
