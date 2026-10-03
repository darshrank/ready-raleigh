import type { InterventionKind } from "@/config/game";

export type CityId = "raleigh" | "miami" | "new-york" | "san-francisco";

export type Phase =
  | "landing"
  | "select"
  | "mode"
  | "preview"
  | "loading"
  | "briefing"
  | "planning"
  | "locking"
  | "simulating"
  | "results";

export type CameraMode = "analysis" | "city" | "tactical" | "shadow";

export interface CameraBookmark {
  id: string;
  label: string;
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Skyline silhouette pieces on a 0-100 wide, 0-40 tall canvas. */
export type SkylineShape =
  | { t: "box"; x: number; w: number; h: number }
  | { t: "spire"; x: number; w: number; h: number; s: number }
  | { t: "dome"; x: number; w: number; h: number }
  | { t: "pyramid"; x: number; w: number; h: number }
  | { t: "tower"; x: number; w: number; h: number }
  | { t: "palm"; x: number; h: number };

export interface AttributionEntry {
  label: string;
  url: string;
}

export interface InterventionDefinition {
  kind: InterventionKind;
  /** What the intervention snaps to on the real map. */
  snapsTo: "shelterSite" | "busStop" | "crossing" | "fireStation";
}

export interface CityPack {
  id: CityId;
  name: string;
  state: string;
  center: [number, number];
  initialZoom: number;
  initialPitch: number;
  initialBearing: number;
  scenarioIds: string[];
  status: "playable" | "preview";
  accent: string;
  accent2: string;
  hazard: string;
  scenarioTitle: string;
  difficulty: number;
  specialMechanic: string;
  question: string;
  populationTheme: string;
  hoverEffect: "rain" | "surge" | "thermal" | "seismic";
  interventionCatalog: InterventionDefinition[];
  /** Full intervention list from the design, shown on preview cards. */
  interventionNames: string[];
  skyline: SkylineShape[];
  cameraBookmarks: CameraBookmark[];
  attribution: AttributionEntry[];
  plannedSources: string[];
}

export interface ScenarioBriefing {
  headline: string;
  script: string;
  hazard: string;
  timeline: { hour: number; label: string }[];
  uncertainty: string[];
}

export interface ScenarioEventDefinition {
  id: string;
  label: string;
  description: string;
}

export interface DisasterScenario {
  id: string;
  cityId: CityId;
  name: string;
  narrative: string[];
  durationHours: number;
  briefing: ScenarioBriefing;
  hazards: string[];
  randomEvents: ScenarioEventDefinition[];
}

export interface PlacedIntervention {
  id: string;
  kind: InterventionKind;
  /** Index into the facility, bus stop or crossing list the kind snaps to. */
  target: number;
  lon: number;
  lat: number;
  label: string;
}

export type SelectedEntity =
  | { type: "zone"; id: number }
  | { type: "shelterSite"; id: number }
  | { type: "busStop"; id: number }
  | { type: "crossing"; id: number }
  | { type: "hospital"; id: number }
  | { type: "fireStation"; id: number }
  | { type: "intervention"; id: string }
  | null;

export type StatusLevel = "STABLE" | "WATCH" | "ELEVATED" | "CRITICAL" | "ISOLATED";
