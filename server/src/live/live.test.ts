import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../app';
import { parseConditions, parseFloodStages, parseObservations, parseRainForecast, parseUsgs, titleCase, type Gauge } from './sources';
import { cityWeather, type WeatherStation } from './weather';
import { MemoryLiveStore } from './store';
import { categoryOf, summarize } from './summary';

// Trimmed from real responses (USGS IV 2026-10-03, NWPS CRBN7, NWS KRDU and RAH grid).
const usgs = {
  value: {
    timeSeries: [
      {
        sourceInfo: {
          siteName: 'CRABTREE CREEK AT US 1 AT RALEIGH, NC',
          siteCode: [{ value: '02087324' }],
          geoLocation: { geogLocation: { latitude: 35.8111, longitude: -78.6119 } },
        },
        variable: { variableCode: [{ value: '00065' }], noDataValue: -999999 },
        values: [{ value: [
          { value: '0.31', dateTime: '2026-10-03T16:10:00.000-04:00' },
          { value: '-999999', dateTime: '2026-10-03T16:40:00.000-04:00' },
          { value: '0.51', dateTime: '2026-10-03T17:10:00.000-04:00' },
        ] }],
      },
      {
        sourceInfo: {
          siteName: 'CRABTREE CREEK AT US 1 AT RALEIGH, NC',
          siteCode: [{ value: '02087324' }],
          geoLocation: { geogLocation: { latitude: 35.8111, longitude: -78.6119 } },
        },
        variable: { variableCode: [{ value: '00060' }], noDataValue: -999999 },
        values: [{ value: [{ value: '79.7', dateTime: '2026-10-03T17:10:00.000-04:00' }] }],
      },
      {
        sourceInfo: {
          siteName: 'WALNUT CREEK AT SUNNYBROOK DRIVE NR RALEIGH, NC',
          siteCode: [{ value: '02087359' }],
          geoLocation: { geogLocation: { latitude: 35.758, longitude: -78.583 } },
        },
        variable: { variableCode: [{ value: '00065' }], noDataValue: -999999 },
        values: [{ value: [
          { value: '3.53', dateTime: '2026-10-03T16:25:00.000-04:00' },
          { value: '3.55', dateTime: '2026-10-03T17:25:00.000-04:00' },
        ] }],
      },
    ],
  },
};
const crbn7 = {
  lid: 'CRBN7', usgsId: '02087324', name: 'Crabtree Creek at Capitol Blvd (US Rt 1)',
  flood: { stageUnits: 'ft', categories: {
    major: { stage: 21 }, moderate: { stage: 19 }, minor: { stage: 18 }, action: { stage: 16 },
  } },
};
const obs = { features: [
  { properties: { timestamp: '2026-10-03T21:00:00+00:00', temperature: { value: 18.3, unitCode: 'wmoUnit:degC' },
    precipitationLastHour: { value: 1.2, unitCode: 'wmoUnit:mm' } } },
  { properties: { timestamp: '2026-10-03T22:00:00+00:00', temperature: { value: 18, unitCode: 'wmoUnit:degC' } } },
] };
const grid = { properties: { quantitativePrecipitation: { uom: 'wmoUnit:mm', values: [
  { validTime: '2026-10-03T18:00:00+00:00/PT6H', value: 8.89 },
  { validTime: '2026-10-04T00:00:00+00:00/PT6H', value: 1.524 },
  { validTime: '2026-10-04T06:00:00+00:00/PT6H', value: 7.62 },
  { validTime: '2026-10-05T06:00:00+00:00/PT6H', value: 20 },
] } } };

const now = new Date('2026-10-03T22:10:00Z');

function loaded() {
  const { gauges, readings } = parseUsgs(usgs);
  const flood = parseFloodStages(crbn7)!;
  const withStages: Gauge[] = gauges.map((g) => (g.site === '02087324' ? { ...g, nwsLid: 'CRBN7', flood } : g));
  return {
    gauges: withStages,
    readings: [...readings, ...parseObservations(obs, 'nws:KRDU'), ...parseRainForecast(grid, 'nws:RAH/75,57')],
  };
}

