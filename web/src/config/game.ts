/**
 * Every tunable game number lives here: budget, timer, per-city intervention
 * costs, capacities, radii, hazard timing and score weights. They are game
 * parameters, not real-world engineering estimates.
 */
import type { CityId } from "@/types";

export const BRAND = {
  name: "FAULTLINE",
  subtitle: "Cities Under Pressure",
  tagline: "Pick a city. Face the disaster. Rewrite the outcome.",
  secondary: "A multiplayer geospatial resilience game powered by real cities and real data.",
  hero: "Can you save a city before time runs out?",
  heroSupport: "Plan against real geography. Survive the disaster. Discover what everyone else missed.",
  closing: "Maps show us where hazards are. FAULTLINE shows us where action changes the outcome.",
  disclaimer: "Scenario simulation — not an emergency forecast.",
} as const;

export const ROUND = {
  budget: 10_000_000,
  planningSeconds: 180,
  timeFreezeSeconds: 10,
  intelTokens: 3,
  lockCountdown: 3,
};

export const ROOM = {
  codeLength: 5,
  simulatedPlayers: 5,
};

/** Game scoring model. Weights are design choices, not scientific constants. */
export const SCORE_WEIGHTS = {
  population: 0.25,
  vulnerable: 0.25,
  accessibility: 0.15,
  network: 0.1,
  budget: 0.1,
  equity: 0.15,
};

export const SCORE_LABELS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  population: "Population Protection",
  vulnerable: "Vulnerable Population",
  accessibility: "Accessibility",
  network: "Network Resilience",
  budget: "Budget Efficiency",
  equity: "Equity",
};

// ------------------------------------------------------------ interventions

/** What an intervention does inside the engine. */
export type EffectType = "shelter" | "pickup" | "protectRoad" | "rescue" | "shield" | "protectSite" | "medical";
/** What it snaps to on the real map. */
export type SnapTarget = "shelterSite" | "busStop" | "crossing" | "fireStation" | "shieldPoint" | "zone";
export type IconKey =
  | "shelter"
  | "busPickup"
  | "protectRoad"
  | "rescueTeam"
  | "barrier"
  | "pump"
  | "generator"
  | "water"
  | "medical"
  | "fireStaging"
  | "retrofit"
  | "cooling";

/** An intervention id is unique within its city. */
export type InterventionKind = string;

export interface InterventionSpec {
  id: InterventionKind;
  label: string;
  short: string;
  description: string;
  cost: number;
  effect: EffectType;
  snapsTo: SnapTarget;
  icon: IconKey;
  shieldKind?: "surge" | "rain";
  /** Shields: radius, hours of delay (Infinity blocks the hazard) and hazard sources affected. */
  radiusM?: number;
  delayH?: number;
  sources?: number[];
}

// ------------------------------------------------------------ hazards

/** Arrival (hours) = t0[zone class] + distance / spread[zone class]. */
export interface ArrivalTiming {
  t0: Record<1 | 2 | 3, number>;
  spread: Record<1 | 2 | 3, number>;
}

export interface HazardParams {
  type: "flood" | "coastal" | "heat" | "quake";
  /** Per hazard source (0 riverine, 1 surge, 2 rain, 3 canal). */
  sources: Record<number, ArrivalTiming>;
  /** Roads in the 0.2% zone only close if at least this share of the segment floods. */
  fringeRoadShare: number;
  closeDelayHours: Record<1 | 2 | 3, number>;
  /** Extra hours before a road closes, by road class (0 motorway ... 5 residential). */
  roadFreeboardHours: number[];
  peakHour: number;
  heat?: {
    /** Hour the hottest blocks become dangerous for people without cooling. */
    dangerStart: number;
    /** Hours until the coolest hot blocks follow. */
    dangerSpan: number;
    blackoutWindow: [number, number];
    blackoutZones: number;
    /** Hours after the blackout until blocks without power become dangerous. */
    blackoutDangerDelay: number;
    /** Share of at-risk residents who reach a cooler place on their own (family, cooled public space). */
    selfCoolShare: number;
  };
  quake?: {
    damageHour: number;
    /** Share of road segments in High liquefaction hazard that fail at the mainshock. */
    highDamageShare: number;
    /** Share of residents trapped in damaged buildings, by liquefaction class. */
    trappedShare: Record<1 | 2, number>;
    fire: { ignitions: number; startHour: number; spreadMph: number; minFuel: number; maxHours: number };
    aftershockWindow: [number, number];
    aftershockCloseShare: number;
    epicenter: [number, number];
  };
}

