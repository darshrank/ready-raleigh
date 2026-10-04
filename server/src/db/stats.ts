// GET /api/planner/live: what Tiger Data is doing right now, for the planner page. Plays per hour
// from the leaderboard_hourly continuous aggregate, the newest river readings streaming in, a river's
// last 48 hours from gauge_hourly, and how much the columnstore saved. Every query is timed, so the
// page shows real numbers.
import { performance } from 'node:perf_hooks';
import type pg from 'pg';

export interface TimedQuery {
  name: string;
  /** What it reads, for the panel: "continuous aggregate", "hypertable", "columnstore stats". */
  source: string;
  ms: number;
}

export interface LiveStats {
  store: 'tiger';
  generatedAt: string;
  queries: TimedQuery[];
  /** Plays per hour, last 24 hours, oldest first (all cities and rooms). */
  playsPerHour: { hour: string; plays: number }[];
  totals: { plays: number; players: number; placements: number; readings: number; readingsLastHour: number; gauges: number };
  /** Newest observations from the USGS and NWS feeds. */
  latestReadings: { time: string; site: string; name: string; parameter: string; value: number; unit: string | null }[];
  /** The river closest to its action stage, last 48 hours of hourly stage. */
  river: { site: string; name: string; actionFt: number | null; lastFt: number | null; hours: { hour: string; ft: number }[] } | null;
  compression: { table: string; chunks: number; compressedChunks: number; beforeBytes: number; afterBytes: number }[];
  /** Total on-disk size of the hypertables. */
  sizeBytes: number;
}

const COMPRESSED_TABLES = ['gauge_readings', 'plays', 'placements'] as const;

/**
 * Compresses the chunks the columnstore policies would (older than their `after`), now, instead of
 * waiting for the policy's schedule. Safe to repeat. Returns how many chunks it converted.
 */
export async function compressDue(pool: pg.Pool): Promise<number> {
  const due: [string, string][] = [['gauge_readings', '2 days'], ['plays', '7 days'], ['placements', '7 days']];
  let converted = 0;
  for (const [table, after] of due) {
    const { rows } = await pool.query<{ chunk: string }>(
      `SELECT c::text AS chunk FROM show_chunks($1::regclass, older_than => $2::interval) c
       WHERE NOT EXISTS (SELECT 1 FROM timescaledb_information.chunks i
                         WHERE format('%I.%I', i.chunk_schema, i.chunk_name) = c::text AND i.is_compressed)`, [table, after]);
    for (const { chunk } of rows) {
      await pool.query('CALL convert_to_columnstore($1::regclass, if_not_columnstore => true)', [chunk]);
      converted++;
    }
  }
  return converted;
}

