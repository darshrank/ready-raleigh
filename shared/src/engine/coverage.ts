// What each placement does to the map, and how much of each at-risk cell ends up protected.
//
// Flood is an evacuation chain. Shelters are the destination: a usable shelter takes the car part
// of the at-risk cells that can drive to it (flooded cells use coverDry, cut-off dry cells use
// coverFlood). A bus pickup lets the no-car part of the cells within gridDisk(cell, 2) board a bus
// to a shelter those cells can reach; with no shelter in reach it helps no one. Drivers and bus
// riders share each shelter's seats in one nearest-first allocation. A protected road reconnects
// the dry cut-off cells it unlocks, so everyone there is safe and needs no seat; flooded homes
// still have to evacuate. Heat: cooling centers and water stations cover gridDisk 2 and 1 with the
// credit in HEAT_COVER_CREDIT; trees cool the cell and ring 1, and a cell cooled below the
// threshold is fully protected.
//
// Registered shelters that already exist (DataBundle.existingShelters) are in every flood state from
// the start, with their own capacity: the baseline the player's plan builds on.
import { BUS_SEAT_SHARE, FINAL_FLOOD_STEP, SHELTER_CAPACITY, HEAT_COVER_CREDIT, TREE_COOLING_C, WALK_RING } from '../config';
import type { DataBundle } from '../data';
import type { Mode, Placement, Plan, Site } from '../types';
import { assertValidPlan } from './plan';
import { type EngineIndex, PART_CAR, PART_NO_CAR, type Part, engineIndex } from './context';

export type Effect =
  /** A walk-in place (heat), or a shelter (flood, siteId set; cells are the ones that can reach it). */
  | { kind: 'cover'; part: Part; credit: number; cells: Int32Array; siteId?: string }
  /** Flood bus pickup: the no-car residents of these cells can board a bus to a shelter. */
  | { kind: 'pickup'; cells: Int32Array }
  /** Flood road protection: the dry cut-off cells it keeps connected, both parts. */
  | { kind: 'road'; cells: Int32Array }
  | { kind: 'cool'; cells: Int32Array; deltaC: Float64Array };

/** A shelter is unusable if its building floods by the final step. */
export function siteUsable(site: Site): boolean {
  return site.floodStep === null || site.floodStep > FINAL_FLOOD_STEP;
}

function floodsByEnd(idx: EngineIndex, i: number): boolean {
  const step = idx.floodStep[i]!;
  return step > 0 && step <= FINAL_FLOOD_STEP;
}

interface ShelterRoute { cell: number; time: number }
const shelterCache = new WeakMap<EngineIndex, Map<string, ShelterRoute[]>>();

/** Flooding cells evacuate on dry roads; dry cut-off cells need final-state roads. */
function shelterRoutes(site: Site, idx: EngineIndex): ShelterRoute[] {
  let cache = shelterCache.get(idx);
  if (!cache) { cache = new Map(); shelterCache.set(idx, cache); }
  let routes = cache.get(site.id);
  if (!routes) {
    routes = [];
    for (const suffix of ['Dry', 'Flood'] as const) {
      site[`cover${suffix}`].forEach((cell, k) => {
        if (floodsByEnd(idx, cell) !== (suffix === 'Dry') || !idx.mode.flood.atRisk[cell]) return;
        const time = site[`drive${suffix}`]?.[k];
        if (!Number.isFinite(time)) throw new Error(`Site ${site.id} needs aligned drive${suffix} times; rebuild data`);
        routes!.push({ cell, time: time! });
      });
    }
    routes.sort((a, b) => a.time - b.time || a.cell - b.cell);
    cache.set(site.id, routes);
  }
  return routes;
}

/** Reachable at-risk cells before capacity allocation; use planState/protectorOf for protection. */
export function shelterCells(site: Site, idx: EngineIndex): Int32Array {
  return Int32Array.from(shelterRoutes(site, idx), (r) => r.cell);
}