export interface CoverageParams {
  shelterDriveMinutes: number;
  shelterCapacity: number;
  walkToShelterMeters: number;
  busWalkMeters: number;
  busCapacity: number;
  busHeadwayMinutes: number;
  busToShelterMaxMinutes: number;
  busServiceEndsHour: number;
  rescueReachMinutes: number;
  rescueCapacity: number;
  rescueStartsHour: number;
  walkSpeedMps: number;
  hospitalAccessMinutes: number;
}

export interface ScenarioParams {
  /** Hour of day at simulation hour 0. */
  startClock: number;
  durationHours: number;
  /** Evacuation order, heat emergency or the earthquake itself. */
  orderHour: number;
  stepMinutes: number;
  residentsPerAgent: number;
  /** Share of car households that seek a public shelter instead of friends, family or hotels. */
  carShelterSeekingShare: number;
  /** Heat: nobody drives away from the hazard; everyone walks or rides to cooling. */
  everyoneWalks: boolean;
  /** Departure delay after the order, as cumulative shares by hour. */
  departureDelayCdf: [number, number][];
  olderAdultExtraDelayHours: number;
  /** Planning estimate looks at these hours. */
  refHours: number[];
  playback: { untilHour: number; secondsPerHour: number }[];
  phases: { untilHour: number; label: string }[];
  terms: { stranded: string; strandedVerb: string; hazardArea: string; order: string; atRisk: string; reached: string };
  coverage: CoverageParams;
  hazard: HazardParams;
  interventions: InterventionSpec[];
}

const NO_FREEBOARD = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];

const RALEIGH: ScenarioParams = {
  startClock: 6,
  durationHours: 36,
  orderHour: 2,
  stepMinutes: 10,
  residentsPerAgent: 100,
  carShelterSeekingShare: 0.2,
  everyoneWalks: false,
  departureDelayCdf: [
    [1, 0.3],
    [3, 0.62],
    [6, 0.84],
    [10, 0.95],
    [14, 1.0],
  ],
  olderAdultExtraDelayHours: 2,
  refHours: [5, 9],
  playback: [
    { untilHour: 2, secondsPerHour: 1.2 },
    { untilHour: 14, secondsPerHour: 3.6 },
    { untilHour: 36, secondsPerHour: 1.0 },
  ],
  phases: [
    { untilHour: 2, label: "Rain bands arriving" },
    { untilHour: 5, label: "Evacuation underway" },
    { untilHour: 12, label: "Creeks overtopping" },
    { untilHour: 30, label: "Widespread flooding" },
    { untilHour: 99, label: "Flood peak and recession" },
  ],
  terms: { stranded: "Stranded", strandedVerb: "stranded", hazardArea: "flood hazard area", order: "Evacuation order", atRisk: "Residents told to evacuate", reached: "Reached safety" },
  coverage: {
    shelterDriveMinutes: 15,
    shelterCapacity: 2500,
    walkToShelterMeters: 1200,
    busWalkMeters: 1500,
    busCapacity: 1200,
    busHeadwayMinutes: 30,
    busToShelterMaxMinutes: 30,
    busServiceEndsHour: 16,
    rescueReachMinutes: 20,
    rescueCapacity: 450,
    rescueStartsHour: 10,
    walkSpeedMps: 1.2,
    hospitalAccessMinutes: 30,
  },
  hazard: {
    type: "flood",
    sources: { 0: { t0: { 1: 5, 2: 9, 3: 16 }, spread: { 1: 110, 2: 80, 3: 60 } } },
    fringeRoadShare: 0.25,
    closeDelayHours: { 1: 0, 2: 0.25, 3: 1 },
    roadFreeboardHours: [Infinity, Infinity, 7, 3.5, 1.5, 0, 0],
    peakHour: 30,
  },
  interventions: [
    { id: "shelter", label: "Temporary Shelter", short: "Shelter", cost: 3_000_000, effect: "shelter", snapsTo: "shelterSite", icon: "shelter", description: "Opens a school or community site as a shelter. Covers at-risk residents within a 15-minute drive." },
    { id: "busPickup", label: "Bus Pickup Point", short: "Bus pickup", cost: 1_000_000, effect: "pickup", snapsTo: "busStop", icon: "busPickup", description: "Runs an evacuation shuttle loop from a real bus stop for households without a car within 1.5 km." },
    { id: "protectRoad", label: "Protect Critical Road", short: "Protect road", cost: 2_000_000, effect: "protectRoad", snapsTo: "crossing", icon: "protectRoad", description: "Barriers and pumps keep one flood-prone crossing passable for the whole event." },
    { id: "rescueTeam", label: "High-Water Rescue Team", short: "Rescue team", cost: 1_500_000, effect: "rescue", snapsTo: "fireStation", icon: "rescueTeam", description: "Stationed at a fire station. Reaches stranded residents after roads flood." },
  ],
};

