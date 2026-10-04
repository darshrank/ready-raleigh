// The storm (P7): everything the flood simulation shows, built once when planning ends.
//
// The engine decides who is protected (simTimeline, planState); this file only turns that into
// things to draw: when each flood step prints, which roads close, and a sample of residents who
// either travel to their shelter (driving, or walking to a bus stop and riding), stay safe behind a
// protected road, or are stranded.
import { FINAL_FLOOD_STEP, FLOOD_STEP_NAMES } from '@shared/config';
import {
  PART_CAR,
  PART_NO_CAR,
  engineIndex,
  placementEffect,
  planState,
  shelterIdOf,
  simTimeline,
  type TimelineStep,
} from '@shared/engine';
import type { FloodRoad, Placement } from '@shared/types';
import type { MapData } from '../data';
import { soloPlan, floodAtRisk } from '../plan/usePlanScore';
import { cellCenter, roadLabel } from '../plan/targets';

type LngLat = [number, number];

// Pacing, in ms after the storm starts (DESIGN.md "Motion"). A wipe into the night, the camera
// tilts over the city, then each flood step: the water grows in, the news helicopter flies to the
// step's event, holds on it, and pulls back.
/** The wipe across the screen; the night palette swaps in at its middle. */
export const WIPE_MS = 700;
/** The camera tilts to 55 degrees over the city. */
export const TILT_MS = 1600;
export const LEAD_MS = 2000;
/** The water of a step grows in over this long (map/flood.ts paces each part inside it). */
export const GROW_MS = 1500;
/** After a step begins, the helicopter leaves for its event... */
export const EVENT_AFTER_MS = 1700;
export const FLY_MS = 1500;
/** ...holds on it with the LIVE caption... */
export const HOLD_MS = 2000;
/** ...and pulls back to the city. */
export const BACK_MS = 1500;
export const STEP_MS = EVENT_AFTER_MS + FLY_MS + HOLD_MS + BACK_MS + 300;
/** Counters tick to the step's numbers over this long, once the water has printed. */
export const TICK_MS = 1600;
/** When step `k` (1-based) begins. */
export const stepStart = (k: number) => LEAD_MS + (k - 1) * STEP_MS;
/** The storm is over: it clears to daylight and the camera pulls back. */
export const STORM_MS = stepStart(FINAL_FLOOD_STEP) + STEP_MS;
/** Night to day. */
export const CLEAR_MS = 1600;
/** The results card slides up this long after the storm clears. */
export const RESULTS_AFTER_MS = 1400;

/** The helicopter's stop for one step: a named road going under, or a neighborhood cut off. */
export interface StormEvent {
  step: number;
  /** For the LIVE caption, uppercase like the band. */
  title: string;
  /** What the camera frames. */
  points: LngLat[];
  /** Times, ms after the storm starts. */
  fly: number;
  hold: number;
  back: number;
}

/** One resident dot per this many weighted people, and never more than MAX_RESIDENTS dots. */
const PEOPLE_PER_DOT = 25;
const MAX_RESIDENTS = 6000;
/** Residents start anywhere within this distance of their cell's center (res 9 inradius ~150 m). */
const HOME_SPREAD_M = 130;
/** Arrivals gather around the shelter instead of on one pixel (the halo shows the crowd). */
const CROWD_SPREAD_M = 90;

/** What happens to a resident when the water reaches their block. */
export const FATE_STRANDED = 0;
export const FATE_TRAVELS = 1; // to their shelter: driving, or walking to a bus stop and riding
export const FATE_STAYS = 2; // their block is kept connected by a protected road

export interface Residents {
  n: number;
  /** [lon, lat] pairs. */
  home: Float32Array;
  /** The bus stop a rider walks to; equal to home for drivers and everyone else. */
  via: Float32Array;
  dest: Float32Array;
  /** Index into Storm.places (a shelter) for travellers, -1 for everyone else. */
  to: Int16Array;
  fate: Uint8Array;
  /** When the resident leaves (or is stranded), boards the bus (= leave without one), and arrives. ms after the start. */
  leave: Float32Array;
  board: Float32Array;
  arrive: Float32Array;
}

