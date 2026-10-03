// What each placement does to the map, and how much of each at-risk cell ends up protected.
//
// Flood: a usable shelter covers the car part of shelterCells(site) (flooded cells use coverDry,
// cut-off dry cells use coverFlood); a protected road covers the car part of its `unlocks` cells;
// a bus pickup covers the no-car part of gridDisk(cell, 2). Heat: cooling centers and water stations cover gridDisk 2 and 1 with the
// credit in HEAT_COVER_CREDIT; trees cool the cell and ring 1, and a cell cooled below the
// threshold is fully protected. Shelters share a capacity-aware nearest-cell allocation.
import { FINAL_FLOOD_STEP, SHELTER_CAPACITY, HEAT_COVER_CREDIT, TREE_COOLING_C, WALK_RING } from '../config';
import type { DataBundle } from '../data';
import type { Mode, Placement, Plan, Site } from '../types';
import { assertValidPlan } from './plan';
import { type EngineIndex, PART_CAR, PART_NO_CAR, type Part, engineIndex } from './context';

export type Effect =
  | { kind: 'cover'; part: Part; credit: number; cells: Int32Array; siteId?: string }
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
      return { kind: 'cover', part: PART_CAR, credit: 1, cells: Int32Array.from(road.unlocks) };
    }
    case 'bus_pickup':
      return walkEffect(p, idx, PART_NO_CAR, 1);
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

function walkEffect(p: Placement, idx: EngineIndex, part: Part, credit: number): Effect | null {
  if (p.cell === undefined) return null;
  const cells = idx.disk(p.cell, WALK_RING[p.type] ?? 0);
  return { kind: 'cover', part, credit, cells };
}

/** Running coverage for one plan: best credit per (part, cell) and total tree cooling per cell. */
export interface CoverState {
  mode: Mode;
  idx: EngineIndex;
  directCover: Float64Array;
  shelterSites: string[];
  shelterOf: (string | undefined)[];
  cover: Float64Array; // [part * n + i], 0..1
  coolingC: Float64Array;
}

export function emptyState(mode: Mode, idx: EngineIndex): CoverState {
  return { mode, idx, directCover: new Float64Array(2 * idx.n), shelterSites: [], shelterOf: [],
    cover: new Float64Array(2 * idx.n), coolingC: new Float64Array(idx.n) };
}

export function applyEffect(state: CoverState, eff: Effect, n: number): void {
  if (eff.kind === 'cover' && eff.siteId !== undefined) {
    if (!state.shelterSites.includes(eff.siteId)) state.shelterSites.push(eff.siteId);
    allocateShelters(state);
  } else if (eff.kind === 'cover') {
    const base = eff.part * n;
    for (const i of eff.cells) {
      if (state.directCover[base + i]! < eff.credit) state.directCover[base + i] = eff.credit;
      if (state.cover[base + i]! < eff.credit) state.cover[base + i] = eff.credit;
    }
    if (state.mode === 'flood' && eff.part === PART_CAR) allocateShelters(state);
  } else {
    for (let k = 0; k < eff.cells.length; k++) state.coolingC[eff.cells[k]!]! += eff.deltaC[k]!;
  }
}

/** Global nearest-pair allocation; each cell has one shelter, with a partial last cell. */
function allocateShelters(state: CoverState): void {
  const { idx } = state;
  state.cover.set(state.directCover);
  state.shelterOf = [];
  const remaining = new Map(state.shelterSites.map((id) => [id, SHELTER_CAPACITY ?? Infinity]));
  const pairs = state.shelterSites.flatMap((id) => shelterRoutes(idx.sites.get(id)!, idx).map((r) => ({ ...r, id })));
  pairs.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id) || a.cell - b.cell);
  for (const { cell: i, id } of pairs) {
    if (state.directCover[i]! > 0 || state.shelterOf[i] !== undefined) continue;
    const room = remaining.get(id)!;
    const carW = idx.mode.flood.partW[i]!;
    if (room <= 1e-9 || carW <= 0) continue;
    // Same people-to-weight conversion as score(), so 10,000 seats means 10,000 people.
    const people = idx.weight[i]! > 0 ? idx.pop[i]! * carW / idx.weight[i]! : 0;
    const share = people > 0 ? Math.min(1, room / people) : 1;
    state.cover[i] = share;
    state.shelterOf[i] = id;
    remaining.set(id, Math.max(0, room - people * share));
  }
}

function copyState(state: CoverState): CoverState {
  return { ...state, cover: state.cover.slice(), directCover: state.directCover.slice(),
    coolingC: state.coolingC.slice(), shelterSites: [...state.shelterSites], shelterOf: [...state.shelterOf] };
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
  if (state.mode === 'flood' && eff.kind === 'cover' && eff.part === PART_CAR) {
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
  } else {
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
 * At-risk cells this placement protects on its own (any credit, any part). For the planning
 * tray's instant coverage. A flooded shelter returns [].
 */
export function placementCoverage(p: Placement, mode: Mode, data: DataBundle): number[] {
  const idx = engineIndex(data);
  const state = planState({ mode, placements: [p] }, idx);
  const out: number[] = [];
  for (let i = 0; i < idx.n; i++) if (protectedWeight(idx, state, i) > 0) out.push(i);
  return out;
}

export interface ProtectionSource {
  placement: Placement;
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
  for (let i = 0; i < idx.n; i++) {
    for (const part of [PART_CAR, PART_NO_CAR] as const) {
      const share = state.cover[part * idx.n + i]!;
      const weighted = idx.mode.flood.partW[part * idx.n + i]! * share;
      if (weighted <= 0) continue;
      const shelter = part === PART_CAR ? state.shelterOf[i] : undefined;
      const placement = shelter !== undefined ? placements.find((p) => p.siteId === shelter) :
        effects.find(({ eff }) => eff?.kind === 'cover' && eff.siteId === undefined && eff.part === part && eff.cells.includes(i))?.p;
      if (placement) put(i, { placement, part: part === PART_CAR ? 'car' : 'noCar', share, weighted });
    }
  }
  return result;
}