const MIAMI: ScenarioParams = {
  startClock: 18,
  durationHours: 30,
  orderHour: 1,
  stepMinutes: 10,
  residentsPerAgent: 200,
  carShelterSeekingShare: 0.2,
  everyoneWalks: false,
  departureDelayCdf: [
    [1, 0.38],
    [2.5, 0.68],
    [5, 0.88],
    [8, 0.96],
    [11, 1.0],
  ],
  olderAdultExtraDelayHours: 1.5,
  refHours: [4, 9],
  playback: [
    { untilHour: 1, secondsPerHour: 1.2 },
    { untilHour: 15, secondsPerHour: 3.2 },
    { untilHour: 30, secondsPerHour: 1.0 },
  ],
  phases: [
    { untilHour: 1, label: "Outer bands arriving" },
    { untilHour: 5, label: "Evacuation underway" },
    { untilHour: 10, label: "Rain flooding low streets" },
    { untilHour: 16, label: "Storm surge pushing inland" },
    { untilHour: 99, label: "Compound flooding" },
  ],
  terms: { stranded: "Stranded", strandedVerb: "stranded", hazardArea: "surge and flood zones", order: "Evacuation order", atRisk: "Residents told to evacuate", reached: "Reached safety" },
  coverage: {
    shelterDriveMinutes: 15,
    shelterCapacity: 3000,
    walkToShelterMeters: 1200,
    busWalkMeters: 1500,
    busCapacity: 1500,
    busHeadwayMinutes: 30,
    busToShelterMaxMinutes: 30,
    busServiceEndsHour: 11,
    rescueReachMinutes: 20,
    rescueCapacity: 450,
    rescueStartsHour: 13,
    walkSpeedMps: 1.2,
    hospitalAccessMinutes: 30,
  },
  hazard: {
    type: "coastal",
    sources: {
      1: { t0: { 1: 11, 2: 12, 3: 14 }, spread: { 1: 900, 2: 700, 3: 500 } },
      2: { t0: { 1: 6.5, 2: 7.5, 3: 13 }, spread: { 1: 30, 2: 30, 3: 30 } },
      3: { t0: { 1: 9, 2: 9, 3: 13 }, spread: { 1: 150, 2: 150, 3: 150 } },
    },
    fringeRoadShare: 0.25,
    closeDelayHours: { 1: 0, 2: 0.25, 3: 1 },
    roadFreeboardHours: [Infinity, 5, 3, 2, 1, 0, 0],
    peakHour: 14,
  },
  interventions: [
    { id: "evacShelter", label: "Evacuation Shelter", short: "Shelter", cost: 3_000_000, effect: "shelter", snapsTo: "shelterSite", icon: "shelter", description: "Opens a school as a hurricane evacuation center. Covers at-risk residents within a 15-minute drive." },
    { id: "busHub", label: "Evacuation Bus Hub", short: "Bus hub", cost: 1_000_000, effect: "pickup", snapsTo: "busStop", icon: "busPickup", description: "Runs evacuation buses from a real Metrobus stop for households without a car within 1.5 km." },
    { id: "protectRoad", label: "Protect Critical Road", short: "Protect road", cost: 2_000_000, effect: "protectRoad", snapsTo: "crossing", icon: "protectRoad", description: "Keeps one low road or canal crossing passable through the storm." },
    { id: "coastalBarrier", label: "Deployable Coastal Barrier", short: "Coastal barrier", cost: 2_500_000, effect: "shield", snapsTo: "shieldPoint", shieldKind: "surge", icon: "barrier", radiusM: 700, delayH: 10, sources: [1], description: "Holds back storm surge for about 10 hours within 700 m of the shoreline site. Does nothing against rain." },
    { id: "mobilePump", label: "Mobile Pump", short: "Mobile pump", cost: 1_500_000, effect: "shield", snapsTo: "shieldPoint", shieldKind: "rain", icon: "pump", radiusM: 550, delayH: 10, sources: [2, 3], description: "Drains rain and canal flooding within 550 m. Useless against surge." },
    { id: "medicalSite", label: "Emergency Medical Site", short: "Medical site", cost: 1_500_000, effect: "medical", snapsTo: "shelterSite", icon: "medical", description: "Adds emergency care at a dry site, so neighborhoods cut off from hospitals keep access." },
  ],
};

