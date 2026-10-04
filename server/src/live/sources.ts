// Live feeds for P15. Every fetcher is plain fetch with a timeout; the parsers are pure so tests can
// feed them saved responses.
//   USGS Water Services (instantaneous values): stage and flow for every active gauge in a box.
//   NOAA NWPS: flood-stage thresholds (action, minor, moderate, major) per gauge.
//   NWS api.weather.gov: latest observation at the nearest station, rain forecast for the grid cell.

export type Bbox = [west: number, south: number, east: number, north: number];

/** One value at one time. site is a USGS site number, or 'nws:<id>' for weather. */
export interface Reading {
  time: Date;
  site: string;
  parameter: Parameter;
  value: number;
  unit: string;
}

export type Parameter = 'stage_ft' | 'flow_cfs' | 'temp_c' | 'rain_mm' | 'rain_forecast_mm' | 'wind_kph' | 'humidity_pct';

export interface FloodStages {
  action: number | null;
  minor: number | null;
  moderate: number | null;
  major: number | null;
}

export interface Gauge {
  site: string;
  name: string;
  lon: number;
  lat: number;
  /** NWS location id (e.g. CRBN7) when NOAA tracks this gauge. */
  nwsLid: string | null;
  flood: FloodStages | null;
}

const USER_AGENT = 'ReadyRaleigh/0.1 (WolfHacks 2026; github.com/darshrank/ready-raleigh)';
const TIMEOUT_MS = 20_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json, application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ---------- USGS ----------

const USGS_PARAMS: Record<string, { parameter: Parameter; unit: string }> = {
  '00065': { parameter: 'stage_ft', unit: 'ft' },
  '00060': { parameter: 'flow_cfs', unit: 'ft3/s' },
};

interface UsgsResponse {
  value: {
    timeSeries: {
      sourceInfo: {
        siteName: string;
        siteCode: { value: string }[];
        geoLocation: { geogLocation: { latitude: number; longitude: number } };
      };
      variable: { variableCode: { value: string }[]; noDataValue: number };
      values: { value: { value: string; dateTime: string }[] }[];
    }[];
  };
}

/** period is an ISO 8601 duration back from now, e.g. 'P7D' or 'PT2H'. */
export async function fetchUsgs(bbox: Bbox, period: string) {
  const url = 'https://waterservices.usgs.gov/nwis/iv/?format=json&siteStatus=active' +
    `&parameterCd=${Object.keys(USGS_PARAMS).join(',')}&period=${period}` +
    `&bBox=${bbox.map((v) => v.toFixed(4)).join(',')}`;
  return parseUsgs(await getJson<UsgsResponse>(url));
}

export function parseUsgs(body: UsgsResponse): { gauges: Gauge[]; readings: Reading[] } {
  const gauges = new Map<string, Gauge>();
  const readings: Reading[] = [];
  for (const ts of body.value?.timeSeries ?? []) {
    const site = ts.sourceInfo.siteCode[0]?.value;
    const param = USGS_PARAMS[ts.variable.variableCode[0]?.value ?? ''];
    if (!site || !param) continue;
    const { latitude, longitude } = ts.sourceInfo.geoLocation.geogLocation;
    if (!gauges.has(site)) {
      gauges.set(site, { site, name: titleCase(ts.sourceInfo.siteName), lon: longitude, lat: latitude, nwsLid: null, flood: null });
    }
    for (const v of ts.values[0]?.value ?? []) {
      const value = Number(v.value);
      if (!Number.isFinite(value) || value === ts.variable.noDataValue) continue;
      readings.push({ time: new Date(v.dateTime), site, parameter: param.parameter, value, unit: param.unit });
    }
  }
  return { gauges: [...gauges.values()], readings };
}

