// A typed-array index over a DataBundle, built once per bundle and cached, so scoring a plan is
// a few passes over flat arrays instead of object lookups.
import { gridDisk } from 'h3-js';
import { NO_CAR_HH_WEIGHT, weightedPeople } from '../config';
import type { DataBundle } from '../data';
import type { FloodRoad, Mode, Site } from '../types';
import { atRiskMask, heatThreshold } from './atRisk';

/**
 * Each cell's weighted people split into two parts, so a placement can protect one part only.
 * Flood: PART_CAR is everyone but the no-car term (served by shelters and open roads), PART_NO_CAR
 * is 2.5 * noCarHH (served by bus pickups). Heat: the whole weight sits in PART_CAR.
 */
export const PART_CAR = 0;
export const PART_NO_CAR = 1;
export type Part = typeof PART_CAR | typeof PART_NO_CAR;

export interface ModeIndex {
  atRisk: Uint8Array;
  /** Weight of part p of cell i at [p * n + i]; zero for cells not at risk. */
  partW: Float64Array;
}

export interface EngineIndex {
  n: number;
  weight: Float64Array;
  /** pop65 + lowInc + 2.5 * noCarHH: the vulnerable share of the weight. */
  vulnW: Float64Array;
  pop: Float64Array;
  heatC: Float64Array;
  floodStep: Int8Array; // 0 = never floods
  hoodOf: Int32Array;
  hoods: string[];
  heatThreshold: number;
  mode: Record<Mode, ModeIndex>;
  sites: Map<string, Site>;
  roads: Map<string, FloodRoad>;
  /** Cell index for an H3 id, or undefined if the cell is not in the bundle. */
  cellOfH3(h3: string): number | undefined;
  /** Cell indices within `k` rings of cell `i` that exist in the bundle (cached). */
  disk(i: number, k: number): Int32Array;
}

const cache = new WeakMap<DataBundle, EngineIndex>();

/** The index for `data`. Built on first use; treat bundles as immutable after that. */
export function engineIndex(data: DataBundle): EngineIndex {
  let idx = cache.get(data);
  if (!idx) {
    idx = buildIndex(data);
    cache.set(data, idx);
  }
  return idx;
}

function buildIndex(data: DataBundle): EngineIndex {
  const { cells } = data;
  const n = cells.length;
  const weight = new Float64Array(n);
  const vulnW = new Float64Array(n);
  const pop = new Float64Array(n);
  const heatC = new Float64Array(n);
  const floodStep = new Int8Array(n);
  const hoodOf = new Int32Array(n);
  const hoods: string[] = [];
  const hoodIds = new Map<string, number>();
  const noCarW = new Float64Array(n);

  cells.forEach((c, i) => {
    weight[i] = weightedPeople(c);
    noCarW[i] = NO_CAR_HH_WEIGHT * c.noCarHH;
    vulnW[i] = c.pop65 + c.lowInc + noCarW[i]!;
    pop[i] = c.pop;
    heatC[i] = c.heatC;
    floodStep[i] = c.floodStep ?? 0;
    let h = hoodIds.get(c.hood);
    if (h === undefined) {
      h = hoods.length;
      hoods.push(c.hood);
      hoodIds.set(c.hood, h);
    }
    hoodOf[i] = h;
  });

  let h3Map: Map<string, number> | null = null;
  const cellOfH3 = (h3: string) => (h3Map ??= new Map(cells.map((c, i) => [c.h3, i]))).get(h3);

  const floodRisk = atRiskMask('flood', cells);
  const floodW = new Float64Array(2 * n);
  const heatRisk = atRiskMask('heat', cells);
  const heatW = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    if (floodRisk[i]) {
      floodW[PART_CAR * n + i] = weight[i]! - noCarW[i]!;
      floodW[PART_NO_CAR * n + i] = noCarW[i]!;
    }
    if (heatRisk[i]) heatW[PART_CAR * n + i] = weight[i]!;
  }

  const disks = new Map<number, Int32Array>();
  const disk = (i: number, k: number): Int32Array => {
    const key = i * 8 + k;
    let d = disks.get(key);
    if (!d) {
      const h3 = cells[i]?.h3;
      const out: number[] = [];
      if (h3) {
        for (const h of gridDisk(h3, k)) {
          const j = cellOfH3(h);
          if (j !== undefined) out.push(j);
        }
      }
      d = Int32Array.from(out);
      disks.set(key, d);
    }
    return d;
  };

  return {
    n,
    weight,
    vulnW,
    pop,
    heatC,
    floodStep,
    hoodOf,
    hoods,
    heatThreshold: heatThreshold(cells),
    mode: {
      flood: { atRisk: floodRisk, partW: floodW },
      heat: { atRisk: heatRisk, partW: heatW },
    },
    sites: new Map(data.sites.map((s) => [s.id, s])),
    roads: new Map(data.floodRoads.map((r) => [r.id, r])),
    cellOfH3,
    disk,
  };
}
