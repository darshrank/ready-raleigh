// The game data the server scores plays against: the same folder the app loads (shared/scripts/bundle).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUDGET, type DataBundle, type Mode, type OptimalPlan, type Plan, type TransitSource, optimize } from '@shared';
import { dataDir, loadBundle } from '../../shared/scripts/bundle';
import { EXTENDED_BUDGET_FACTOR } from './planner';

/** transit_stops.json (python -m pipeline.transit): existing bus stops in the study area. */
export interface TransitStops {
  built: string;
  sources: TransitSource[];
  /** [lon, lat, name, index into sources]. */
  stops: [number, number, string, number][];
}

export interface GameData {
  dir: string;
  bundle: DataBundle;
  /** Existing bus stops, or null if the folder has no transit_stops.json. */
  transit: TransitStops | null;
  /** Best plan per mode: optimal_<mode>.json if the folder has one, else the optimizer's (cached). */
  optimal(mode: Mode): Plan;
  /** The optimizer's plan for EXTENDED_BUDGET_FACTOR times the budget (cached by the optimizer). */
  extended(mode: Mode): Plan;
}

export function loadGameData(dir = dataDir()): GameData {
  const bundle = loadBundle(dir);
  const plans = new Map<Mode, Plan>();
  const transitFile = join(dir, 'transit_stops.json');
  return {
    dir,
    bundle,
    transit: existsSync(transitFile) ? (JSON.parse(readFileSync(transitFile, 'utf8')) as TransitStops) : null,
    optimal(mode) {
      let plan = plans.get(mode);
      if (!plan) {
        const file = join(dir, `optimal_${mode}.json`);
        plan = existsSync(file)
          ? (JSON.parse(readFileSync(file, 'utf8')) as OptimalPlan).plan
          : optimize(mode, bundle).plan;
        plans.set(mode, plan);
      }
      return plan;
    },
    extended: (mode) => optimize(mode, bundle, BUDGET * EXTENDED_BUDGET_FACTOR).plan,
  };
}