const NEW_YORK: ScenarioParams = {
  startClock: 10,
  durationHours: 30,
  orderHour: 1,
  stepMinutes: 10,
  residentsPerAgent: 100,
  carShelterSeekingShare: 0,
  everyoneWalks: true,
  departureDelayCdf: [
    [1, 0.2],
    [3, 0.5],
    [6, 0.8],
    [9, 0.95],
    [12, 1.0],
  ],
  olderAdultExtraDelayHours: 2,
  refHours: [4, 7],
  playback: [
    { untilHour: 1, secondsPerHour: 1.2 },
    { untilHour: 12, secondsPerHour: 3.6 },
    { untilHour: 30, secondsPerHour: 1.2 },
  ],
  phases: [
    { untilHour: 1, label: "Heat dome building" },
    { untilHour: 4, label: "Heat emergency" },
    { untilHour: 8, label: "Peak heat, grid under strain" },
    { untilHour: 14, label: "Hot night, no relief" },
    { untilHour: 99, label: "Second day of extreme heat" },
  ],
  terms: { stranded: "Heat-stressed", strandedVerb: "heat-stressed", hazardArea: "heat island", order: "Heat emergency", atRisk: "Heat-vulnerable residents without cooling", reached: "Reached cooling" },
  coverage: {
    shelterDriveMinutes: 0,
    shelterCapacity: 4000,
    walkToShelterMeters: 1000,
    busWalkMeters: 1000,
    busCapacity: 1200,
    busHeadwayMinutes: 30,
    busToShelterMaxMinutes: 25,
    busServiceEndsHour: 22,
    rescueReachMinutes: 15,
    rescueCapacity: 1000,
    rescueStartsHour: 3,
    walkSpeedMps: 0.9,
    hospitalAccessMinutes: 30,
  },
  hazard: {
    type: "heat",
    sources: {},
    fringeRoadShare: 1,
    closeDelayHours: { 1: 0, 2: 0, 3: 0 },
    roadFreeboardHours: NO_FREEBOARD,
    peakHour: 6,
    heat: { dangerStart: 3, dangerSpan: 9, blackoutWindow: [4.5, 7.5], blackoutZones: 9, blackoutDangerDelay: 1.5, selfCoolShare: 0.5 },
  },
  interventions: [
    { id: "coolingCenter", label: "Cooling Center", short: "Cooling center", cost: 1_500_000, effect: "shelter", snapsTo: "shelterSite", icon: "cooling", description: "Opens a library, school or community site as a cooling center for the whole event. Up to 4,000 visits from residents within a 1 km walk." },
    { id: "coolingBus", label: "Mobile Cooling Bus", short: "Cooling bus", cost: 750_000, effect: "pickup", snapsTo: "busStop", icon: "busPickup", description: "Parks an air-conditioned bus at a real stop as a cooling space for up to 1,200 residents within a 1 km walk." },
    { id: "backupGenerator", label: "Backup Generator", short: "Generator", cost: 750_000, effect: "protectSite", snapsTo: "shelterSite", icon: "generator", description: "Keeps a site running through a blackout. Pair it with a cooling center." },
    { id: "waterStation", label: "Water & Shade Station", short: "Water station", cost: 500_000, effect: "shield", snapsTo: "busStop", icon: "water", radiusM: 600, delayH: 3, sources: [4], description: "Shade and water buy residents within 600 m about three more hours before heat becomes dangerous." },
    { id: "wellnessTeam", label: "Wellness Check Team", short: "Wellness team", cost: 1_000_000, effect: "rescue", snapsTo: "fireStation", icon: "rescueTeam", description: "Door-to-door checks reach up to 1,000 heat-stressed residents within 15 minutes of the base." },
    { id: "medicalHub", label: "Emergency Medical Hub", short: "Medical hub", cost: 1_500_000, effect: "medical", snapsTo: "shelterSite", icon: "medical", description: "Adds emergency care, so blocks far from hospitals keep 30-minute access." },
  ],
};