/** 'CRABTREE CREEK AT US 1 AT RALEIGH, NC' -> 'Crabtree Creek at US 1 at Raleigh, NC'. */
export function titleCase(name: string): string {
  const keep = new Set(['US', 'NC', 'SR', 'I']);
  const small = new Set(['AT', 'NEAR', 'BELOW', 'ABOVE', 'OF', 'IN', 'ON']);
  const expand: Record<string, string> = { NR: 'near', CR: 'Creek', TRIB: 'Tributary' };
  return name.trim().split(/\s+/).map((w, k) => {
    const bare = w.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (expand[bare]) return w.toUpperCase().replace(bare, expand[bare]);
    if (keep.has(bare) || /\d/.test(w)) return w;
    if (k > 0 && small.has(bare)) return w.toLowerCase();
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ');
}

// ---------- NOAA NWPS ----------

interface NwpsList {
  gauges: { lid: string; status?: { observed?: { floodCategory?: string } } }[];
}
interface NwpsGauge {
  lid: string;
  usgsId: string;
  name: string;
  flood?: { stageUnits?: string; categories?: Record<string, { stage: number }> };
}

/** Flood stages for the NOAA gauges in the box, keyed by USGS site number. */
export async function fetchFloodStages(bbox: Bbox): Promise<Map<string, { lid: string; flood: FloodStages }>> {
  const [w, s, e, n] = bbox;
  const list = await getJson<NwpsList>('https://api.water.noaa.gov/nwps/v1/gauges' +
    `?bbox.xmin=${w}&bbox.ymin=${s}&bbox.xmax=${e}&bbox.ymax=${n}&srid=EPSG_4326`);
  const lids = list.gauges
    .filter((g) => g.status?.observed?.floodCategory !== 'not_defined')
    .map((g) => g.lid);
  const out = new Map<string, { lid: string; flood: FloodStages }>();
  // A few at a time: NOAA asks clients to be gentle.
  for (let k = 0; k < lids.length; k += 6) {
    const details = await Promise.allSettled(lids.slice(k, k + 6)
      .map((lid) => getJson<NwpsGauge>(`https://api.water.noaa.gov/nwps/v1/gauges/${lid}`)));
    for (const d of details) {
      if (d.status !== 'fulfilled' || !d.value.usgsId) continue;
      const flood = parseFloodStages(d.value);
      if (flood) out.set(d.value.usgsId, { lid: d.value.lid, flood });
    }
  }
  return out;
}

export function parseFloodStages(g: NwpsGauge): FloodStages | null {
  const cats = g.flood?.categories;
  if (!cats || (g.flood?.stageUnits && g.flood.stageUnits !== 'ft')) return null;
  const stage = (k: string) => {
    const v = cats[k]?.stage;
    return typeof v === 'number' && v > -999 ? v : null;
  };
  const flood = { action: stage('action'), minor: stage('minor'), moderate: stage('moderate'), major: stage('major') };
  return Object.values(flood).some((v) => v !== null) ? flood : null;
}

// ---------- NWS ----------

interface NwsPoint {
  properties: { forecastGridData: string; observationStations: string; gridId: string; gridX: number; gridY: number };
}
interface NwsStations {
  features: { geometry?: { coordinates: [number, number] }; properties: { stationIdentifier: string; name: string } }[];
}
interface NwsValue {
  value: number | null;
  unitCode: string;
}
interface NwsObservations {
  features: {
    properties: {
      timestamp: string;
      textDescription?: string;
      temperature?: NwsValue;
      precipitationLastHour?: NwsValue;
      windSpeed?: NwsValue;
      relativeHumidity?: NwsValue;
    };
  }[];
}
interface NwsGrid {
  properties: { quantitativePrecipitation?: { uom: string; values: { validTime: string; value: number | null }[] } };
}

export interface WeatherPoint {
  station: string;
  stationName: string;
  /** The station's location (the point asked for when NWS does not give one). */
  lon: number;
  lat: number;
  gridId: string;
  forecastGridData: string;
}

/** The NWS station and forecast grid for a point (cache it; it does not change). */
export async function fetchWeatherPoint(lon: number, lat: number): Promise<WeatherPoint> {
  const point = await getJson<NwsPoint>(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const stations = await getJson<NwsStations>(point.properties.observationStations);
  const first = stations.features[0];
  if (!first) throw new Error('api.weather.gov: no observation station');
  const { gridId, gridX, gridY } = point.properties;
  const [sLon, sLat] = first.geometry?.coordinates ?? [lon, lat];
  return { station: first.properties.stationIdentifier, stationName: first.properties.name, lon: sLon, lat: sLat,
    gridId: `${gridId}/${gridX},${gridY}`, forecastGridData: point.properties.forecastGridData };
}

/** The station's recent observations and the grid's rain forecast, plus the newest conditions text. */
export async function fetchWeather(p: WeatherPoint, limit = 12): Promise<{ readings: Reading[]; conditions: Conditions | null }> {
  const [obs, grid] = await Promise.all([
    getJson<NwsObservations>(`https://api.weather.gov/stations/${p.station}/observations?limit=${limit}`),
    getJson<NwsGrid>(p.forecastGridData),
  ]);
  return {
    readings: [...parseObservations(obs, `nws:${p.station}`), ...parseRainForecast(grid, `nws:${p.gridId}`)],
    conditions: parseConditions(obs),
  };
}

export interface Conditions {
  text: string;
  time: Date;
}

/** The newest observation's words ("Light Rain", "Mostly Cloudy"); NWS lists the newest first. */
export function parseConditions(body: NwsObservations): Conditions | null {
  const withText = (body.features ?? [])
    .map((f) => f.properties)
    .filter((p) => p.textDescription?.trim())
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  return withText ? { text: withText.textDescription!.trim(), time: new Date(withText.timestamp) } : null;
}

export function parseObservations(body: NwsObservations, site: string): Reading[] {
  const out: Reading[] = [];
  for (const f of body.features ?? []) {
    const p = f.properties;
    const time = new Date(p.timestamp);
    if (p.temperature?.value != null && p.temperature.unitCode.endsWith('degC')) {
      out.push({ time, site, parameter: 'temp_c', value: p.temperature.value, unit: 'C' });
    }
    if (p.precipitationLastHour?.value != null) {
      // NWS reports precipitation in mm (wmoUnit:mm); a few stations report metres.
      const mm = p.precipitationLastHour.unitCode.endsWith(':m') ? p.precipitationLastHour.value * 1000 : p.precipitationLastHour.value;
      out.push({ time, site, parameter: 'rain_mm', value: mm, unit: 'mm' });
    }
    if (p.windSpeed?.value != null && p.windSpeed.unitCode.endsWith('km_h-1')) {
      out.push({ time, site, parameter: 'wind_kph', value: p.windSpeed.value, unit: 'km/h' });
    }
    if (p.relativeHumidity?.value != null && p.relativeHumidity.unitCode.endsWith('percent')) {
      out.push({ time, site, parameter: 'humidity_pct', value: p.relativeHumidity.value, unit: '%' });
    }
  }
  return out;
}

/** Forecast rain per period ('2026-10-03T18:00:00+00:00/PT6H'), stored at each period's start. */
export function parseRainForecast(body: NwsGrid, site: string): Reading[] {
  const q = body.properties?.quantitativePrecipitation;
  if (!q || !q.uom.endsWith('mm')) return [];
  return q.values
    .filter((v) => v.value !== null)
    .map((v) => ({ time: new Date(v.validTime.split('/')[0]!), site, parameter: 'rain_forecast_mm' as const,
      value: v.value!, unit: `mm/${v.validTime.split('/')[1] ?? ''}` }));
}
