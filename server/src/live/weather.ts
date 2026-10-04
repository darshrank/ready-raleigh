// Weather right now in each city (the title screen's report): NWS observations and rain forecast,
// polled for every city center into Tiger Data. Numbers go to the gauge_readings hypertable; the
// station and its latest conditions text go to weather_stations.
import type { CityId } from '@shared';
import type { HourlyRow } from './store';
import type { Reading } from './sources';

/** Where each city's weather is asked for: its center, as on the app's city cards. */
export const CITY_POINTS: Record<CityId, { lon: number; lat: number }> = {
  raleigh: { lon: -78.6382, lat: 35.7796 },
  miami: { lon: -80.1918, lat: 25.7617 },
  'new-york': { lon: -73.915, lat: 40.832 },
  'san-francisco': { lon: -122.4194, lat: 37.7749 },
};

export interface WeatherStation {
  city: CityId;
  /** NWS station id, e.g. KRDU; its readings are at site 'nws:<station>'. */
  station: string;
  name: string;
  lon: number;
  lat: number;
  /** The forecast grid's site, e.g. 'nws:RAH/74,60'. */
  gridSite: string;
  conditions: string | null;
  observedAt: Date | null;
}

export interface CityWeather {
  city: CityId;
  station: string;
  stationName: string;
  observedAt: string | null;
  /** True when the newest observation is older than STALE_WEATHER_MS. */
  stale: boolean;
  conditions: string | null;
  tempC: number | null;
  tempF: number | null;
  windMph: number | null;
  humidityPct: number | null;
  rainLastHourMm: number | null;
  rainNext24hMm: number | null;
  /** Hourly temperature for the last 24 hours, from the gauge_hourly continuous aggregate. */
  tempTrend: { hour: string; tempC: number }[];
}

export const STALE_WEATHER_MS = 3 * 3600_000;
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/** The weather report for one city from its station, recent readings and hourly rows. */
export function cityWeather(s: WeatherStation, readings: Reading[], hourly: HourlyRow[], now = new Date()): CityWeather {
  const site = `nws:${s.station}`;
  const observed = readings.filter((r) => r.site === site && r.time <= now);
  const latest = (p: Reading['parameter']) => observed.filter((r) => r.parameter === p).sort((a, b) => +a.time - +b.time).at(-1) ?? null;
  const temp = latest('temp_c');
  const newest = observed.reduce<Date | null>((t, r) => (!t || r.time > t ? r.time : t), s.observedAt);
  const horizon = now.getTime() + 24 * 3600_000;
  const forecast = readings.filter((r) => r.site === s.gridSite && r.parameter === 'rain_forecast_mm' &&
    r.time.getTime() >= now.getTime() - 3600_000 && r.time.getTime() < horizon);
  const wind = latest('wind_kph');
  return {
    city: s.city,
    station: s.station,
    stationName: s.name,
    observedAt: newest?.toISOString() ?? null,
    stale: !newest || now.getTime() - newest.getTime() > STALE_WEATHER_MS,
    conditions: s.conditions,
    tempC: temp ? round(temp.value, 1) : null,
    tempF: temp ? round(temp.value * 1.8 + 32) : null,
    windMph: wind ? round(wind.value / 1.609) : null,
    humidityPct: latest('humidity_pct') ? round(latest('humidity_pct')!.value) : null,
    rainLastHourMm: latest('rain_mm') ? round(latest('rain_mm')!.value, 1) : null,
    rainNext24hMm: forecast.length > 0 ? round(forecast.reduce((t, r) => t + r.value, 0), 1) : null,
    tempTrend: hourly.filter((h) => h.parameter === 'temp_c').map((h) => ({ hour: new Date(h.bucket).toISOString(), tempC: round(h.avg, 1) })),
  };
}
