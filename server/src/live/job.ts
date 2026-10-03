// Polls the live feeds into the live store: the last 7 days on start, then a short window every 15 min.
// Each feed fails on its own; a failure is logged and the next tick tries again.
import { cellToLatLng } from 'h3-js';
import type { DataBundle } from '@shared';
import {
  type Bbox, type WeatherPoint, fetchFloodStages, fetchUsgs, fetchWeather, fetchWeatherPoint,
} from './sources';
import type { LiveStore } from './store';

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

export function startLiveFeeds(opts: { store: LiveStore; bbox: Bbox; center: [number, number]; log: Log }) {
  const { store, bbox, center, log } = opts;
  let point: WeatherPoint | null = null;
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

  async function weather() {
    point ??= await fetchWeatherPoint(...center);
    const readings = await fetchWeather(point);
    await store.saveReadings(readings);
    log.info(`live: NWS ${point.station} + grid ${point.gridId}, ${readings.length} readings`);
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
