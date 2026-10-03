// Where live readings go: the gauge_readings hypertable on Tiger Data, or memory without a database.
import type pg from 'pg';
import type { FloodStages, Gauge, Parameter, Reading } from './sources';

export interface HourlyRow {
  bucket: Date;
  parameter: Parameter;
  avg: number;
  min: number;
  max: number;
  last: number;
  readings: number;
}

export interface LiveStore {
  readonly kind: 'tiger' | 'memory';
  /** Upsert gauges. Missing flood stages keep the stored ones. */
  saveGauges(gauges: Gauge[]): Promise<void>;
  gauges(): Promise<Gauge[]>;
  /** Upsert readings (USGS revises provisional values; forecasts change). */
  saveReadings(readings: Reading[]): Promise<void>;
  /** Readings at or after `since`, forecasts included. */
  recent(since: Date): Promise<Reading[]>;
  /** Hourly stats for one site, oldest first. */
  hourly(site: string, since: Date): Promise<HourlyRow[]>;
}

const KEEP_MS = 8 * 24 * 3600_000;

export class MemoryLiveStore implements LiveStore {
  readonly kind = 'memory';
  private readonly gaugeMap = new Map<string, Gauge>();
  private readonly readingMap = new Map<string, Reading>();

  async saveGauges(gauges: Gauge[]) {
    for (const g of gauges) {
      const old = this.gaugeMap.get(g.site);
      this.gaugeMap.set(g.site, { ...g, nwsLid: g.nwsLid ?? old?.nwsLid ?? null, flood: g.flood ?? old?.flood ?? null });
    }
  }

  async gauges() {
    return [...this.gaugeMap.values()];
  }

  async saveReadings(readings: Reading[]) {
    for (const r of readings) this.readingMap.set(`${r.site}|${r.parameter}|${r.time.getTime()}`, r);
    const cutoff = Date.now() - KEEP_MS;
    for (const [k, r] of this.readingMap) if (r.time.getTime() < cutoff) this.readingMap.delete(k);
  }

  async recent(since: Date) {
    return [...this.readingMap.values()].filter((r) => r.time >= since).sort((a, b) => +a.time - +b.time);
  }

  async hourly(site: string, since: Date) {
    const buckets = new Map<string, Reading[]>();
    for (const r of await this.recent(since)) {
      if (r.site !== site) continue;
      const hour = Math.floor(r.time.getTime() / 3600_000) * 3600_000;
      const k = `${hour}|${r.parameter}`;
      const list = buckets.get(k);
      if (list) list.push(r);
      else buckets.set(k, [r]);
    }
    return [...buckets.entries()].map(([k, rs]) => {
      const values = rs.map((r) => r.value);
      return {
        bucket: new Date(Number(k.split('|')[0])), parameter: rs[0]!.parameter,
        avg: values.reduce((s, v) => s + v, 0) / values.length, min: Math.min(...values), max: Math.max(...values),
        last: rs.at(-1)!.value, readings: rs.length,
      };
    }).sort((a, b) => +a.bucket - +b.bucket || a.parameter.localeCompare(b.parameter));
  }
}

export class TigerLiveStore implements LiveStore {
  readonly kind = 'tiger';
  constructor(readonly pool: pg.Pool) {}

  async saveGauges(gauges: Gauge[]) {
    if (gauges.length === 0) return;
    const stage = (k: keyof FloodStages) => gauges.map((g) => g.flood?.[k] ?? null);
    await this.pool.query(
      `INSERT INTO gauges (site_no, name, lon, lat, nws_lid, action_ft, minor_ft, moderate_ft, major_ft)
       SELECT * FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::text[], $6::float8[],
         $7::float8[], $8::float8[], $9::float8[])
       ON CONFLICT (site_no) DO UPDATE SET name = EXCLUDED.name, lon = EXCLUDED.lon, lat = EXCLUDED.lat,
         nws_lid = coalesce(EXCLUDED.nws_lid, gauges.nws_lid),
         action_ft = coalesce(EXCLUDED.action_ft, gauges.action_ft),
         minor_ft = coalesce(EXCLUDED.minor_ft, gauges.minor_ft),
         moderate_ft = coalesce(EXCLUDED.moderate_ft, gauges.moderate_ft),
         major_ft = coalesce(EXCLUDED.major_ft, gauges.major_ft),
         updated_at = now()`,
      [gauges.map((g) => g.site), gauges.map((g) => g.name), gauges.map((g) => g.lon), gauges.map((g) => g.lat),
        gauges.map((g) => g.nwsLid), stage('action'), stage('minor'), stage('moderate'), stage('major')],
    );
  }

