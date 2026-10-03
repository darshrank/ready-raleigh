// What each placement does to the map, and how much of each at-risk cell ends up protected.
//
// Flood: a usable shelter covers the car part of shelterCells(site) (flooded cells use coverDry,
// cut-off dry cells use coverFlood); a protected road covers the car part of its `unlocks` cells;
// a bus pickup covers the no-car part of gridDisk(cell, 2). Heat: cooling centers and water stations cover gridDisk 2 and 1 with the
// credit in HEAT_COVER_CREDIT; trees cool the cell and ring 1, and a cell cooled below the
// threshold is fully protected. Coverage takes the best credit, so placements never hurt.
import { FINAL_FLOOD_STEP, HEAT_COVER_CREDIT, TREE_COOLING_C, WALK_RING } from '../config';
import type { DataBundle } from '../data';
import type { Mode, Placement, Plan, Site } from '../types';
import { type EngineIndex, PART_CAR, PART_NO_CAR, type Part, engineIndex } from './context';

export type Effect =
  | { kind: 'cover'; part: Part; credit: number; cells: Int32Array }
  | { kind: 'cool'; cells: Int32Array; deltaC: Float64Array };

/** A shelter is unusable if its building floods by the final step. */
export function siteUsable(site: Site): boolean {
  return site.floodStep === null || site.floodStep > FINAL_FLOOD_STEP;
}

function floodsByEnd(idx: EngineIndex, i: number): boolean {
  const step = idx.floodStep[i]!;
  return step > 0 && step <= FINAL_FLOOD_STEP;
}

const shelterCache = new WeakMap<Site, Int32Array>();

/**
 * Cells a shelter at `site` serves, if the site is usable. A cell that floods evacuates before the
 * water arrives, so it counts if it is in coverDry. A cell that stays dry but is cut off must reach
 * the shelter at the final step, so it needs coverFlood. Cached per site (bundles are immutable).
 */
export function shelterCells(site: Site, idx: EngineIndex): Int32Array {
  let cells = shelterCache.get(site);
  if (!cells) {
    const out = site.coverDry.filter((i) => floodsByEnd(idx, i));
    for (const i of site.coverFlood) if (!floodsByEnd(idx, i)) out.push(i);
    cells = Int32Array.from(out);
    shelterCache.set(site, cells);
  }
  return cells;
}

/** The effect of one placement, or null if it does nothing (flooded shelter, unknown id). */
export function placementEffect(p: Placement, idx: EngineIndex): Effect | null {
  switch (p.type) {
    case 'shelter': {
      const site = p.siteId === undefined ? undefined : idx.sites.get(p.siteId);
      if (!site || !siteUsable(site)) return null;
      return { kind: 'cover', part: PART_CAR, credit: 1, cells: shelterCells(site, idx) };
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
  cover: Float64Array; // [part * n + i], 0..1
  coolingC: Float64Array;
}

export function emptyState(mode: Mode, idx: EngineIndex): CoverState {
  return { mode, cover: new Float64Array(2 * idx.n), coolingC: new Float64Array(idx.n) };
}

export function applyEffect(state: CoverState, eff: Effect, n: number): void {
  if (eff.kind === 'cover') {
    const base = eff.part * n;
    for (const i of eff.cells) {
      if (state.cover[base + i]! < eff.credit) state.cover[base + i] = eff.credit;
    }
  } else {
    for (let k = 0; k < eff.cells.length; k++) state.coolingC[eff.cells[k]!]! += eff.deltaC[k]!;
  }
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
  const eff = placementEffect(p, idx);
  if (!eff) return [];
  const m = idx.mode[mode];
  const n = idx.n;
  const out: number[] = [];
  for (let k = 0; k < eff.cells.length; k++) {
    const i = eff.cells[k]!;
    if (!m.atRisk[i]) continue;
    const helps =
      eff.kind === 'cover'
        ? m.partW[eff.part * n + i]! > 0
        : mode === 'heat' && idx.heatC[i]! - eff.deltaC[k]! < idx.heatThreshold;
    if (helps) out.push(i);
  }
  return out;
}
