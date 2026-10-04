// Polls the live feeds into the live store: river gauges around the study area (the last 7 days on
// start, then a short window every 15 min) and the weather in every city.
// Each feed fails on its own; a failure is logged and the next tick tries again.
import { cellToLatLng } from 'h3-js';
import type { CityId, DataBundle } from '@shared';
import {
  type Bbox, type WeatherPoint, fetchFloodStages, fetchUsgs, fetchWeather, fetchWeatherPoint,
} from './sources';
import type { LiveStore } from './store';
import { CITY_POINTS } from './weather';

export const POLL_MS = 15 * 60_000;
export const BACKFILL_PERIOD = 'P7D';
const POLL_PERIOD = 'PT3H';
const FLOOD_STAGES_EVERY_MS = 24 * 3600_000;

interface Log {
  info(msg: string): void;
  warn(obj: unknown, msg: string): void;
}

/** The study area's bounding box from its cells, padded about 1 km, and its center. */
export function studyArea(data: DataBundle, padDeg = 0.01): { bbox: Bbox; center: [number, number] } {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of data.cells) {
    const [lat, lon] = cellToLatLng(c.h3);
    w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat);
  }
  return { bbox: [w - padDeg, s - padDeg, e + padDeg, n + padDeg], center: [(w + e) / 2, (s + n) / 2] };
}

export function startLiveFeeds(opts: {
  store: LiveStore;
  bbox: Bbox;
  /** Where to ask for each city's weather (default: every city's center). */
  cities?: Partial<Record<CityId, { lon: number; lat: number }>>;
  log: Log;
}) {
  const { store, bbox, cities = CITY_POINTS, log } = opts;
  const points = new Map<CityId, WeatherPoint>();
  let stagesAt = 0;
  let first = true;
  let running: Promise<void> | null = null;

  async function rivers() {
    const t0 = Date.now();
    const { gauges, readings } = await fetchUsgs(bbox, first ? BACKFILL_PERIOD : POLL_PERIOD);
    if (Date.now() - stagesAt > FLOOD_STAGES_EVERY_MS) {
      try {
        const stages = await fetchFloodStages(bbox);
        for (const g of gauges) {
          const s = stages.get(g.site);
          if (s) Object.assign(g, { nwsLid: s.lid, flood: s.flood });
        }
        stagesAt = Date.now();
      } catch (err) {
        log.warn({ err }, 'live: NOAA flood stages failed; keeping the stored ones');
      }
    }
    await store.saveGauges(gauges);
    await store.saveReadings(readings);
    log.info(`live: USGS ${gauges.length} gauges, ${readings.length} readings (${first ? BACKFILL_PERIOD : POLL_PERIOD}) in ${Date.now() - t0} ms`);
  }

  async function weatherIn(city: CityId, at: { lon: number; lat: number }) {
    let point = points.get(city);
    const first = !point;
    if (!point) {
      point = await fetchWeatherPoint(at.lon, at.lat);
      points.set(city, point);
    }
    // The first poll backfills about a day of observations (stations report hourly or more often).
    const { readings, conditions } = await fetchWeather(point, first ? 100 : 12);
    await store.saveReadings(readings);
    await store.saveStation({
      city, station: point.station, name: point.stationName, lon: point.lon, lat: point.lat,
      gridSite: `nws:${point.gridId}`, conditions: conditions?.text ?? null, observedAt: conditions?.time ?? null,
    });
    log.info(`live: NWS ${city} ${point.station} + grid ${point.gridId}, ${readings.length} readings`);
  }

  /** Every city's weather; one city failing does not stop the others. */
  async function weather() {
    const entries = Object.entries(cities) as [CityId, { lon: number; lat: number }][];
    const results = await Promise.allSettled(entries.map(([city, at]) => weatherIn(city, at)));
    const failed = results.flatMap((r, k) => (r.status === 'rejected' ? [`${entries[k]![0]}: ${(r.reason as Error)?.message ?? r.reason}`] : []));
    if (failed.length === entries.length) throw new Error(failed.join('; '));
    if (failed.length > 0) log.warn({ failed }, 'live: NWS weather failed for some cities');
  }

  /** One poll of every feed. Overlapping calls share the running poll. */
  function tick(): Promise<void> {
    running ??= (async () => {
      const [r, w] = await Promise.allSettled([rivers(), weather()]);
      if (r.status === 'rejected') log.warn({ err: r.reason }, 'live: USGS poll failed');
      if (w.status === 'rejected') log.warn({ err: w.reason }, 'live: NWS poll failed');
      if (r.status === 'fulfilled') first = false;
    })().finally(() => { running = null; });
    return running;
  }

  const ready = tick();
  const timer = setInterval(() => void tick(), POLL_MS);
  timer.unref();
  return { ready, tick, stop: () => clearInterval(timer) };
}
