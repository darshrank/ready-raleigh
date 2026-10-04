// What changes from city to city: where its data lives, the words of its briefing, storm and news,
// and the kind of disaster the map draws. The engine and the screens stay the same; one city plays
// per page, chosen by ?city= (Raleigh by default).
import { BUDGET, PLANNING_SECONDS } from '@shared/config';
import { cityById, type CameraStop, type CityId } from './cities';
import type { Lang } from './news';

export type Hazard = 'flood' | 'quake' | 'heat';

/**
 * The storm's clock. Storm time maps linearly from `start` to `end` (hours from midnight of the
 * first day, so 33 is 9 AM the next day). Sunrise and sunset are local, early October.
 */
export interface StormClock {
  days: [string, string];
  start: number;
  end: number;
  sunrise: number;
  sunset: number;
}

export interface BriefingLine {
  text: string;
  stop: CameraStop | null;
}

export interface Story {
  id: CityId;
  name: string;
  hazard: Hazard;
  /** Where the title orbit circles: a downtown with 3D buildings. */
  orbit: [number, number];
  title: [string, string];
  body: string;
  /** The narrated briefing: each line with the tour stop the camera flies to while it is said. */
  briefing: (atRiskPeople: number, stops: CameraStop[]) => BriefingLine[];
  /** Short names for the three steps (timeline pins, cards). */
  steps: Record<number, string>;
  /** "It floods at step 2" / "It fails at step 2". */
  verb: string;
  /** The broadcast band before the first step, and each step's headline. */
  band: string[];
  headline: Record<number, string>;
  /** The news anchor's first line, on each channel (news.ts). */
  alert: Record<Lang, string>;
  /** When the disaster happens: the storm timeline, the news clock and the map's daylight. */
  clock: StormClock;
  /** A road the step closes, for the LIVE caption (the anchor's words are in news.ts). */
  road: (name: string) => string;
  /** No road closes at `step`: the neighborhood the disaster reaches with the most people. */
  area: (hood: string, step: number) => string;
  /** The band's line for the neighborhoods a step reaches: "Water in Five Points, Glenwood". */
  reaches: (hoods: string, step: number) => string;
  /** "Start the storm", "The storm has passed", "the residents the water put at risk". */
  start: string;
  passed: string;
  cause: string;
  /** The roads that close: "flood-prone road". */
  roadKind: string;
  /** Why a site in the hazard is no use: "This building floods". */
  siteLost: string;
  /** Piece names when they differ from the flood game's, and pieces this city does not use. */
  pieceNames?: Partial<Record<'shelter' | 'bus_pickup' | 'road_protection', string>>;
  hidePieces?: ('shelter' | 'bus_pickup' | 'road_protection')[];
}

const minutes = Math.round(PLANNING_SECONDS / 60);
const money = `${BUDGET / 1e6} million dollars`;
const about = (n: number) => (n >= 1000 ? `About ${(Math.round(n / 500) * 500).toLocaleString('en-US')} people` : 'Thousands of people');