/** The effect of one placement, or null if it does nothing (flooded shelter, unknown id). */
export function placementEffect(p: Placement, idx: EngineIndex): Effect | null {
  switch (p.type) {
    case 'shelter': {
      const site = p.siteId === undefined ? undefined : idx.sites.get(p.siteId);
      if (!site || !siteUsable(site)) return null;
      return { kind: 'cover', part: PART_CAR, credit: 1, cells: shelterCells(site, idx), siteId: site.id };
    }
    case 'road_protection': {
      const road = p.roadId === undefined ? undefined : idx.roads.get(p.roadId);
      if (!road) return null;
      // Flooded homes have to leave whatever the roads do; the road saves the dry cut-off blocks.
      const cells = road.unlocks.filter((i) => idx.mode.flood.atRisk[i] && !floodsByEnd(idx, i));
      return { kind: 'road', cells: Int32Array.from(cells) };
    }
    case 'bus_pickup': {
      const cell = busCell(p, idx);
      if (cell === undefined) return null;
      return { kind: 'pickup', cells: idx.disk(cell, WALK_RING.bus_pickup ?? 0) };
    }
    case 'cooling_center':
    case 'water_station':
      return walkEffect(p, idx, PART_CAR, HEAT_COVER_CREDIT[p.type] ?? 1);
    case 'tree_planting': {
      if (p.cell === undefined) return null;
      const cells = idx.disk(p.cell, 1);
      const deltaC = Float64Array.from(cells, (j) => (j === p.cell ? TREE_COOLING_C.cell : TREE_COOLING_C.ring1));
      return { kind: 'cool', cells, deltaC };
    }
  }
}

/** Where a bus pickup is: its existing stop's cell, else its own cell. */
export function busCell(p: Placement, idx: EngineIndex): number | undefined {
  return p.stopId !== undefined ? idx.stops.get(p.stopId)?.cell : p.cell;
}

function walkEffect(p: Placement, idx: EngineIndex, part: Part, credit: number): Effect | null {
  if (p.cell === undefined) return null;
  const cells = idx.disk(p.cell, WALK_RING[p.type] ?? 0);
  return { kind: 'cover', part, credit, cells };
}

/** A placed shelter's route; si is the shelter's slot in CoverState.shelterSites. */
type Route = ShelterRoute & { id: string; si: number };

/** Running coverage for one plan: best credit per (part, cell) and total tree cooling per cell. */
export interface CoverState {
  mode: Mode;
  idx: EngineIndex;
  /** Cover that takes no shelter seat: protected roads (flood), walk-in places (heat). [part * n + i] */
  directCover: Float64Array;
  shelterSites: string[];
  /** Every (cell, shelter) route of the placed shelters, nearest first. */
  routes: Route[];
  /** 1 where at least one placed shelter can be reached. */
  reach: Uint8Array;
  /** 1 where a bus pickup is within walking distance, so no-car residents can board. */
  busReach: Uint8Array;
  /** The nearest shelter slot (index into shelterSites) each (part, cell) is seated at, -1 for none. [part * n + i] */
  shelterOf: Int32Array;
  /** Every seating: (part, cell) k got `share` of its weight at shelter slot si. A cell can split. */
  seats: { k: number; si: number; share: number }[];
  /** Seats kept for bus riders per shelter slot (BUS_SEAT_SHARE of capacity). */
  busSeats: Float64Array;
  /** Protected weight of the bus pass as it stands (so a pickup's gain needs one pass, not two). */
  busSeated: number;
  cover: Float64Array; // [part * n + i], 0..1
  coolingC: Float64Array;
}

/** A plan's starting point: nothing placed, with the existing shelters in flood mode. */
export function emptyState(mode: Mode, idx: EngineIndex): CoverState {
  const state: CoverState = { mode, idx, directCover: new Float64Array(2 * idx.n), shelterSites: [], routes: [],
    reach: new Uint8Array(idx.n), busReach: new Uint8Array(idx.n), shelterOf: new Int32Array(2 * idx.n).fill(-1), seats: [],
    busSeats: new Float64Array(), busSeated: 0,
    cover: new Float64Array(2 * idx.n), coolingC: new Float64Array(idx.n) };
  if (mode === 'flood') {
    for (const site of idx.existing) {
      if (siteUsable(site)) applyEffect(state, { kind: 'cover', part: PART_CAR, credit: 1, cells: new Int32Array(), siteId: site.id }, idx.n);
    }
  }
  return state;
}

const byRoute = (a: Route, b: Route) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.cell - b.cell;

/** Two route lists already in byRoute order, merged (cheaper than sorting again). */
function mergeRoutes(a: Route[], b: Route[]): Route[] {
  const out: Route[] = new Array(a.length + b.length);
  let i = 0, j = 0, k = 0;
  while (i < a.length && j < b.length) out[k++] = byRoute(a[i]!, b[j]!) <= 0 ? a[i++]! : b[j++]!;
  while (i < a.length) out[k++] = a[i++]!;
  while (j < b.length) out[k++] = b[j++]!;
  return out;
}

