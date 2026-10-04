// GET /api/planner/bus-demand: where players keep asking for an evacuation bus pickup, for transit
// and emergency planners.
//
// Bus pickups from every play are grouped into H3 resolution 8 areas (about 0.7 km2, roughly a
// neighborhood block group) and counted by distinct players, so one person cannot inflate an area.
// Areas picked by fewer than minPlayers players are not shown (small-count privacy, and too little
// signal). Each area carries its households with no car and people at flood risk from the Census
// cells, and the nearest existing bus stop from GTFS: no stop within a five-minute walk is a gap.
import { cellToBoundary, cellToChildren, cellToLatLng, cellToParent } from 'h3-js';
import { type BusDemandReport, type DataBundle, type DemandArea, type Mode, floodRiskShare } from '@shared';
import type { TransitStops } from './data';
import type { PickupPicks } from './db/store';

export const AREA_RES = 8;
/** A five-minute walk at about 80 m a minute. */
export const WALK_M = 400;
/** Default and lowest allowed number of distinct players before an area is shown. */
export const MIN_PLAYERS = 5;
export const MIN_PLAYERS_FLOOR = 3;

const M_PER_DEG = 111_320;
function meters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const k = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot((lon1 - lon2) * k, lat1 - lat2) * M_PER_DEG;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (x: number) => `${Math.round(100 * x)}%`;
const distance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