const STORIES: Record<CityId, Story> = {
  raleigh: {
    id: 'raleigh',
    name: 'Raleigh',
    hazard: 'flood',
    orbit: [-78.6405, 35.7775],
    title: ['Hurricane stalled overhead.', 'Tonight the creeks peak.'],
    body: 'Open shelters, send buses and protect roads before the creeks leave their banks. Then watch the storm test your plan on real Raleigh data.',
    briefing: (n, s) => [
      { text: 'Emergency briefing for Raleigh. A stalled hurricane has rained on the city since Wednesday, and tonight the creeks peak.', stop: null },
      { text: 'Crabtree Creek leaves its banks first, and the roads beside it go under.', stop: s[0] ?? null },
      { text: 'Walnut Creek follows, and neighborhoods south of downtown lose their way out.', stop: s[1] ?? null },
      { text: `${about(n)} live where the water will reach.`, stop: s[2] ?? null },
      { text: `You have ${money} and ${minutes} minutes. Open shelters, send buses and protect the roads people need.`, stop: null },
    ],
    steps: { 1: 'Floodway', 2: '100-year flood', 3: '500-year flood' },
    verb: 'floods',
    band: ['Flood warning for Raleigh', 'Heavy rain over the creeks', 'Stay off flooded roads'],
    headline: { 1: 'Creeks leave their banks', 2: 'Water reaches the 100-year flood line', 3: 'Water reaches the 500-year flood line' },
    alert: {
      en: 'Breaking news from Raleigh. Flash flooding has begun along the creeks.',
      hi: 'रॉली से बड़ी ख़बर। शहर के नदी-नालों में अचानक बाढ़ आ गई है।',
    },
    // Friday afternoon rain into the night; the water peaks before dawn, Saturday morning clears.
    clock: { days: ['Fri', 'Sat'], start: 15, end: 33, sunrise: 7.2, sunset: 19 },
    road: (r) => `${r} goes under`,
    area: (h) => `Water reaches ${h}`,
    reaches: (h) => `Water in ${h}`,
    start: 'Start the storm',
    passed: 'The storm has passed',
    cause: 'the water',
    roadKind: 'flood-prone',
    siteLost: 'This building floods',
  },
  miami: {
    id: 'miami',
    name: 'Miami',
    hazard: 'flood',
    orbit: [-80.1918, 25.7685],
    title: ['Hurricane landfall tonight.', 'Surge, rain and canals.'],
    body: 'Open shelters, send buses and protect roads before the water comes in from the bay. Then watch the storm test your plan on real Miami data.',
    briefing: (n, s) => [
      { text: 'Emergency briefing for Miami. A major hurricane makes landfall tonight.', stop: null },
      { text: 'Storm surge from Biscayne Bay reaches the Brickell waterfront first.', stop: s[0] ?? null },
      { text: 'Then the Miami River and the canals back up, and the low streets fill with rain.', stop: s[1] ?? null },
      { text: `${about(n)} live where the water will reach.`, stop: s[2] ?? null },
      { text: `You have ${money} and ${minutes} minutes. Open shelters, send buses and keep the roads to the hospitals open.`, stop: null },
    ],
    steps: { 1: 'Coastal surge zone', 2: '100-year flood', 3: '500-year flood' },
    verb: 'floods',
    band: ['Hurricane warning for Miami', 'Storm surge on Biscayne Bay', 'Stay off flooded roads'],
    headline: { 1: 'Storm surge reaches the waterfront', 2: 'Water reaches the 100-year flood line', 3: 'Water reaches the 500-year flood line' },
    alert: {
      en: 'Breaking news from Miami. Storm surge is coming ashore from Biscayne Bay.',
      hi: 'मियामी से बड़ी ख़बर। बिस्केन बे से तूफ़ानी लहरें शहर में घुस रही हैं।',
    },
    // The surge arrives Sunday afternoon, landfall comes at nightfall, Monday morning clears.
    clock: { days: ['Sun', 'Mon'], start: 12, end: 32, sunrise: 7.3, sunset: 19.1 },
    road: (r) => `${r} goes under`,
    area: (h) => `Water reaches ${h}`,
    reaches: (h) => `Water in ${h}`,
    start: 'Start the storm',
    passed: 'The storm has passed',
    cause: 'the water',
    roadKind: 'flood-prone',
    siteLost: 'This building floods',
  },
  'san-francisco': {
    id: 'san-francisco',
    name: 'San Francisco',
    hazard: 'quake',
    orbit: [-122.3985, 37.7915],
    title: ['M7.8 on the San Andreas.', 'No warning.'],
    body: 'Stage shelters, buses and road crews before the filled land gives way. Then watch the quake test your plan on real San Francisco data.',
    briefing: (n, s) => [
      { text: 'Emergency briefing for San Francisco. A magnitude 7.8 earthquake on the San Andreas Fault. There is no warning.', stop: null },
      { text: 'The ground fails first on the filled land of the Marina.', stop: s[0] ?? null },
      { text: 'South of Market and Mission Bay follow, and the roads across them buckle.', stop: s[1] ?? null },
      { text: `${about(n)} live on ground that will liquefy.`, stop: s[2] ?? null },
      { text: `You have ${money} and ${minutes} minutes. Open shelters, send buses and keep the roads to the hospitals open.`, stop: null },
    ],
    steps: { 1: 'Violent shaking', 2: 'Liquefaction spreads', 3: 'Aftershock' },
    verb: 'fails',
    band: ['Earthquake alert for San Francisco', 'Violent shaking citywide', 'Stay off damaged roads'],
    headline: { 1: 'Filled land fails on the bay shore', 2: 'Liquefaction spreads across the flats', 3: 'An aftershock hits the soft ground' },
    alert: {
      en: 'Breaking news. A magnitude 7.8 earthquake has struck San Francisco.',
      hi: 'सैन फ़्रांसिस्को से बड़ी ख़बर। 7.8 तीव्रता का भूकंप आया है।',
    },
    // The quake strikes in the Tuesday morning rush; the aftershock comes as the day ends.
    clock: { days: ['Tue', 'Wed'], start: 7.67, end: 22.67, sunrise: 7.15, sunset: 18.85 },
    road: (r) => `${r} buckles`,
    area: (h) => `The ground fails in ${h}`,
    reaches: (h) => `Ground failing in ${h}`,
    start: 'Start the quake',
    passed: 'The shaking has stopped',
    cause: 'the quake',
    roadKind: 'quake-prone',
    siteLost: 'This building stands on failing ground',
  },
  'new-york': {
    id: 'new-york',
    name: 'New York City',
    hazard: 'heat',
    orbit: [-73.9442, 40.8075],
    title: ['Heat dome over the city.', 'Heat index above 105°F.'],
    body: 'Open cooling centers and run cooling buses before the hottest blocks turn dangerous. Then watch the heat test your plan on real New York data.',
    briefing: (n, s) => [
      { text: 'Emergency briefing for New York City. A heat dome settles over Harlem and the South Bronx.', stop: null },
      { text: 'Central Harlem heats first: dense housing, little shade, few trees.', stop: s[0] ?? null },
      { text: 'Then the grid strains, and cooling sites in the hottest blocks of Mott Haven lose power.', stop: s[1] ?? null },
      { text: `${about(n)} live in the hottest blocks.`, stop: s[2] ?? null },
      { text: `You have ${money} and ${minutes} minutes. Open cooling centers and send cooling buses to the people who need them.`, stop: null },
    ],
    steps: { 1: 'Dangerous heat', 2: 'The grid fails', 3: 'Heat spreads' },
    verb: 'overheats',
    band: ['Heat emergency for New York City', 'Heat index above 105°F', 'Check on older neighbors'],
    headline: { 1: 'The hottest blocks reach dangerous heat', 2: 'The grid fails in the hottest blocks', 3: 'Dangerous heat spreads' },
    alert: {
      en: 'Breaking news. A heat emergency in Harlem and the South Bronx.',
      hi: 'न्यूयॉर्क से बड़ी ख़बर। हार्लेम और साउथ ब्रॉन्क्स में भीषण गर्मी की आपात स्थिति।',
    },
    // Monday's heat peaks in the afternoon, the grid fails at the evening peak, the night stays hot.
    clock: { days: ['Mon', 'Tue'], start: 9, end: 33, sunrise: 6.95, sunset: 18.6 },
    road: (r) => `${r} is closed`,
    area: (h, step) => (step === 2 ? `The grid fails in ${h}` : `${h} reaches dangerous heat`),
    reaches: (h, step) => (step === 2 ? `Power out in ${h}` : `Dangerous heat in ${h}`),
    start: 'Start the heat wave',
    passed: 'The heat has broken',
    cause: 'the heat',
    roadKind: 'heat-closed',
    siteLost: 'This building loses power in the blackout',
    pieceNames: { shelter: 'Cooling center', bus_pickup: 'Cooling bus' },
    hidePieces: ['road_protection'],
  },
};

/** The city this page plays (?city=, Raleigh unless the city is ready). */
export function currentCityId(): CityId {
  if (typeof window === 'undefined') return 'raleigh';
  const id = new URLSearchParams(window.location.search).get('city');
  const city = cityById(id);
  return city && city.ready ? city.id : 'raleigh';
}

export const storyOf = (id: CityId) => STORIES[id];
export const currentStory = () => STORIES[currentCityId()];

/** Where the city's static data lives. Raleigh keeps the original folder (and VITE_DATA_BASE for fixtures). */
export function dataBase(id: CityId = currentCityId()): string {
  return id === 'raleigh' ? import.meta.env.VITE_DATA_BASE || '/data' : `/data/cities/${id}`;
}
