// Which cells are at risk in each mode (AGENTS.md "Flood model" and "Heat model").
import { FINAL_FLOOD_STEP, HEAT_THRESHOLD_PERCENTILE } from '../config';
import type { DataBundle } from '../data';
import type { Cell, Mode } from '../types';
import { engineIndex } from './context';

/** Flood: floods by the final step, or loses every route to a hospital at the final step. */
export function isFloodAtRisk(c: Cell): boolean {
  return (c.floodStep !== null && c.floodStep <= FINAL_FLOOD_STEP) || c.cutOff;
}

/** Heat threshold in Celsius: the configured percentile of cell heat (nearest rank). */
export function heatThreshold(cells: Cell[], percentile = HEAT_THRESHOLD_PERCENTILE): number {
  if (cells.length === 0) return Infinity;
  const sorted = Float64Array.from(cells, (c) => c.heatC).sort();
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((percentile / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

/** Heat: at or above the threshold. */
export function isHeatAtRisk(c: Cell, threshold: number): boolean {
  return c.heatC >= threshold;
}

/** 1 for each at-risk cell, indexed like `cells`. */
export function atRiskMask(mode: Mode, cells: Cell[]): Uint8Array {
  const mask = new Uint8Array(cells.length);
  const t = mode === 'heat' ? heatThreshold(cells) : 0;
  cells.forEach((c, i) => {
    mask[i] = (mode === 'flood' ? isFloodAtRisk(c) : isHeatAtRisk(c, t)) ? 1 : 0;
  });
  return mask;
}

/** Indices of at-risk cells (cached per bundle). */
export function atRiskCells(mode: Mode, data: DataBundle): number[] {
  const mask = engineIndex(data).mode[mode].atRisk;
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
  return out;
}
