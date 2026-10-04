// GET /api/planner/bus-demand: the bus pickup demand report for transit and emergency planners.
// Built by server/src/demand.ts, shown on the app's /planner page.
import type { Mode } from './types';

/** One GTFS feed behind transit_stops.json. */
export interface TransitSource {
  agency: string;
  url: string;
  feedStart: string | null;
  feedEnd: string | null;
  /** The feed's end date has passed: newer stops may be missing. */
  expired: boolean;
  stops: number;
}

export interface DemandArea {
  rank: number;
  /** H3 resolution 8 index. */
  area: string;
  hood: string;
  /** Pick-weighted center of the requested pickups. */
  lon: number;
  lat: number;
  players: number;
  /** Share of all players in the period who asked for a pickup here, 0..1. */
  playerShare: number;
  picks: number;
  noCarHouseholds: number;
  noCarHouseholdsAtRisk: number;
  peopleAtRisk: number;
  nearestStop: { name: string; agency: string; meters: number } | null;
  stopsInWalk: number;
  /** No existing stop within WALK_M of the requested pickups. */
  gap: boolean;
  reason: string;
}

export interface BusDemandReport {
  mode: Mode;
  generatedAt: string;
  since: string;
  plays: number;
  players: number;
  minPlayers: number;
  /** Areas with some demand but fewer than minPlayers players. */
  hiddenAreas: number;
  gaps: number;
  areas: DemandArea[];
  summary: string;
  transitSources: TransitSource[];
  method: string;
}