export interface Storm {
  timeline: TimelineStep[];
  residents: Residents;
  /** Shelters that receive travellers, and how many dots each receives. */
  places: { at: LngLat; total: number }[];
  /** Indices of the residents who travel, for the trails layer. */
  travellers: Int32Array;
  /** Flood roads by the step they close at, without the protected ones. */
  closing: Record<number, FloodRoad[]>;
  /** Protected flood roads: they stay open. */
  held: FloodRoad[];
  /** Broadcast band lines per step (uppercase, like a real alert); index 0 runs before step 1. */
  band: string[][];
  /** What screen readers hear per step. */
  spoken: string[];
  /** Where the helicopter goes, one stop per step at most. */
  events: StormEvent[];
  /** Time of the last visible change: nothing moves after it. */
  settledMs: number;
}

// Small seeded generator, so a plan always plays the same storm.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG_LAT = 111_320;

/** A point within `r` meters of `at`, uniform over the disc. */
function scatter(at: LngLat, r: number, rand: () => number): LngLat {
  const d = r * Math.sqrt(rand());
  const a = 2 * Math.PI * rand();
  const k = Math.cos((at[1] * Math.PI) / 180);
  return [at[0] + (d * Math.cos(a)) / (M_PER_DEG_LAT * k), at[1] + (d * Math.sin(a)) / M_PER_DEG_LAT];
}

function meters(a: LngLat, b: LngLat): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * M_PER_DEG_LAT;
}


/** Each usable shelter's index in `places`, by site id: where travellers end up. */
function shelterPlaces(data: MapData, placements: Placement[], places: LngLat[]) {
  const idx = engineIndex(data);
  const out = new Map<string, number>();
  for (const p of placements) {
    const site = p.type === 'shelter' && p.siteId !== undefined ? idx.sites.get(p.siteId) : undefined;
    if (site && placementEffect(p, idx)) out.set(site.id, places.push([site.lon, site.lat]) - 1);
  }
  return out;
}

/** The bus stops within walking distance of each cell. */
function pickupsByCell(data: MapData, placements: Placement[]) {
  const idx = engineIndex(data);
  const out = new Map<number, LngLat[]>();
  for (const p of placements) {
    const eff = p.type === 'bus_pickup' ? placementEffect(p, idx) : null;
    if (!eff || eff.kind !== 'pickup' || p.cell === undefined) continue;
    const at = cellCenter(data, p.cell);
    for (const i of eff.cells) {
      const list = out.get(i);
      if (list) list.push(at);
      else out.set(i, [at]);
    }
  }
  return out;
}

/** The step a cell's residents meet the water: its flood step, or the final step if it is only cut off. */
function cellStep(floodStep: number): number {
  return floodStep >= 1 && floodStep <= FINAL_FLOOD_STEP ? floodStep : FINAL_FLOOD_STEP;
}

function sampleResidents(data: MapData, placements: Placement[], places: LngLat[]): Residents {
  const idx = engineIndex(data);
  const { n } = idx;
  const m = idx.mode.flood;
  const state = planState({ mode: 'flood', placements }, idx);
  const shelters = shelterPlaces(data, placements, places);
  const pickups = pickupsByCell(data, placements);
  const atRisk = floodAtRisk(data);

  let total = 0;
  for (const i of atRisk) total += m.partW[PART_CAR * n + i]! + m.partW[PART_NO_CAR * n + i]!;
  const perDot = Math.max(PEOPLE_PER_DOT, total / MAX_RESIDENTS);

  const home: number[] = [];
  const via: number[] = [];
  const dest: number[] = [];
  const to: number[] = [];
  const fate: number[] = [];
  const leave: number[] = [];
  const board: number[] = [];
  const arrive: number[] = [];
  const rand = mulberry32(2026);
  // Systematic sampling: each part carries its remainder to the next cell, so the dot count is
  // exact (floor of total / perDot) and small blocks still get their share across the city.
  const carry = [0, 0];

  for (const i of atRisk) {
    const center = cellCenter(data, i);
    const step = cellStep(idx.floodStep[i]!);
    for (const part of [PART_CAR, PART_NO_CAR] as const) {
      const before = carry[part]!;
      carry[part] = before + m.partW[part * n + i]! / perDot;
      const count = Math.floor(carry[part]!) - Math.floor(before);
      const k = part * n + i;
      const covered = state.cover[k]! > 0;
      // The engine's seat: a protected road keeps the block safe at home, else a shelter seat.
      const byRoad = covered && state.directCover[k]! > 0;
      const shelter = covered && !byRoad ? shelters.get(shelterIdOf(state, k) ?? '') : undefined;
      const stops = part === PART_NO_CAR ? pickups.get(i) : undefined;
      for (let r = 0; r < count; r++) {
        const h = scatter(center, HOME_SPREAD_M, rand);
        // Residents leave as the water reaches them, so some are still on the move when the
        // helicopter arrives.
        const t0 = stepStart(step) + 0.6 * GROW_MS + rand() * 1400;
        let f: number = FATE_STRANDED;
        let v = h;
        let d = h;
        let tb = t0;
        let t1 = t0;
        let place = -1;
        if (shelter !== undefined) {
          f = FATE_TRAVELS;
          place = shelter;
          d = scatter(places[place]!, CROWD_SPREAD_M, rand);
          if (stops) {
            // No car: walk to the nearest bus stop, then ride to the shelter.
            v = scatter(stops.reduce((a, b) => (meters(h, a) <= meters(h, b) ? a : b)), CROWD_SPREAD_M / 3, rand);
            tb = t0 + Math.min(1200, 400 + meters(h, v) * 1.2);
          }
          // Straight lines; a 10 km ride takes about 3 s, so everyone lands before the next step.
          t1 = tb + Math.min(stops ? 3000 : 3800, 1000 + meters(v, d) * 0.25);
        } else if (covered) {
          f = FATE_STAYS;
        }
        home.push(h[0], h[1]);
        via.push(v[0], v[1]);
        dest.push(d[0], d[1]);
        to.push(place);
        fate.push(f);
        leave.push(t0);
        board.push(tb);
        arrive.push(t1);
      }
    }
  }
  return {
    n: fate.length,
    home: Float32Array.from(home),
    via: Float32Array.from(via),
    dest: Float32Array.from(dest),
    to: Int16Array.from(to),
    fate: Uint8Array.from(fate),
    leave: Float32Array.from(leave),
    board: Float32Array.from(board),
    arrive: Float32Array.from(arrive),
  };
}

