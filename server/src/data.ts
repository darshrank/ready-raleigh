// The game data the server scores plays against: the same folder the app loads (shared/scripts/bundle).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUDGET, type CityId, type DataBundle, type Mode, type OptimalPlan, type Plan, type TransitSource, optimize } from '@shared';
import { dataDir, loadBundle } from '../../shared/scripts/bundle';
import { EXTENDED_BUDGET_FACTOR } from './planner';

/** transit_stops.json (python -m pipeline.transit): existing bus stops in the study area. */
export interface TransitStops {
  built: string;
  sources: TransitSource[];
  /** [lon, lat, name, index into sources, stable id like "goraleigh-2320943"]. */
  stops: [number, number, string, number, string][];
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

/** Folder of a city pack: Raleigh is the data folder itself, the others live under cities/<id>. */
export const cityDir = (city: CityId, base = dataDir()) => (city === 'raleigh' ? base : join(base, 'cities', city));

/**
 * Game data per city, loaded on first use and kept. A city whose folder is missing (the fixtures
 * have no city packs) gives null, so its plays keep the client's score and its reports are off.
 */
export function cityLoader(raleigh: GameData | null, base = dataDir()) {
  const loaded = new Map<CityId, GameData | null>([['raleigh', raleigh]]);
  return (city: CityId = 'raleigh'): GameData | null => {
    if (!loaded.has(city)) {
      const dir = cityDir(city, base);
      let game: GameData | null = null;
      try {
        if (existsSync(join(dir, 'cells.json'))) game = loadGameData(dir);
      } catch {
        game = null;
      }
      loaded.set(city, game);
    }
    return loaded.get(city) ?? null;
  };
}