export async function liveStats(pool: pg.Pool): Promise<LiveStats> {
  const queries: TimedQuery[] = [];
  // One after another: each timing is that query alone (round trip included), not a race for connections.
  const timed = async <T extends pg.QueryResultRow>(name: string, source: string, sql: string, args: unknown[] = []) => {
    const t = performance.now();
    const { rows } = await pool.query<T>(sql, args);
    queries.push({ name, source, ms: Math.round((performance.now() - t) * 10) / 10 });
    return rows;
  };

  const hours = await timed<{ hour: Date; plays: string }>('Plays per hour, 24 h', 'continuous aggregate leaderboard_hourly',
    `SELECT bucket AS hour, sum(plays)::bigint AS plays FROM leaderboard_hourly
     WHERE bucket > now() - INTERVAL '24 hours' GROUP BY bucket ORDER BY bucket`);
  const [t] = await timed<{ plays: string; players: string; placements: string; readings: string; last_hour: string; gauges: string }>(
    'Totals', 'hypertables plays, placements, gauge_readings',
    `SELECT (SELECT count(*) FROM plays) AS plays, (SELECT count(DISTINCT player_id) FROM plays) AS players,
       (SELECT count(*) FROM placements) AS placements, (SELECT count(*) FROM gauge_readings) AS readings,
       (SELECT count(*) FROM gauge_readings WHERE time > now() - INTERVAL '1 hour' AND time <= now()) AS last_hour,
       (SELECT count(*) FROM gauges) AS gauges`);
  const latest = await timed<{ time: Date; site: string; name: string; parameter: string; value: number; unit: string | null }>(
    'Newest readings', 'hypertable gauge_readings',
    `SELECT r.time, r.site_no AS site, coalesce(g.name, r.site_no) AS name, r.parameter, r.value, r.unit
     FROM gauge_readings r LEFT JOIN gauges g ON g.site_no = r.site_no
     WHERE r.time > now() - INTERVAL '6 hours' AND r.time <= now() AND r.parameter <> 'rain_forecast_mm'
     ORDER BY r.time DESC LIMIT 8`);
  const [r] = await timed<{ site: string; name: string; action_ft: number | null; last_ft: number | null; hours: { hour: string; ft: number }[] }>(
    'River closest to action stage, 48 h', 'continuous aggregate gauge_hourly',
    `WITH latest AS (
       SELECT DISTINCT ON (site_no) site_no, last_value FROM gauge_hourly
       WHERE parameter = 'stage_ft' AND bucket > now() - INTERVAL '6 hours' ORDER BY site_no, bucket DESC
     ), pick AS (
       SELECT g.site_no, g.name, g.action_ft, l.last_value FROM latest l JOIN gauges g USING (site_no)
       WHERE g.action_ft IS NOT NULL ORDER BY l.last_value / g.action_ft DESC LIMIT 1
     )
     SELECT p.site_no AS site, p.name, p.action_ft, p.last_value AS last_ft,
       coalesce(json_agg(json_build_object('hour', h.bucket, 'ft', round(h.avg_value::numeric, 2)) ORDER BY h.bucket)
         FILTER (WHERE h.bucket IS NOT NULL), '[]') AS hours
     FROM pick p LEFT JOIN gauge_hourly h ON h.site_no = p.site_no AND h.parameter = 'stage_ft' AND h.bucket > now() - INTERVAL '48 hours'
     GROUP BY p.site_no, p.name, p.action_ft, p.last_value`);
  const compression = await timed<{ tbl: string; total_chunks: string | null; number_compressed_chunks: string | null; before_compression_total_bytes: string | null; after_compression_total_bytes: string | null }>(
    'Compression per table', 'columnstore stats',
    `SELECT t.tbl, s.* FROM unnest($1::text[]) AS t(tbl), LATERAL hypertable_columnstore_stats(t.tbl::regclass) s`, [[...COMPRESSED_TABLES]]);
  const [size] = await timed<{ bytes: string }>('Size on disk', 'hypertable_size',
    `SELECT sum(hypertable_size(format('%I', hypertable_name)::regclass))::bigint AS bytes FROM timescaledb_information.hypertables`);

  const byTable = new Map(compression.map((c) => [c.tbl, c]));
  return {
    store: 'tiger',
    generatedAt: new Date().toISOString(),
    queries,
    playsPerHour: hours.map((h) => ({ hour: h.hour.toISOString(), plays: Number(h.plays) })),
    totals: {
      plays: Number(t?.plays ?? 0), players: Number(t?.players ?? 0), placements: Number(t?.placements ?? 0),
      readings: Number(t?.readings ?? 0), readingsLastHour: Number(t?.last_hour ?? 0), gauges: Number(t?.gauges ?? 0),
    },
    latestReadings: latest.map((x) => ({ ...x, time: x.time.toISOString() })),
    river: r ? { site: r.site, name: r.name, actionFt: r.action_ft, lastFt: r.last_ft, hours: r.hours.map((h) => ({ hour: h.hour, ft: Number(h.ft) })) } : null,
    compression: COMPRESSED_TABLES.map((table) => {
      const c = byTable.get(table);
      return {
        table, chunks: Number(c?.total_chunks ?? 0), compressedChunks: Number(c?.number_compressed_chunks ?? 0),
        beforeBytes: Number(c?.before_compression_total_bytes ?? 0), afterBytes: Number(c?.after_compression_total_bytes ?? 0),
      };
    }),
    sizeBytes: Number(size?.bytes ?? 0),
  };
}