const fmt = (x: number) => Math.round(x).toLocaleString('en-US');
const upper = (s: string) => s.toUpperCase();

/** The `k` names with the most people, from a name -> people map. */
function top(counts: Map<string, number>, k: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([name]) => name);
}

const STEP_HEADLINE: Record<number, string> = {
  1: 'Creeks leave their banks',
  2: `Water reaches the ${FLOOD_STEP_NAMES[2]} line`,
  3: `Water reaches the ${FLOOD_STEP_NAMES[3]} line`,
};

/** Named roads only: "Unnamed road in X" makes a poor alert line, so those count as "more". */
const named = (data: MapData, r: FloodRoad) => (/^unnamed road/i.test(r.name) ? null : roadLabel(data, r));

function bandLines(data: MapData, timeline: TimelineStep[], closing: Record<number, FloodRoad[]>, held: FloodRoad[]) {
  const idx = engineIndex(data);
  const heldUnlocks = new Set(held.flatMap((r) => r.unlocks));
  const band: string[][] = [['Flood warning for Raleigh', 'Heavy rain over the creeks', 'Stay off flooded roads'].map(upper)];
  const spoken: string[] = ['Flood warning for Raleigh.'];

  for (const s of timeline) {
    const lines = [STEP_HEADLINE[s.step] ?? `Flood step ${s.step}`];

    const wet = new Map<string, number>();
    for (const i of s.newlyFlooded) {
      const hood = data.cells[i]!.hood;
      wet.set(hood, (wet.get(hood) ?? 0) + idx.pop[i]!);
    }
    const hoods = top(wet, 3);
    if (hoods.length) lines.push(`Water in ${hoods.join(', ')}`);

    const roads = closing[s.step] ?? [];
    const names = [...new Set(roads.map((r) => named(data, r)).filter((x): x is string => !!x))];
    const shown = names.slice(0, 4);
    for (const name of shown) lines.push(`${name} closed`);
    const more = roads.length - roads.filter((r) => shown.includes(named(data, r) ?? '')).length;
    if (more > 0) lines.push(`${more} more ${more === 1 ? 'road' : 'roads'} closed`);

    for (const r of held.filter((r) => r.floodStep === s.step).slice(0, 2)) lines.push(`${roadLabel(data, r)} stays open`);

    if (s.step === FINAL_FLOOD_STEP) {
      // Dry blocks that lose every route to a hospital, unless a protected road keeps them connected.
      const cut = new Map<string, number>();
      data.cells.forEach((c, i) => {
        if (c.cutOff && c.floodStep === null && !heldUnlocks.has(i)) cut.set(c.hood, (cut.get(c.hood) ?? 0) + c.pop);
      });
      for (const hood of top(cut, 3)) lines.push(`${hood} cut off from hospitals`);
      if (cut.size > 3) lines.push(`${cut.size - 3} more neighborhoods cut off`);
    }

    lines.push(`${fmt(s.strandedPeople)} residents stranded`);
    band.push(lines.map(upper));
    spoken.push(
      `${lines.slice(0, -1).join('. ')}. ${fmt(s.protectedPeople)} residents protected, ${fmt(s.strandedPeople)} stranded so far.`,
    );
  }
  return { band, spoken };
}