export function applyEffect(state: CoverState, eff: Effect, n: number): void {
  if (eff.kind === 'cover' && eff.siteId !== undefined) {
    const id = eff.siteId;
    if (!state.shelterSites.includes(id)) {
      const si = state.shelterSites.length;
      const added = shelterRoutes(state.idx.shelterSites.get(id)!, state.idx).map((r) => ({ ...r, id, si }));
      state.shelterSites.push(id);
      state.routes = mergeRoutes(state.routes, added);
      for (const r of added) state.reach[r.cell] = 1;
    }
    allocateShelters(state);
  } else if (eff.kind === 'cover') {
    const base = eff.part * n;
    for (const i of eff.cells) {
      if (state.directCover[base + i]! < eff.credit) state.directCover[base + i] = eff.credit;
      if (state.cover[base + i]! < eff.credit) state.cover[base + i] = eff.credit;
    }
  } else if (eff.kind === 'road') {
    for (const i of eff.cells) {
      state.directCover[PART_CAR * n + i] = 1;
      state.directCover[PART_NO_CAR * n + i] = 1;
    }
    allocateShelters(state);
  } else if (eff.kind === 'pickup') {
    for (const i of eff.cells) state.busReach[i] = 1;
    allocateShelters(state);
  } else {
    for (let k = 0; k < eff.cells.length; k++) state.coolingC[eff.cells[k]!]! += eff.deltaC[k]!;
  }
}

/**
 * Shelter seat allocation. Each shelter keeps BUS_SEAT_SHARE of its seats for bus riders: drivers
 * fill the rest nearest first (any shelter their cell reaches), then the buses fill the reserve with
 * no-car residents of the cells near a pickup, most vulnerable first. Neither pass takes the other's seats,
 * so adding a piece never lowers the score. A cell that fills a shelter goes on to its next one.
 */
function allocateShelters(state: CoverState): void {
  state.cover.set(state.directCover);
  state.shelterOf.fill(-1);
  state.seats = [];
  const seats = Float64Array.from(state.shelterSites,
    (id) => state.idx.shelterSites.get(id)?.capacity ?? SHELTER_CAPACITY ?? Infinity);
  fillSeats(state, PART_CAR, state.busReach, seats.map((n) => n * (1 - BUS_SEAT_SHARE)), true);
  state.busSeats = seats.map((n) => n * BUS_SEAT_SHARE);
  state.busSeated = fillSeats(state, PART_NO_CAR, state.busReach, state.busSeats.slice(), true);
}

/**
 * One seating pass for one part over the placed shelters' routes, nearest first, using up
 * `remaining` (seats per shelter slot). A cell that fills a shelter sends the rest of its people on
 * to its next nearest shelter with seats. Returns the protected weight it seats. With `write`,
 * records the seats in state.cover, state.shelterOf (nearest) and state.seats.
 */
function fillSeats(state: CoverState, part: Part, busReach: Uint8Array, remaining: Float64Array, write: boolean): number {
  const { idx } = state;
  const { n } = idx;
  const partW = idx.mode.flood.partW;
  // Share of each cell's part still without a seat.
  const left = new Float64Array(n).fill(1);
  let open = 0;
  for (const seats of remaining) if (seats > 1e-9) open++;
  let total = 0;
  // Buses take the most vulnerable riders first (weight per person), nearest first among equals,
  // so a new pickup can only swap a seat to someone who counts more. Drivers go nearest first.
  const order = part === PART_CAR ? state.routes : state.routes
    .filter((r) => busReach[r.cell])
    .map((r, k) => ({ r, k, d: idx.pop[r.cell]! > 0 ? idx.weight[r.cell]! / idx.pop[r.cell]! : 0 }))
    .sort((a, b) => b.d - a.d || a.k - b.k)
    .map((x) => x.r);
  for (const { cell: i, si } of order) {
    if (open === 0) break; // every shelter is full
    const k = part * n + i;
    if (part === PART_NO_CAR && !busReach[i]) continue;
    if (left[i]! <= 1e-12 || state.directCover[k]! > 0) continue;
    const room = remaining[si]!;
    const w = partW[k]!;
    if (room <= 1e-9 || w <= 0) continue;
    // Same people-to-weight conversion as score(), so 10,000 seats means 10,000 people.
    const people = idx.weight[i]! > 0 ? idx.pop[i]! * w / idx.weight[i]! : 0;
    const share = people > 0 ? Math.min(left[i]!, room / people) : left[i]!;
    left[i]! -= share;
    total += w * share;
    remaining[si] = Math.max(0, room - people * share);
    if (remaining[si]! <= 1e-9) open--;
    if (write) {
      state.cover[k]! += share;
      if (state.shelterOf[k] === -1) state.shelterOf[k] = si;
      state.seats.push({ k, si, share });
    }
  }
  return total;
}

