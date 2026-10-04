// GET /api/planner: where the crowd acts versus where the data says to act.
//
// A "spot" is somewhere a piece can go: a shelter site, a flood road, or a cell for walk-in pieces
// (bus pickup, cooling center, water station, trees). Every spot gets the weighted at-risk people it
// protects on its own. The data picks the best plan's spots, then the spots the optimizer adds with
// a bigger budget (they do not overlap the way the strongest single spots do); the crowd picks the
// spots enough players chose. Spots are then "both", "data" (the gap) or "crowd".
import {
  type DataBundle, type InterventionType, type Mode, type Placement, type Plan,
  engineIndex, marginalGain, placementEffect, planState, score,
} from '@shared';
import { cellToLatLng } from 'h3-js';
import type { Crowd, PlacementRow } from './db/store';

export type PlannerCategory = 'both' | 'data' | 'crowd';

export interface PlannerSpot {
  target: string;
  type: InterventionType;
  name: string;
  hood: string;
  cell: number | null;
  lon: number;
  lat: number;
  category: PlannerCategory;
  inOptimal: boolean;
  /** 1-based position in the data's list (best plan first); null for crowd-only spots. */
  dataRank: number | null;
  crowdPicks: number;
  /** Share of plays in this mode that picked this spot, 0..1. */
  crowdShare: number;
  protectedWeighted: number;
  protectedPeople: number;
  reason: string;
}

export interface PlannerResult {
  mode: Mode;
  plays: number;
  atRiskWeighted: number;
  optimalProtectedWeighted: number;
  counts: Record<PlannerCategory, number>;
  spots: PlannerSpot[];
}

/** The data's list: the best plan plus up to this many spots from the bigger budget. */
export const DATA_TOP = 10;
/** The bigger budget, as a multiple of the game budget. */
export const EXTENDED_BUDGET_FACTOR = 3;
/** A spot is a crowd pick when at least this share of plays chose it. */
export const CROWD_MIN_SHARE = 0.15;
/** Walk-in picks within this many H3 rings count as the same spot. */
const CELL_MERGE_RINGS = 1;

/** Which spot a placement sits on. Shelter sites carry their cell. */
export function placementRow(p: Placement, data: DataBundle): PlacementRow {
  if (p.siteId !== undefined) {
    const site = engineIndex(data).sites.get(p.siteId);
    return { type: p.type, target: `site:${p.siteId}`, cell: site?.cell ?? null };
  }
  if (p.roadId !== undefined) return { type: p.type, target: `road:${p.roadId}`, cell: null };
  return { type: p.type, target: `cell:${p.cell}`, cell: p.cell ?? null };
}

function placementOf(type: InterventionType, target: string): Placement {
  const [kind, id] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
  if (kind === 'site') return { id: 'spot', type, siteId: id };
  if (kind === 'road') return { id: 'spot', type, roadId: id };
  return { id: 'spot', type, cell: Number(id) };
}

const key = (type: InterventionType, target: string) => `${type}|${target}`;
const cellOf = (target: string) => (target.startsWith('cell:') ? Number(target.slice(5)) : null);

/**
 * optimal: the best plan for the game budget. extended: the optimizer's plan for a bigger budget,
 * whose extra placements are the next places worth acting, in the order the optimizer chose them.
 */