describe('live feed parsers', () => {
  it('reads USGS stage and flow, skipping no-data values', () => {
    const { gauges, readings } = parseUsgs(usgs);
    expect(gauges.map((g) => g.site)).toEqual(['02087324', '02087359']);
    expect(gauges[0]!.name).toBe('Crabtree Creek at US 1 at Raleigh, NC');
    expect(readings.filter((r) => r.site === '02087324' && r.parameter === 'stage_ft').map((r) => r.value)).toEqual([0.31, 0.51]);
    expect(readings.find((r) => r.parameter === 'flow_cfs')?.value).toBe(79.7);
    expect(readings[0]!.time.toISOString()).toBe('2026-10-03T20:10:00.000Z');
  });

  it('reads NOAA flood stages and NWS weather', () => {
    expect(parseFloodStages(crbn7)).toEqual({ action: 16, minor: 18, moderate: 19, major: 21 });
    expect(parseFloodStages({ ...crbn7, flood: { categories: { minor: { stage: -9999 } } } })).toBeNull();
    const weather = parseObservations(obs, 'nws:KRDU');
    expect(weather.map((r) => r.parameter)).toEqual(['temp_c', 'rain_mm', 'temp_c']);
    const rain = parseRainForecast(grid, 'nws:RAH/75,57');
    expect(rain[0]).toMatchObject({ parameter: 'rain_forecast_mm', value: 8.89, unit: 'mm/PT6H' });
  });

  it('title-cases USGS station names', () => {
    expect(titleCase('WALNUT CREEK AT SUNNYBROOK DRIVE NR RALEIGH, NC')).toBe('Walnut Creek at Sunnybrook Drive near Raleigh, NC');
    expect(titleCase('CRABTREE CR AT EBENEZER CHURCH RD NR RALEIGH, NC')).toBe('Crabtree Creek at Ebenezer Church Rd near Raleigh, NC');
  });
});

describe('live summary', () => {
  it('gives trend, flood stage distance, weather and a headline', () => {
    const { gauges, readings } = loaded();
    const s = summarize(gauges, readings, now);
    expect(s.stale).toBe(false);
    expect(s.updatedAt).toBe('2026-10-03T21:25:00.000Z');
    const crabtree = s.gauges[0]!;
    expect(crabtree).toMatchObject({ site: '02087324', stageFt: 0.51, flowCfs: 79.7, trend: 'rising', change1hFt: 0.2,
      category: 'none', belowFloodFt: 17.49 });
    expect(s.gauges[1]).toMatchObject({ site: '02087359', trend: 'steady', category: null, belowFloodFt: null });
    expect(s.headline).toBe('Crabtree Creek at US 1 at Raleigh, NC: 0.5 ft and rising, 17 ft below flood stage.');
    // 6 h periods starting 18:00 (in the last hour? no), 00:00 and 06:00 count; 2026-10-05 is past 24 h.
    expect(s.weather).toEqual({ station: 'KRDU', time: '2026-10-03T22:00:00.000Z', tempC: 18, rainLastHourMm: 1.2,
      rainNext24hMm: 9.1 });
  });

  it('flags floods and stale data', () => {
    const flood = { action: 16, minor: 18, moderate: 19, major: 21 };
    expect(categoryOf(15.9, flood)).toBe('none');
    expect(categoryOf(16, flood)).toBe('action');
    expect(categoryOf(19.5, flood)).toBe('moderate');
    const { gauges, readings } = loaded();
    const later = summarize(gauges, readings, new Date('2026-10-04T03:00:00Z'));
    expect(later.stale).toBe(true);
    expect(later.headline).toBeNull();
  });
});