/** The id of the shelter (part, cell) k is seated at, if any. */
export function shelterIdOf(state: CoverState, k: number): string | undefined {
  const si = state.shelterOf[k]!;
  return si >= 0 ? state.shelterSites[si] : undefined;
}

function copyState(state: CoverState): CoverState {
  return { ...state, cover: state.cover.slice(), directCover: state.directCover.slice(),
    coolingC: state.coolingC.slice(), shelterSites: [...state.shelterSites], shelterOf: state.shelterOf.slice(), seats: [...state.seats], busSeats: state.busSeats.slice(),
    reach: state.reach.slice(), busReach: state.busReach.slice() };
}

/** Protected weighted people in cell i (0 if not at risk). */
export function protectedWeight(idx: EngineIndex, state: CoverState, i: number): number {
  const m = idx.mode[state.mode];
  if (!m.atRisk[i]) return 0;
  const n = idx.n;
  const carW = m.partW[PART_CAR * n + i]!;
  const noCarW = m.partW[PART_NO_CAR * n + i]!;
  if (state.mode === 'heat' && idx.heatC[i]! - state.coolingC[i]! < idx.heatThreshold) return carW + noCarW;
  return carW * state.cover[PART_CAR * n + i]! + noCarW * state.cover[PART_NO_CAR * n + i]!;
}

/** How much protected weight `eff` would add on top of `state`. */
export function marginalGain(idx: EngineIndex, state: CoverState, eff: Effect): number {
  const m = idx.mode[state.mode];
  const n = idx.n;
  let gain = 0;
  if (state.mode === 'flood' && eff.kind !== 'cool') {
    if (eff.kind === 'pickup') {
      // A pickup only matters where a placed shelter can be reached and riders have no bus yet.
      if (!eff.cells.some((i) => state.reach[i] === 1 && state.busReach[i] === 0 &&
        m.partW[PART_NO_CAR * n + i]! > 0 && state.directCover[PART_NO_CAR * n + i] === 0)) return 0;
      if (!state.busSeats.some((seats) => seats > 1e-9)) return 0;
      // Drivers are seated first, so a pickup only changes the bus pass: rerun just that.
      const merged = state.busReach.slice();
      for (const i of eff.cells) merged[i] = 1;
      return fillSeats(state, PART_NO_CAR, merged, state.busSeats.slice(), false) - state.busSeated;
    }
    // Everything else moves shelter seats around, so compare the whole allocation.
    const next = copyState(state);
    applyEffect(next, eff, n);
    for (let i = 0; i < n; i++) gain += protectedWeight(idx, next, i) - protectedWeight(idx, state, i);
    return gain;
  }
  if (eff.kind === 'cover') {
    const base = eff.part * n;
    for (const i of eff.cells) {
      if (!m.atRisk[i]) continue;
      const have = state.cover[base + i]!;
      if (have >= eff.credit) continue;
      if (state.mode === 'heat' && idx.heatC[i]! - state.coolingC[i]! < idx.heatThreshold) continue;
      gain += m.partW[base + i]! * (eff.credit - have);
    }
  } else if (eff.kind === 'cool') {
    for (let k = 0; k < eff.cells.length; k++) {
      const i = eff.cells[k]!;
      if (!m.atRisk[i]) continue;
      const before = protectedWeight(idx, state, i);
      const heat = idx.heatC[i]! - state.coolingC[i]! - eff.deltaC[k]!;
      if (heat < idx.heatThreshold) gain += m.partW[PART_CAR * n + i]! + m.partW[PART_NO_CAR * n + i]! - before;
    }
  }
  return gain;
}

/**
 * An upper bound on a pickup's gain: the no-car weight it newly lets board where a shelter can be
 * reached. Its real gain is at most this (riders it adds may also push out farther riders).
 */
export function pickupGainBound(idx: EngineIndex, state: CoverState, eff: Effect): number {
  if (eff.kind !== 'pickup' || !state.busSeats.some((seats) => seats > 1e-9)) return 0;
  const { n } = idx;
  const w = idx.mode.flood.partW;
  let bound = 0;
  for (const i of eff.cells) {
    const k = PART_NO_CAR * n + i;
    if (state.reach[i] && !state.busReach[i] && state.directCover[k] === 0) bound += w[k]! * (1 - state.cover[k]!);
  }
  return bound;
}

