// GET /api/live/gauges: the latest reading per gauge, its trend, and how close it is to flood stage.
import type { FloodStages, Gauge, Reading } from './sources';

export type FloodCategory = 'none' | 'action' | 'minor' | 'moderate' | 'major';
export type Trend = 'rising' | 'falling' | 'steady';

export interface GaugeStatus {
  site: string;
  name: string;
  lon: number;
  lat: number;
  nwsLid: string | null;
  time: string;
  stageFt: number | null;
  flowCfs: number | null;
  trend: Trend | null;
  /** Stage change over about the last hour, feet. */
  change1hFt: number | null;
  flood: FloodStages | null;
  /** NWS category for the current stage; null when the gauge has no flood stages. */
  category: FloodCategory | null;
  /** Feet below minor flood stage (negative when above it). */
  belowFloodFt: number | null;
}

export interface LiveWeather {
  station: string;
  time: string;
  tempC: number | null;
  rainLastHourMm: number | null;
  rainNext24hMm: number | null;
}

export interface LiveSummary {
  updatedAt: string | null;
  /** True when the newest gauge reading is older than STALE_MS. */
  stale: boolean;
  headline: string | null;
  gauges: GaugeStatus[];
  weather: LiveWeather | null;
}

/** A trend needs at least this change in an hour, feet. */
export const TREND_FT = 0.1;
export const STALE_MS = 2 * 3600_000;
const SEVERITY: Record<FloodCategory, number> = { none: 0, action: 1, minor: 2, moderate: 3, major: 4 };

export function categoryOf(stage: number, flood: FloodStages): FloodCategory {
  for (const c of ['major', 'moderate', 'minor', 'action'] as const) {
    const at = flood[c];
    if (at !== null && stage >= at) return c;
  }
  return 'none';
}

const floodLine = (f: FloodStages) => f.minor ?? f.moderate ?? f.major;

export function summarize(gauges: Gauge[], readings: Reading[], now = new Date()): LiveSummary {
  // Latest stage/flow per site and the stage series for trends (readings come oldest first).
  const series = new Map<string, Reading[]>();
  for (const r of readings) {
    if (r.time > now) continue;
    const k = `${r.site}|${r.parameter}`;
    const list = series.get(k);
    if (list) list.push(r);
    else series.set(k, [r]);
  }
  const latest = (site: string, p: Reading['parameter']) => series.get(`${site}|${p}`)?.at(-1) ?? null;

  const statuses: GaugeStatus[] = [];
  for (const g of gauges) {
    const stage = latest(g.site, 'stage_ft');
    const flow = latest(g.site, 'flow_cfs');
    const last = stage ?? flow;
    if (!last) continue;
    let change1hFt: number | null = null;
    if (stage) {
      const target = stage.time.getTime() - 3600_000;
      const before = (series.get(`${g.site}|stage_ft`) ?? [])
        .filter((r) => Math.abs(r.time.getTime() - target) <= 30 * 60_000)
        .sort((a, b) => Math.abs(a.time.getTime() - target) - Math.abs(b.time.getTime() - target))[0];
      if (before) change1hFt = round(stage.value - before.value, 2);
    }
    const line = g.flood ? floodLine(g.flood) : null;
    statuses.push({
      site: g.site, name: g.name, lon: g.lon, lat: g.lat, nwsLid: g.nwsLid, time: last.time.toISOString(),
      stageFt: stage?.value ?? null, flowCfs: flow?.value ?? null,
      trend: change1hFt === null ? null : change1hFt >= TREND_FT ? 'rising' : change1hFt <= -TREND_FT ? 'falling' : 'steady',
      change1hFt, flood: g.flood,
      category: stage && g.flood ? categoryOf(stage.value, g.flood) : null,
      belowFloodFt: stage && line != null ? round(line - stage.value, 2) : null,
    });
  }
  // Most urgent first: flood category, then closest to flood stage, then the rest by name.
  const closeness = (s: GaugeStatus) => {
    const line = s.flood ? floodLine(s.flood) : null;
    return s.stageFt !== null && line ? s.stageFt / line : -1;
  };
  statuses.sort((a, b) => SEVERITY[b.category ?? 'none'] - SEVERITY[a.category ?? 'none'] ||
    closeness(b) - closeness(a) || a.name.localeCompare(b.name));

  const newest = statuses.reduce<number>((t, s) => Math.max(t, Date.parse(s.time)), 0);
  const fresh = statuses.filter((s) => now.getTime() - Date.parse(s.time) <= STALE_MS);
  return {
    updatedAt: newest ? new Date(newest).toISOString() : null,
    stale: newest === 0 || now.getTime() - newest > STALE_MS,
    headline: headlineOf(fresh.find((s) => s.stageFt !== null && s.belowFloodFt !== null) ?? fresh.find((s) => s.stageFt !== null)),
    gauges: statuses,
    weather: weatherOf(readings, now),
  };
}

/** "Crabtree Creek at US 1 at Raleigh, NC: 0.5 ft and steady, 17.5 ft below flood stage." */
export function headlineOf(s: GaugeStatus | undefined): string | null {
  if (!s || s.stageFt === null) return null;
  const trend = s.trend ? ` and ${s.trend}` : '';
  let flood = '';
  if (s.category && s.category !== 'none' && s.category !== 'action') flood = `, ${s.category} flooding`;
  else if (s.belowFloodFt !== null) flood = s.category === 'action'
    ? `, at action stage, ${fmt(s.belowFloodFt)} ft below flood stage`
    : `, ${fmt(s.belowFloodFt)} ft below flood stage`;
  return `${s.name}: ${fmt(s.stageFt)} ft${trend}${flood}.`;
}

function weatherOf(readings: Reading[], now: Date): LiveWeather | null {
  const weather = readings.filter((r) => r.site.startsWith('nws:'));
  const observed = weather.filter((r) => r.time <= now && r.parameter !== 'rain_forecast_mm');
  const latest = (p: Reading['parameter']) => observed.filter((r) => r.parameter === p).at(-1) ?? null;
  const temp = latest('temp_c');
  const rain = latest('rain_mm');
  const horizon = now.getTime() + 24 * 3600_000;
  const forecast = weather.filter((r) => r.parameter === 'rain_forecast_mm' &&
    r.time.getTime() >= now.getTime() - 3600_000 && r.time.getTime() < horizon);
  const station = (temp ?? rain)?.site.slice(4) ?? forecast[0]?.site.slice(4);
  if (!station) return null;
  return {
    station,
    time: (temp ?? rain)?.time.toISOString() ?? now.toISOString(),
    tempC: temp?.value ?? null,
    rainLastHourMm: rain?.value ?? null,
    rainNext24hMm: forecast.length > 0 ? round(forecast.reduce((s, r) => s + r.value, 0), 1) : null,
  };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));
