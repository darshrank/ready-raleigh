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
  floodStep: number | null; // first flood step that reaches this cell, null if never
  cutOff: boolean;      // loses all hospital access at final flood step
  heatC: number;        // mean land surface temperature, Celsius
  treePct: number;      // 0 to 100
}

export interface Site {          // shelter candidates
  id: string; name: string; kind: string;
  lon: number; lat: number; cell: number;
  floodStep: number | null;      // shelter unusable if flooded
  coverDry: number[];            // cell indices within drive limit, no flooding
  coverFlood: number[];          // cell indices within drive limit, final flood step
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
  atRiskWeighted: number; protectedWeighted: number;
  protectedPeople: number; strandedPeople: number;
  vulnerable: { protectedPct: number; everyonePct: number };
  byHood: { hood: string; atRisk: number; protected: number }[];
  topMisses: { cell: number; hood: string; reason: string; weighted: number }[];
}