/** A road's points, for framing it. */
const roadPoints = (r: FloodRoad): LngLat[] => r.coords.map((c) => [c[0], c[1]]);

/**
 * One helicopter stop per step: the closing road that strands the most blocks (named roads first),
 * and at the final step the neighborhood with the most people cut off from hospitals.
 */
function stormEvents(data: MapData, closing: Record<number, FloodRoad[]>, held: FloodRoad[]): StormEvent[] {
  const heldUnlocks = new Set(held.flatMap((r) => r.unlocks));
  const out: StormEvent[] = [];
  const used = new Set<string>();
  for (let k = 1; k <= FINAL_FLOOD_STEP; k++) {
    const fly = stepStart(k) + EVENT_AFTER_MS;
    const at = { step: k, fly, hold: fly + FLY_MS, back: fly + FLY_MS + HOLD_MS };
    if (k === FINAL_FLOOD_STEP) {
      const cut = new Map<string, { pop: number; pts: LngLat[] }>();
      data.cells.forEach((c, i) => {
        if (!c.cutOff || c.floodStep !== null || heldUnlocks.has(i)) return;
        const e = cut.get(c.hood) ?? { pop: 0, pts: [] };
        e.pop += c.pop;
        e.pts.push(cellCenter(data, i));
        cut.set(c.hood, e);
      });
      const best = [...cut.entries()].sort((p, q) => q[1].pop - p[1].pop)[0];
      if (best) {
        out.push({ ...at, title: upper(`${best[0]} cut off from hospitals`), points: best[1].pts });
        continue;
      }
    }
    const roads = (closing[k] ?? [])
      .filter((r) => !used.has(named(data, r) ?? r.id))
      .sort((p, q) => Number(!named(data, p)) - Number(!named(data, q)) || q.unlocks.length - p.unlocks.length);
    const road = roads[0];
    if (!road) continue;
    used.add(named(data, road) ?? road.id);
    out.push({ ...at, title: upper(`${roadLabel(data, road)} goes under`), points: roadPoints(road) });
  }
  return out;
}

export function buildStorm(data: MapData, placements: Placement[]): Storm {
  const timeline = simTimeline(soloPlan(placements), data);
  const heldIds = new Set(placements.flatMap((p) => (p.type === 'road_protection' && p.roadId ? [p.roadId] : [])));
  const closing: Record<number, FloodRoad[]> = {};
  for (const r of data.floodRoads) {
    if (heldIds.has(r.id) || r.floodStep < 1 || r.floodStep > FINAL_FLOOD_STEP) continue;
    (closing[r.floodStep] ??= []).push(r);
  }
  const held = data.floodRoads.filter((r) => heldIds.has(r.id));
  const placeAt: LngLat[] = [];
  const residents = sampleResidents(data, placements, placeAt);
  const places = placeAt.map((at) => ({ at, total: 0 }));
  const travellers: number[] = [];
  let last = stepStart(FINAL_FLOOD_STEP) + TICK_MS + GROW_MS;
  for (let k = 0; k < residents.n; k++) {
    if (residents.fate[k] === FATE_TRAVELS) {
      travellers.push(k);
      places[residents.to[k]!]!.total++;
    }
    last = Math.max(last, residents.arrive[k]!);
  }
  const { band, spoken } = bandLines(data, timeline, closing, held);
  const events = stormEvents(data, closing, held);
  return {
    timeline,
    residents,
    places,
    travellers: Int32Array.from(travellers),
    closing,
    held,
    band,
    spoken,
    events,
    settledMs: last + 600,
  };
}

/** The flood step showing at `t` ms (0 before the first one). */
export function stepAt(t: number): number {
  let k = 0;
  while (k < FINAL_FLOOD_STEP && t >= stepStart(k + 1)) k++;
  return k;
}
