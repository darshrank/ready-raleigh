// The four city packs on the globe and in city select. Only cities with `ready` load a game;
// the others show on the globe and say they are next.

export type CityId = 'raleigh' | 'miami' | 'new-york' | 'san-francisco';

/** Skyline silhouette pieces on a 0-100 wide, 0-40 tall canvas. */
export type SkylineShape =
  | { t: 'box'; x: number; w: number; h: number }
  | { t: 'spire'; x: number; w: number; h: number; s: number }
  | { t: 'dome'; x: number; w: number; h: number }
  | { t: 'pyramid'; x: number; w: number; h: number }
  | { t: 'tower'; x: number; w: number; h: number }
  | { t: 'palm'; x: number; h: number };

export interface CameraStop {
  label: string;
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface City {
  id: CityId;
  name: string;
  state: string;
  hazard: string;
  title: string;
  question: string;
  center: [number, number];
  /** Playable in this build. */
  ready: boolean;
  /** Where the briefing's camera tour goes, in order. */
  tour: CameraStop[];
  skyline: SkylineShape[];
}

export const CITIES: City[] = [
  {
    id: 'raleigh',
    name: 'Raleigh',
    state: 'North Carolina',
    hazard: 'Hurricane flooding',
    title: 'Hurricane cascade',
    question: 'What happens when roads disappear?',
    center: [-78.6382, 35.7796],
    ready: true,
    tour: [
      { label: 'Crabtree Creek', center: [-78.6505, 35.8285], zoom: 13.6, pitch: 58, bearing: 25 },
      { label: 'Walnut Creek', center: [-78.6142, 35.7468], zoom: 13.6, pitch: 58, bearing: -35 },
      { label: 'Downtown', center: [-78.6391, 35.7781], zoom: 14.2, pitch: 60, bearing: -20 },
    ],
    skyline: [
      { t: 'box', x: 2, w: 7, h: 8 },
      { t: 'box', x: 10, w: 6, h: 12 },
      { t: 'dome', x: 18, w: 12, h: 10 },
      { t: 'box', x: 32, w: 7, h: 18 },
      { t: 'spire', x: 40, w: 9, h: 30, s: 4 },
      { t: 'box', x: 50, w: 8, h: 24 },
      { t: 'box', x: 59, w: 6, h: 14 },
      { t: 'tower', x: 66, w: 8, h: 21 },
      { t: 'box', x: 76, w: 7, h: 11 },
      { t: 'box', x: 85, w: 6, h: 7 },
      { t: 'box', x: 92, w: 6, h: 5 },
    ],
  },
  {
    id: 'miami',
    name: 'Miami',
    state: 'Florida',
    hazard: 'Storm surge and flooding',
    title: 'Storm surge siege',
    question: 'Can you stay ahead of rising water?',
    center: [-80.1918, 25.7617],
    ready: true,
    tour: [
      { label: 'Brickell waterfront', center: [-80.1903, 25.7617], zoom: 14.2, pitch: 60, bearing: 20 },
      { label: 'Miami River', center: [-80.2235, 25.7802], zoom: 13.6, pitch: 55, bearing: 40 },
      { label: 'Coconut Grove', center: [-80.2397, 25.7275], zoom: 13.8, pitch: 55, bearing: -25 },
    ],
    skyline: [
      { t: 'box', x: 2, w: 5, h: 10 },
      { t: 'palm', x: 9, h: 12 },
      { t: 'box', x: 13, w: 5, h: 22 },
      { t: 'box', x: 19, w: 4, h: 28 },
      { t: 'tower', x: 24, w: 6, h: 34 },
      { t: 'box', x: 31, w: 5, h: 26 },
      { t: 'box', x: 37, w: 6, h: 31 },
      { t: 'spire', x: 44, w: 6, h: 33, s: 5 },
      { t: 'box', x: 51, w: 5, h: 24 },
      { t: 'box', x: 57, w: 4, h: 29 },
      { t: 'box', x: 62, w: 6, h: 20 },
      { t: 'palm', x: 70, h: 14 },
      { t: 'box', x: 74, w: 5, h: 16 },
      { t: 'box', x: 80, w: 6, h: 12 },
      { t: 'palm', x: 89, h: 11 },
      { t: 'box', x: 93, w: 5, h: 7 },
    ],
  },
  {
    id: 'new-york',
    name: 'New York City',
    state: 'New York',
    hazard: 'Heat wave and blackouts',
    title: 'Heat grid',
    question: 'Who loses protection when the city overheats and the grid weakens?',
    center: [-73.915, 40.832],
    ready: true,
    tour: [
      { label: 'Central Harlem', center: [-73.9465, 40.8116], zoom: 14, pitch: 60, bearing: 29 },
      { label: 'Mott Haven', center: [-73.9235, 40.8089], zoom: 14, pitch: 58, bearing: -20 },
      { label: 'Fordham', center: [-73.8985, 40.8615], zoom: 13.6, pitch: 55, bearing: 10 },
    ],
    skyline: [
      { t: 'box', x: 1, w: 5, h: 14 },
      { t: 'box', x: 7, w: 4, h: 20 },
      { t: 'box', x: 12, w: 5, h: 17 },
      { t: 'spire', x: 18, w: 7, h: 32, s: 7 },
      { t: 'box', x: 26, w: 4, h: 22 },
      { t: 'box', x: 31, w: 6, h: 25 },
      { t: 'box', x: 38, w: 4, h: 19 },
      { t: 'spire', x: 43, w: 6, h: 27, s: 5 },
      { t: 'box', x: 50, w: 5, h: 21 },
      { t: 'box', x: 56, w: 4, h: 16 },
      { t: 'box', x: 61, w: 5, h: 24 },
      { t: 'spire', x: 69, w: 8, h: 30, s: 8 },
      { t: 'box', x: 78, w: 5, h: 18 },
      { t: 'box', x: 84, w: 5, h: 13 },
      { t: 'box', x: 90, w: 4, h: 15 },
      { t: 'box', x: 95, w: 4, h: 9 },
    ],
  },
  {
    id: 'san-francisco',
    name: 'San Francisco',
    state: 'California',
    hazard: 'Earthquake, liquefaction and fire',
    title: 'The big one',
    question: 'What fails after the shaking stops?',
    center: [-122.4194, 37.7749],
    ready: true,
    tour: [
      { label: 'Marina, on filled land', center: [-122.4368, 37.8037], zoom: 14.2, pitch: 58, bearing: 10 },
      { label: 'SoMa and Mission Bay', center: [-122.3999, 37.7745], zoom: 14, pitch: 60, bearing: -28 },
      { label: 'The Mission', center: [-122.4167, 37.7599], zoom: 14, pitch: 55, bearing: 15 },
    ],
    skyline: [
      { t: 'box', x: 2, w: 6, h: 9 },
      { t: 'tower', x: 9, w: 3, h: 26 },
      { t: 'box', x: 14, w: 5, h: 14 },
      { t: 'box', x: 20, w: 6, h: 20 },
      { t: 'pyramid', x: 27, w: 9, h: 32 },
      { t: 'box', x: 37, w: 5, h: 22 },
      { t: 'box', x: 43, w: 7, h: 30 },
      { t: 'box', x: 51, w: 5, h: 18 },
      { t: 'box', x: 57, w: 6, h: 13 },
      { t: 'tower', x: 66, w: 3, h: 24 },
      { t: 'tower', x: 86, w: 3, h: 24 },
      { t: 'box', x: 92, w: 6, h: 6 },
    ],
  },
];

export const cityById = (id: string | null | undefined) => CITIES.find((c) => c.id === id) ?? null;