const SAN_FRANCISCO: ScenarioParams = {
  startClock: 4.5,
  durationHours: 24,
  orderHour: 0,
  stepMinutes: 10,
  residentsPerAgent: 100,
  carShelterSeekingShare: 0.35,
  everyoneWalks: false,
  departureDelayCdf: [
    [0.25, 0.3],
    [1, 0.62],
    [2, 0.85],
    [4, 1.0],
  ],
  olderAdultExtraDelayHours: 1,
  refHours: [0.5, 2],
  playback: [
    { untilHour: 0.5, secondsPerHour: 8 },
    { untilHour: 6, secondsPerHour: 4.2 },
    { untilHour: 24, secondsPerHour: 1.4 },
  ],
  phases: [
    { untilHour: 0.2, label: "Shaking" },
    { untilHour: 1, label: "Liquefaction and collapse" },
    { untilHour: 5, label: "Fires spreading" },
    { untilHour: 10, label: "Aftershocks" },
    { untilHour: 99, label: "Response and recovery" },
  ],
  terms: { stranded: "Trapped", strandedVerb: "trapped", hazardArea: "liquefaction and fire zones", order: "Earthquake", atRisk: "Residents in damaged or fire-prone blocks", reached: "Reached safety" },
  coverage: {
    shelterDriveMinutes: 15,
    shelterCapacity: 2500,
    walkToShelterMeters: 1200,
    busWalkMeters: 1500,
    busCapacity: 1000,
    busHeadwayMinutes: 30,
    busToShelterMaxMinutes: 30,
    busServiceEndsHour: 8,
    rescueReachMinutes: 20,
    rescueCapacity: 400,
    rescueStartsHour: 0.5,
    walkSpeedMps: 1.1,
    hospitalAccessMinutes: 30,
  },
  hazard: {
    type: "quake",
    sources: {},
    fringeRoadShare: 1,
    closeDelayHours: { 1: 0.05, 2: 0.05, 3: 0.05 },
    roadFreeboardHours: NO_FREEBOARD,
    peakHour: 8,
    quake: {
      damageHour: 0.1,
      highDamageShare: 0.35,
      trappedShare: { 1: 0.05, 2: 0.02 },
      fire: { ignitions: 3, startHour: 0.4, spreadMph: 420, minFuel: 0.25, maxHours: 12 },
      aftershockWindow: [5, 9],
      aftershockCloseShare: 0.12,
      epicenter: [-122.49, 37.66],
    },
  },
  interventions: [
    { id: "shelter", label: "Temporary Shelter", short: "Shelter", cost: 3_000_000, effect: "shelter", snapsTo: "shelterSite", icon: "shelter", description: "Opens an undamaged school or community site for displaced residents within a 15-minute drive." },
    { id: "clearCorridor", label: "Clear Emergency Corridor", short: "Clear corridor", cost: 2_000_000, effect: "protectRoad", snapsTo: "crossing", icon: "protectRoad", description: "Crews and shoring keep one road through the liquefaction zone open." },
    { id: "sarTeam", label: "Search-and-Rescue Team", short: "SAR team", cost: 1_500_000, effect: "rescue", snapsTo: "fireStation", icon: "rescueTeam", description: "Reaches trapped residents within 20 minutes of the station." },
    { id: "fireStaging", label: "Fire Response Staging", short: "Fire staging", cost: 2_000_000, effect: "shield", snapsTo: "fireStation", icon: "fireStaging", radiusM: 1200, delayH: Infinity, sources: [5], description: "Pre-staged engines and water stop fire spreading within 1.2 km of the station." },
    { id: "seismicRetrofit", label: "Seismic Retrofit Program", short: "Retrofit", cost: 3_000_000, effect: "shield", snapsTo: "zone", icon: "retrofit", radiusM: 700, delayH: Infinity, sources: [1], description: "Retrofitted soft-story buildings within 700 m of the neighborhood center ride out the shaking." },
    { id: "medicalStation", label: "Medical Field Station", short: "Medical station", cost: 1_500_000, effect: "medical", snapsTo: "shelterSite", icon: "medical", description: "Adds trauma care, so neighborhoods cut off from hospitals keep access." },
  ],
};

export const CITY_SCENARIOS: Record<CityId, ScenarioParams> = {
  raleigh: RALEIGH,
  miami: MIAMI,
  "new-york": NEW_YORK,
  "san-francisco": SAN_FRANCISCO,
};

export function specFor(cfg: ScenarioParams, kind: InterventionKind): InterventionSpec {
  return cfg.interventions.find((i) => i.id === kind) ?? cfg.interventions[0];
}

export function specForEffect(cfg: ScenarioParams, effect: EffectType): InterventionSpec | undefined {
  return cfg.interventions.find((i) => i.effect === effect);
}
