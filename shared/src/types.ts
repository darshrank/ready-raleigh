// Data contracts. Source of truth for every lane; mirrors AGENTS.md exactly.
// Change only with a note in docs/DECISIONS.md.

export type Mode = 'flood' | 'heat';
export type InterventionType =
  | 'shelter' | 'bus_pickup' | 'road_protection'          // flood
  | 'cooling_center' | 'tree_planting' | 'water_station'; // heat

export interface Cell {
  i: number;            // index into cells array
  h3: string;
  hood: string;         // neighborhood name for cards and debrief
  pop: number;
  pop65: number;
  lowInc: number;       // people below poverty line
  noCarHH: number;      // households with no vehicle
  floodStep: number | null; // first cumulative flooded area share >= 20%, else null
  floodFrac: number;    // area share inside the cumulative step-3 zones, 0..1
  cutOff: boolean;      // loses all hospital access at final flood step
  heatC: number;        // mean land surface temperature, Celsius
  treePct: number;      // 0 to 100
}

export interface Site {          // shelter candidates
  id: string; name: string; kind: string;
  lon: number; lat: number; cell: number;
  floodStep: number | null;      // shelter unusable if flooded
  coverDry: number[];            // at-risk cells within drive limit, nearest first
  coverFlood: number[];          // at-risk cells within drive limit at final step, nearest first
  driveDry: number[];            // integer milliseconds, aligned with coverDry
  driveFlood: number[];          // integer milliseconds, aligned with coverFlood
}

export interface FloodRoad {      // road protection candidates
  id: string; name: string; floodStep: number;
  coords: [number, number][];
  unlocks: number[];             // cells that stay connected if this road stays open
}

export interface Placement {
  id: string; type: InterventionType;
  cell?: number; siteId?: string; roadId?: string;
}

export interface Plan {
  roomCode: string; playerId: string; playerName: string;
  mode: Mode; placements: Placement[]; spent: number;
}

export interface ScoreResult {
  score: number;                 // 0 to 100
  bestPossible: number;          // optimizer's score for the same mode/data/budget (heuristic)
  atRiskWeighted: number; protectedWeighted: number;
  protectedPeople: number; strandedPeople: number;
  vulnerable: { protectedPct: number; everyonePct: number };
  byHood: { hood: string; atRisk: number; protected: number }[];
  topMisses: { cell: number; hood: string; reason: string; weighted: number }[];
}