  async gauges(): Promise<Gauge[]> {
    const { rows } = await this.pool.query<{
      site_no: string; name: string; lon: number; lat: number; nws_lid: string | null;
      action_ft: number | null; minor_ft: number | null; moderate_ft: number | null; major_ft: number | null;
    }>('SELECT * FROM gauges ORDER BY site_no');
    return rows.map((r) => {
      const flood = { action: r.action_ft, minor: r.minor_ft, moderate: r.moderate_ft, major: r.major_ft };
      return { site: r.site_no, name: r.name, lon: r.lon, lat: r.lat, nwsLid: r.nws_lid,
        flood: Object.values(flood).some((v) => v !== null) ? flood : null };
    });
  }

  async saveReadings(readings: Reading[]) {
    // Duplicates in one statement would make ON CONFLICT fail; keep the last of each key.
    const unique = [...new Map(readings.map((r) => [`${r.site}|${r.parameter}|${r.time.getTime()}`, r])).values()];
    for (let k = 0; k < unique.length; k += 5_000) {
      const batch = unique.slice(k, k + 5_000);
      await this.pool.query(
        `INSERT INTO gauge_readings (time, site_no, parameter, value, unit)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::float8[], $5::text[])
         ON CONFLICT (site_no, parameter, time) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit`,
        [batch.map((r) => r.time), batch.map((r) => r.site), batch.map((r) => r.parameter),
          batch.map((r) => r.value), batch.map((r) => r.unit)],
      );
    }
  }

  async recent(since: Date): Promise<Reading[]> {
    const { rows } = await this.pool.query<{ time: Date; site_no: string; parameter: Parameter; value: number; unit: string }>(
      'SELECT time, site_no, parameter, value, unit FROM gauge_readings WHERE time >= $1 ORDER BY time', [since]);
    return rows.map((r) => ({ time: r.time, site: r.site_no, parameter: r.parameter, value: r.value, unit: r.unit }));
  }

  async hourly(site: string, since: Date): Promise<HourlyRow[]> {
    const { rows } = await this.pool.query<HourlyRow>(
      `SELECT bucket, parameter, avg_value AS avg, min_value AS min, max_value AS max, last_value AS last,
         readings::int AS readings
       FROM gauge_hourly WHERE site_no = $1 AND bucket >= $2 ORDER BY bucket, parameter`, [site, since]);
    return rows;
  }
}

interface Log {
  warn(obj: unknown, msg: string): void;
}

/**
 * Tiger with a memory mirror: every write also lands in memory, and a failed Tiger read answers from
 * memory, so the live panel keeps working through a database outage.
 */
export function failSoftLive(primary: LiveStore, log: Log): LiveStore {
  const mirror = new MemoryLiveStore();
  const read = async <T>(what: string, tiger: () => Promise<T>, memory: () => Promise<T>) => {
    try {
      return await tiger();
    } catch (err) {
      log.warn({ err }, `live ${what} read failed; answering from memory`);
      return memory();
    }
  };
  const write = async (what: string, tiger: () => Promise<void>, memory: () => Promise<void>) => {
    await memory();
    try {
      await tiger();
    } catch (err) {
      log.warn({ err }, `live ${what} write failed; kept in memory`);
    }
  };
  return {
    kind: primary.kind,
    saveGauges: (g) => write('gauges', () => primary.saveGauges(g), () => mirror.saveGauges(g)),
    saveReadings: (r) => write('readings', () => primary.saveReadings(r), () => mirror.saveReadings(r)),
    gauges: () => read('gauges', () => primary.gauges(), () => mirror.gauges()),
    recent: (since) => read('recent', () => primary.recent(since), () => mirror.recent(since)),
    hourly: (site, since) => read('hourly', () => primary.hourly(site, since), () => mirror.hourly(site, since)),
  };
}
