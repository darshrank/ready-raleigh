// The game data the server scores plays against: the same folder the app loads (shared/scripts/bundle).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUDGET, type DataBundle, type Mode, type OptimalPlan, type Plan, optimize } from '@shared';
import { dataDir, loadBundle } from '../../shared/scripts/bundle';
import { EXTENDED_BUDGET_FACTOR } from './planner';

export interface GameData {
  dir: string;
  bundle: DataBundle;
  /** Best plan per mode: optimal_<mode>.json if the folder has one, else the optimizer's (cached). */
  optimal(mode: Mode): Plan;
  /** The optimizer's plan for EXTENDED_BUDGET_FACTOR times the budget (cached by the optimizer). */
  extended(mode: Mode): Plan;
}

export function loadGameData(dir = dataDir()): GameData {
  const bundle = loadBundle(dir);
  const plans = new Map<Mode, Plan>();
  return {
    dir,
    bundle,
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