describe('GET /api/live/gauges', () => {
  const live = new MemoryLiveStore();
  const app = buildServer({ live });
  afterAll(() => app.close());

  it('serves the summary and hourly history from the live store', async () => {
    const { gauges, readings } = loaded();
    await live.saveGauges(gauges);
    await live.saveGauges(gauges.map((g) => ({ ...g, nwsLid: null, flood: null }))); // a USGS-only refresh
    // Shift the sample to now so the 3-hour window includes it.
    const shift = Date.now() - now.getTime();
    await live.saveReadings(readings.map((r) => ({ ...r, time: new Date(r.time.getTime() + shift) })));
    const res = await app.inject({ method: 'GET', url: '/api/live/gauges' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.store).toBe('memory');
    expect(body.gauges[0].flood).toEqual({ action: 16, minor: 18, moderate: 19, major: 21 });
    expect(body.headline).toMatch(/^Crabtree Creek/);
    const hist = (await app.inject({ method: 'GET', url: '/api/live/gauges/02087324?hours=6' })).json();
    expect(hist.rows.some((r: { parameter: string }) => r.parameter === 'stage_ft')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/live/gauges/bad%20site!' })).statusCode).toBe(400);
  });
});

describe('weather right now (title screen)', () => {
  const at = (iso: string) => new Date(iso);
  const miamiObs = { features: [
    { properties: { timestamp: '2026-10-03T22:00:00+00:00', textDescription: 'Light Rain',
      temperature: { value: 28, unitCode: 'wmoUnit:degC' }, windSpeed: { value: 16.09, unitCode: 'wmoUnit:km_h-1' },
      relativeHumidity: { value: 81.4, unitCode: 'wmoUnit:percent' } } },
    { properties: { timestamp: '2026-10-03T21:00:00+00:00', textDescription: 'Cloudy',
      temperature: { value: 29, unitCode: 'wmoUnit:degC' } } },
  ] };
  const station: WeatherStation = { city: 'miami', station: 'KMIA', name: 'Miami International Airport', lon: -80.29, lat: 25.79,
    gridSite: 'nws:MFL/110,50', conditions: 'Light Rain', observedAt: at('2026-10-03T22:00:00Z') };

  it('reads conditions, wind and humidity from NWS', () => {
    expect(parseConditions(miamiObs)).toEqual({ text: 'Light Rain', time: at('2026-10-03T22:00:00Z') });
    expect(parseConditions({ features: [] })).toBeNull();
    const params = parseObservations(miamiObs, 'nws:KMIA').map((r) => r.parameter);
    expect(params).toEqual(['temp_c', 'wind_kph', 'humidity_pct', 'temp_c']);
  });

  it('builds a city report in US units with the 24-hour forecast', () => {
    const readings = [
      ...parseObservations(miamiObs, 'nws:KMIA'),
      { time: at('2026-10-03T23:00:00Z'), site: 'nws:MFL/110,50', parameter: 'rain_forecast_mm' as const, value: 4, unit: 'mm/PT6H' },
      { time: at('2026-10-04T05:00:00Z'), site: 'nws:MFL/110,50', parameter: 'rain_forecast_mm' as const, value: 2.5, unit: 'mm/PT6H' },
      { time: at('2026-10-06T05:00:00Z'), site: 'nws:MFL/110,50', parameter: 'rain_forecast_mm' as const, value: 9, unit: 'mm/PT6H' },
    ];
    const w = cityWeather(station, readings, [], at('2026-10-03T22:30:00Z'));
    expect(w).toMatchObject({ city: 'miami', station: 'KMIA', conditions: 'Light Rain', tempC: 28, tempF: 82, windMph: 10,
      humidityPct: 81, rainNext24hMm: 6.5, stale: false, observedAt: '2026-10-03T22:00:00.000Z' });
    expect(cityWeather(station, readings, [], at('2026-10-04T03:00:00Z')).stale).toBe(true);
  });

  it('serves each city its own weather, and keeps the gauge summary weather on Raleigh', async () => {
    const live = new MemoryLiveStore();
    const app = buildServer({ live });
    const now = Date.now();
    const shift = (rs: ReturnType<typeof parseObservations>) => rs.map((r) => ({ ...r, time: new Date(now - 30 * 60_000) }));
    await live.saveReadings([...shift(parseObservations(miamiObs, 'nws:KMIA')), ...shift(parseObservations(obs, 'nws:KRDU'))]);
    await live.saveStation({ ...station, observedAt: new Date(now - 30 * 60_000) });
    await live.saveStation({ ...station, city: 'raleigh', station: 'KRDU', name: 'Raleigh-Durham', gridSite: 'nws:RAH/75,57', conditions: 'Clear' });
    const miami = (await app.inject({ method: 'GET', url: '/api/live/weather?city=miami' })).json();
    expect(miami.weather).toMatchObject({ station: 'KMIA', conditions: 'Light Rain', humidityPct: 81 });
    expect((await app.inject({ method: 'GET', url: '/api/live/weather?city=new-york' })).json().weather).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/live/weather?city=atlantis' })).statusCode).toBe(400);
    const gauges = (await app.inject({ method: 'GET', url: '/api/live/gauges' })).json();
    expect(gauges.weather.station).toBe('KRDU');
    await app.close();
  });
});
