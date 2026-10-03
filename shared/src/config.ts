// Game config. Every value is a placeholder to tune (AGENTS.md "Game config").
import type { Cell, InterventionType } from './types';

export const BUDGET = 10_000_000;
export const PLANNING_SECONDS = 180;

export const COSTS: Record<InterventionType, number> = {
  shelter: 3_000_000,
  bus_pickup: 1_000_000,
  road_protection: 2_000_000,
  cooling_center: 2_000_000,
  tree_planting: 500_000,
  water_station: 250_000,
};

/** Shelter coverage: cells within this drive time. */
export const SHELTER_DRIVE_LIMIT_S = 15 * 60;

/** Walk coverage as an H3 gridDisk radius around the placed cell. */
export const WALK_RING: Partial<Record<InterventionType, number>> = {
  bus_pickup: 2,
  cooling_center: 2,
  water_station: 1,
};

/** Tree planting cooling, Celsius. */
export const TREE_COOLING_C = { cell: 1.5, ring1: 0.5 };

/** Heat at-risk threshold as a percentile of cell heatC. */
export const HEAT_THRESHOLD_PERCENTILE = 80;

/** Final flood step used for at-risk and cut-off checks. */
export const FINAL_FLOOD_STEP = 3;

/** Optional shelter capacity in people; null turns it off. */
export const SHELTER_CAPACITY: number | null = null;

/** Weighted people per cell: pop + pop65 + lowInc + 2.5 * noCarHH. */
export function weightedPeople(c: Pick<Cell, 'pop' | 'pop65' | 'lowInc' | 'noCarHH'>): number {
  return c.pop + c.pop65 + c.lowInc + 2.5 * c.noCarHH;
}