export function rankPlanner(mode: Mode, data: DataBundle, optimal: Plan, extended: Plan, crowd: Crowd): PlannerResult {
  const idx = engineIndex(data);

  // The data's list: the best plan, then the bigger plan's extra placements.
  const dataSpots = new Map<string, { type: InterventionType; target: string; inOptimal: boolean; rank: number }>();
  for (const [list, inOptimal] of [[optimal.placements, true], [extended.placements, false]] as const) {
    for (const p of list) {
      const row = placementRow(p, data);
      const k = key(row.type, row.target);
      if (dataSpots.has(k) || (!inOptimal && dataSpots.size >= optimal.placements.length + DATA_TOP)) continue;
      dataSpots.set(k, { type: row.type, target: row.target, inOptimal, rank: dataSpots.size + 1 });
    }
  }

  // Crowd picks per spot. Walk-in picks join a data spot within one ring, else cluster together.
  const picks = new Map<string, { type: InterventionType; target: string; picks: number }>();
  const add = (type: InterventionType, target: string, n: number) => {
    const have = picks.get(key(type, target));
    if (have) have.picks += n;
    else picks.set(key(type, target), { type, target, picks: n });
  };
  const loose: { type: InterventionType; cell: number; picks: number }[] = [];
  for (const p of crowd.picks) {
    const cell = cellOf(p.target);
    if (cell === null || dataSpots.has(key(p.type, p.target))) {
      add(p.type, p.target, p.picks);
      continue;
    }
    const home = [...dataSpots.values()].find((s) => s.type === p.type && cellOf(s.target) !== null &&
      idx.disk(cellOf(s.target)!, CELL_MERGE_RINGS).includes(cell));
    if (home) add(p.type, home.target, p.picks);
    else loose.push({ type: p.type, cell, picks: p.picks });
  }
  loose.sort((a, b) => b.picks - a.picks || a.cell - b.cell);
  const taken = new Set<number>();
  for (const p of loose) {
    if (taken.has(p.cell)) continue;
    let total = 0;
    for (const q of loose) {
      if (q.type === p.type && !taken.has(q.cell) && idx.disk(p.cell, CELL_MERGE_RINGS).includes(q.cell)) {
        total += q.picks;
        taken.add(q.cell);
      }
    }
    add(p.type, `cell:${p.cell}`, total);
  }

  const minPicks = Math.max(1, Math.ceil(CROWD_MIN_SHARE * crowd.plays));
  const crowdSpots = [...picks.values()].filter((p) => p.picks >= minPicks);

  const all = new Map<string, { type: InterventionType; target: string }>();
  for (const s of [...dataSpots.values(), ...crowdSpots]) all.set(key(s.type, s.target), s);

  const spots: PlannerSpot[] = [];
  for (const { type, target } of all.values()) {
    const k = key(type, target);
    const data_ = dataSpots.get(k);
    const crowdPicks = picks.get(k)?.picks ?? 0;
    const isCrowd = crowdPicks >= minPicks;
    const category: PlannerCategory = data_ && isCrowd ? 'both' : data_ ? 'data' : 'crowd';
    const placement = placementOf(type, target);
    const where = whereOf(placement, data);
    if (!where) continue; // picked on an older data build
    // A bus stop only works next to shelters: value it on top of the best plan's shelters.
    const base = type === 'bus_pickup' ? optimal.placements.filter((p) => p.type === 'shelter') : [];
    const plan = (placements: Placement[]) => ({ roomCode: '', playerId: '', playerName: '', mode, placements, spent: 0 });
    const eff = placementEffect(placement, idx);
    const protectedWeighted = eff ? marginalGain(idx, planState(plan(base), idx), eff) : 0;
    const protectedPeople = protectedWeighted > 0
      ? score(plan([...base, placement]), data).protectedPeople - (base.length ? score(plan(base), data).protectedPeople : 0)
      : 0;
    const crowdShare = crowd.plays > 0 ? crowdPicks / crowd.plays : 0;
    const rank = data_?.rank ?? null;
    spots.push({
      target, type, ...where, category, inOptimal: data_?.inOptimal ?? false,
      dataRank: rank, crowdPicks, crowdShare, protectedWeighted, protectedPeople,
      reason: reasonFor(category, type, data_?.inOptimal ?? false, rank, crowdShare, protectedPeople, crowd.plays),
    });
  }
  const order: Record<PlannerCategory, number> = { both: 0, data: 1, crowd: 2 };
  spots.sort((a, b) => order[a.category] - order[b.category] ||
    (a.dataRank ?? Infinity) - (b.dataRank ?? Infinity) || b.crowdPicks - a.crowdPicks ||
    b.protectedWeighted - a.protectedWeighted || a.target.localeCompare(b.target));

  const best = score(optimal, data);
  return {
    mode,
    plays: crowd.plays,
    atRiskWeighted: best.atRiskWeighted,
    optimalProtectedWeighted: best.protectedWeighted,
    counts: {
      both: spots.filter((s) => s.category === 'both').length,
      data: spots.filter((s) => s.category === 'data').length,
      crowd: spots.filter((s) => s.category === 'crowd').length,
    },
    spots,
  };
}

function whereOf(p: Placement, data: DataBundle) {
  const idx = engineIndex(data);
  if (p.siteId !== undefined) {
    const s = idx.sites.get(p.siteId);
    if (!s) return null;
    return { name: s.name, hood: data.cells[s.cell]?.hood ?? '', cell: s.cell, lon: s.lon, lat: s.lat };
  }
  if (p.roadId !== undefined) {
    const r = idx.roads.get(p.roadId);
    if (!r) return null;
    const [lon, lat] = r.coords[Math.floor(r.coords.length / 2)] ?? [0, 0];
    const hood = r.unlocks[0] !== undefined ? data.cells[r.unlocks[0]]?.hood ?? '' : '';
    return { name: r.name, hood, cell: null, lon, lat };
  }
  const c = p.cell !== undefined && Number.isInteger(p.cell) ? data.cells[p.cell] : undefined;
  if (!c) return null;
  const [lat, lon] = cellToLatLng(c.h3);
  return { name: c.hood, hood: c.hood, cell: c.i, lon, lat };
}

const pct = (x: number) => `${Math.round(100 * x)}%`;
const people = (n: number) => `about ${Math.round(n).toLocaleString('en-US')} people`;

function reasonFor(category: PlannerCategory, type: InterventionType, inOptimal: boolean, rank: number | null,
  share: number, protectedPeople: number, plays: number): string {
  const data = inOptimal ? 'In the best $10M plan' : `The data's #${rank} pick with a bigger budget`;
  const protects = type === 'bus_pickup'
    ? protectedPeople >= 1 ? `takes ${people(protectedPeople)} with no car to the best plan's shelters` : `reaches almost no one the best plan's shelters can seat`
    : protectedPeople >= 1 ? `protects ${people(protectedPeople)}` : 'protects almost no one at risk';
  const alone = type === 'bus_pickup' ? 'It' : 'On its own it';
  if (category === 'both') return `${data} and ${pct(share)} of players picked it. ${alone} ${protects}.`;
  if (category === 'data') {
    const crowd = plays === 0 ? 'no plays yet' : share === 0 ? 'no player picked it' : `only ${pct(share)} of players picked it`;
    return `${data}: it ${protects}, but ${crowd}.`;
  }
  return `${pct(share)} of players picked it. ${alone} ${protects}.`;
}