/** Coverage state after every placement in the plan (no validation; see score()). */
export function planState(plan: Pick<Plan, 'mode' | 'placements'>, idx: EngineIndex): CoverState {
  const state = emptyState(plan.mode, idx);
  for (const p of plan.placements) {
    const eff = placementEffect(p, idx);
    if (eff) applyEffect(state, eff, idx.n);
  }
  return state;
}

/**
 * At-risk cells this placement serves on its own (any credit, any part), for the planning tray's
 * instant coverage. A bus pickup returns the cells whose no-car residents it can pick up, though
 * they only count once a shelter is in reach. A flooded shelter returns []. Cells the existing
 * shelters already protect count only where this placement adds to them.
 */
export function placementCoverage(p: Placement, mode: Mode, data: DataBundle): number[] {
  const idx = engineIndex(data);
  if (mode === 'flood' && p.type === 'bus_pickup') {
    const eff = placementEffect(p, idx);
    const m = idx.mode.flood;
    return eff ? Array.from(eff.cells).filter((i) => m.atRisk[i] && m.partW[PART_NO_CAR * idx.n + i]! > 0) : [];
  }
  const base = emptyState(mode, idx);
  const state = planState({ mode, placements: [p] }, idx);
  const out: number[] = [];
  for (let i = 0; i < idx.n; i++) if (protectedWeight(idx, state, i) > protectedWeight(idx, base, i) + 1e-9) out.push(i);
  return out;
}

export interface ProtectionSource {
  /** The shelter (or protected road) that keeps these people safe. */
  placement: Placement;
  /** The shelter is an existing registered one, not in the plan (placement id "existing:<site>"). */
  existing?: true;
  /** Flood, no-car part: the bus pickup these residents board on the way to the shelter. */
  via?: Placement;
  part: 'car' | 'noCar';
  /** Fraction of this part's at-risk weight; a shelter's last cell can be partial. */
  share: number;
  weighted: number;
}

/** Per-cell attribution from the same allocation as score/timeline; entries can contain both parts. */
export function protectorOf(plan: Plan, data: DataBundle): Map<number, ProtectionSource[]> {
  assertValidPlan(plan, data);
  const idx = engineIndex(data);
  const state = planState(plan, idx);
  const result = new Map<number, ProtectionSource[]>();
  const put = (i: number, source: ProtectionSource) => {
    if (source.weighted > 0) result.set(i, [...(result.get(i) ?? []), source]);
  };
  // Stable ordering makes source choices independent of placement insertion order.
  const placements = [...plan.placements].sort((a, b) => a.id.localeCompare(b.id));
  if (plan.mode === 'heat') {
    const partial = emptyState('heat', idx);
    for (const p of placements) {
      const eff = placementEffect(p, idx);
      if (!eff) continue;
      const before = Float64Array.from(eff.cells, (i) => protectedWeight(idx, partial, i));
      applyEffect(partial, eff, idx.n);
      eff.cells.forEach((i, k) => {
        const weighted = protectedWeight(idx, partial, i) - before[k]!;
        put(i, { placement: p, part: 'car', weighted, share: idx.weight[i]! > 0 ? weighted / idx.weight[i]! : 0 });
      });
    }
    return result;
  }
  const effects = placements.map((p) => ({ p, eff: placementEffect(p, idx) }));
  const findBy = (kind: 'road' | 'pickup', i: number) =>
    effects.find(({ eff }) => eff?.kind === kind && eff.cells.includes(i))?.p;
  const { n } = idx;
  // Protected roads: the whole part, no seat.
  for (let k = 0; k < 2 * n; k++) {
    if (state.directCover[k]! <= 0) continue;
    const i = k % n, weighted = idx.mode.flood.partW[k]! * state.directCover[k]!;
    const road = findBy('road', i);
    if (road) put(i, { placement: road, part: k < n ? 'car' : 'noCar', share: state.directCover[k]!, weighted });
  }
  // Shelter seats, nearest first; a cell that filled one shelter can have a second.
  for (const { k, si, share } of state.seats) {
    const i = k % n, part = k < n ? PART_CAR : PART_NO_CAR;
    const siteId = state.shelterSites[si]!;
    const planned = placements.find((p) => p.siteId === siteId);
    const via = part === PART_NO_CAR ? findBy('pickup', i) : undefined;
    put(i, {
      placement: planned ?? { id: `existing:${siteId}`, type: 'shelter', siteId },
      ...(planned ? {} : { existing: true as const }),
      ...(via ? { via } : {}), part: part === PART_CAR ? 'car' : 'noCar', share,
      weighted: idx.mode.flood.partW[k]! * share,
    });
  }
  return result;
}