export function busDemand(opts: {
  mode: Mode;
  data: DataBundle;
  transit: TransitStops | null;
  pickups: PickupPicks;
  since: Date;
  minPlayers?: number;
  now?: Date;
}): BusDemandReport {
  const { mode, data, transit, pickups, since } = opts;
  const minPlayers = Math.max(MIN_PLAYERS_FLOOR, Math.floor(opts.minPlayers ?? MIN_PLAYERS));
  const cellOfH3 = new Map(data.cells.map((c, i) => [c.h3, i]));

  // Group picks by area: distinct players, pick counts per cell.
  const byArea = new Map<string, { players: Set<string>; picks: Map<number, number>; stops: Map<string, Set<string>> }>();
  for (const { cell, player, stopId } of pickups.picks) {
    const c = data.cells[cell];
    if (!c) continue; // picked on an older data build
    const area = cellToParent(c.h3, AREA_RES);
    const a = byArea.get(area) ?? { players: new Set(), picks: new Map(), stops: new Map() };
    a.players.add(player);
    a.picks.set(cell, (a.picks.get(cell) ?? 0) + 1);
    if (stopId) a.stops.set(stopId, (a.stops.get(stopId) ?? new Set()).add(player));
    byArea.set(area, a);
  }
  const stopById = new Map((transit?.stops ?? []).map(([, , name, src, id]) => [id, { name, agency: transit!.sources[src]?.agency ?? '' }]));

  const areas: DemandArea[] = [];
  let hiddenAreas = 0;
  for (const [area, a] of byArea) {
    if (a.players.size < minPlayers) {
      hiddenAreas++;
      continue;
    }
    // Who lives here: every resolution 9 cell of the area that is in the study area.
    let noCar = 0, noCarRisk = 0, atRisk = 0;
    const hoods = new Map<string, number>();
    for (const h of cellToChildren(area, 9)) {
      const i = cellOfH3.get(h);
      if (i === undefined) continue;
      const c = data.cells[i]!;
      const risk = mode === 'flood' ? floodRiskShare(c) : 0;
      noCar += c.noCarHH;
      noCarRisk += c.noCarHH * risk;
      atRisk += c.pop * risk;
      hoods.set(c.hood, (hoods.get(c.hood) ?? 0) + c.pop);
    }
    // Where players put the pickups, weighted by how often.
    let lon = 0, lat = 0, total = 0;
    for (const [cell, n] of a.picks) {
      const [y, x] = cellToLatLng(data.cells[cell]!.h3);
      lon += x * n; lat += y * n; total += n;
    }
    lon /= total; lat /= total;
    let nearest: DemandArea['nearestStop'] = null;
    let stopsInWalk = 0;
    for (const [x, y, name, src] of transit?.stops ?? []) {
      const m = meters(lon, lat, x, y);
      if (m <= WALK_M) stopsInWalk++;
      if (!nearest || m < nearest.meters) nearest = { name, agency: transit!.sources[src]?.agency ?? '', meters: Math.round(m) };
    }
    const hood = [...hoods.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? data.cells[[...a.picks.keys()][0]!]!.hood;
    const stopPlayers = new Set([...a.stops.values()].flatMap((s) => [...s]));
    const [topId, topSet] = [...a.stops.entries()].sort((p, q) => q[1].size - p[1].size || p[0].localeCompare(q[0]))[0] ?? [];
    const top = topId ? stopById.get(topId) : undefined;
    areas.push({
      rank: 0, area, hood, lon: round5(lon), lat: round5(lat),
      players: a.players.size, playerShare: pickups.players > 0 ? a.players.size / pickups.players : 0, picks: total,
      noCarHouseholds: noCar, noCarHouseholdsAtRisk: noCarRisk, peopleAtRisk: atRisk,
      nearestStop: nearest, stopsInWalk, gap: transit !== null && (nearest === null || nearest.meters > WALK_M),
      stopRequests: stopPlayers.size,
      requestedStop: topId && top ? { id: topId, name: top.name, agency: top.agency, players: topSet!.size } : null,
      reason: '',
    });
  }
  // Gaps first, then the most players, then the most households with no car at risk.
  areas.sort((p, q) => Number(q.gap) - Number(p.gap) || q.players - p.players ||
    q.noCarHouseholdsAtRisk - p.noCarHouseholdsAtRisk || p.area.localeCompare(q.area));
  areas.forEach((a, k) => {
    a.rank = k + 1;
    a.reason = reasonFor(a, transit);
  });

  const gaps = areas.filter((a) => a.gap).length;
  return {
    mode,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    since: since.toISOString(),
    plays: pickups.plays,
    players: pickups.players,
    minPlayers,
    hiddenAreas,
    gaps,
    areas,
    summary: summaryOf(areas, gaps, pickups, minPlayers, transit),
    transitSources: transit?.sources ?? [],
    method: `Bus pickups from every play, grouped into H3 resolution ${AREA_RES} areas and counted by distinct players. ` +
      `Areas with fewer than ${minPlayers} players are hidden. Households with no car and people at flood risk come ` +
      `from the game's Census cells (ACS 5-year) and FEMA flood zones. A gap is an area with no existing bus stop ` +
      `within ${WALK_M} m (a five-minute walk) of where players put the pickups, using the agencies' GTFS stops.`,
  };
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

function reasonFor(a: DemandArea, transit: TransitStops | null): string {
  const who = `${fmt(a.players)} players (${pct(a.playerShare)}) asked for a bus pickup in ${a.hood}.`;
  const need = `${fmt(a.noCarHouseholds)} ${Math.round(a.noCarHouseholds) === 1 ? 'household here has' : 'households here have'} no car` +
    (a.noCarHouseholdsAtRisk >= 1 ? `, ${fmt(a.noCarHouseholdsAtRisk)} of them in flood risk.` : '.');
  if (!transit) return `${who} ${need}`;
  if (!a.nearestStop) return `${who} ${need} No existing bus stop found.`;
  const stop = `${a.nearestStop.agency} stop ${a.nearestStop.name}`;
  if (a.requestedStop) {
    return `${who} ${need} ${fmt(a.requestedStop.players)} of them chose the existing ${a.requestedStop.agency} stop ` +
      `${a.requestedStop.name}: a candidate to designate as an evacuation pickup.`;
  }
  return a.gap
    ? `${who} ${need} The nearest bus stop is ${distance(a.nearestStop.meters)} away (${stop}): a candidate for a new evacuation pickup.`
    : `${who} ${need} ${stop} is ${distance(a.nearestStop.meters)} away: a candidate to designate as an evacuation pickup.`;
}

function summaryOf(areas: DemandArea[], gaps: number, pickups: PickupPicks, minPlayers: number, transit: TransitStops | null): string {
  if (pickups.plays === 0) return 'No plays yet. Bus pickup demand appears here once people play.';
  const base = `From ${fmt(pickups.plays)} plays by ${fmt(pickups.players)} players, ${areas.length} ` +
    `${areas.length === 1 ? 'area has' : 'areas have'} bus pickup requests from at least ${minPlayers} different players.`;
  if (areas.length === 0) return `${base} Areas appear once enough different players ask for the same place.`;
  const top = areas[0]!;
  const lead = gaps > 0
    ? ` ${gaps} of them ${gaps === 1 ? 'has' : 'have'} no bus stop within a five-minute walk; the strongest is ${top.hood} ` +
      `(${fmt(top.players)} players, ${fmt(top.noCarHouseholds)} households with no car).`
    : ` Each already has a bus stop within a five-minute walk; those stops are candidates to designate as evacuation pickups.`;
  const stale = transit?.sources.filter((s) => s.expired).map((s) => `${s.agency} stops come from a feed that ended ${s.feedEnd}`) ?? [];
  return base + lead + (stale.length ? ` Note: ${stale.join('; ')}, so newer stops may be missing.` : '');
}

/** CSV for spreadsheets and GIS joins. */
export function demandCsv(r: BusDemandReport): string {
  const cols = ['rank', 'area_h3', 'neighborhood', 'lon', 'lat', 'players', 'player_share', 'picks', 'no_car_households',
    'no_car_households_at_risk', 'people_at_risk', 'nearest_stop', 'nearest_stop_agency', 'nearest_stop_m',
    'stops_in_walk', 'gap', 'stop_requests', 'requested_stop', 'requested_stop_players', 'reason'];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const rows = r.areas.map((a) => [a.rank, a.area, a.hood, a.lon, a.lat, a.players, a.playerShare, a.picks, a.noCarHouseholds,
    a.noCarHouseholdsAtRisk, a.peopleAtRisk, a.nearestStop?.name, a.nearestStop?.agency, a.nearestStop?.meters,
    a.stopsInWalk, a.gap, a.stopRequests, a.requestedStop?.name, a.requestedStop?.players, a.reason].map(cell).join(','));
  return [cols.join(','), ...rows].join('\n') + '\n';
}

/** GeoJSON: one hexagon per area, for ArcGIS and QGIS. */
export function demandGeoJson(r: BusDemandReport) {
  return {
    type: 'FeatureCollection' as const,
    metadata: { generatedAt: r.generatedAt, since: r.since, plays: r.plays, players: r.players, minPlayers: r.minPlayers,
      summary: r.summary, method: r.method, transitSources: r.transitSources },
    features: r.areas.map((a) => {
      const ring = cellToBoundary(a.area, true).map(([x, y]) => [round5(x), round5(y)]);
      const { area, ...props } = a;
      return {
        type: 'Feature' as const,
        id: area,
        properties: { area_h3: area, ...props, nearestStop: undefined, requestedStop: undefined,
          requested_stop: a.requestedStop?.name ?? null, requested_stop_players: a.requestedStop?.players ?? null,
          nearest_stop: a.nearestStop?.name ?? null,
          nearest_stop_agency: a.nearestStop?.agency ?? null, nearest_stop_m: a.nearestStop?.meters ?? null },
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
      };
    }),
  };
}
