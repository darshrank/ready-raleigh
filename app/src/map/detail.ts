// Semantic zoom (DESIGN.md "Map", "Detail by zoom"): real places appear as the player zooms in, so
// placing a shelter or a bus pickup feels like choosing a real place. The city view stays as clean
// as before: every layer here has a minzoom at or above 14.
//
// All of it is part of the basemap style, painted from the same palette as the streets, so the
// storm re-paints it with the night colors (basemap.ts applyPalette). Icons are signed distance
// fields drawn on a canvas (there is no sprite), so their color is a paint property too.
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
  SourceSpecification,
} from 'maplibre-gl';
import type { FeatureCollection, MultiPolygon, Point, Position } from 'geojson';
import { loadMapData } from '../data';
import { cityById } from '../cities';
import { useMapUi } from '../store';
import { currentCityId, dataBase } from '../story';
import type { Palette } from './basemap';
import { TILT_3D } from './flood';
import { REALISM } from '../world/state';

const REGULAR = ['Noto Sans Regular'];

/** Places show from this zoom; their names from PLACE_NAME_ZOOM. */
export const PLACE_ZOOM = 14;
export const PLACE_NAME_ZOOM = 15;
/** House numbers and building names. */
export const ADDRESS_ZOOM = 16;
/** GoRaleigh bus stops show from this zoom; their names from ADDRESS_ZOOM. */
export const BUS_STOP_ZOOM = 14;

const BUS_STOPS = 'bus-stops';
/** Nursing homes and assisted living (care_homes.json, from OSM): the same zoom rules as places. */
const CARE_HOMES = 'care-homes';

/** Shelter sites draw as their real buildings from this zoom (their squares hide). */
export const SITE_BUILDING_ZOOM = 15;
const SITE_BUILDINGS = 'site-buildings';
const SITE_BUILDINGS_3D = 'site-buildings-3d';
/** A site's extrusion stands this far above the tile building it covers, and its walls this far out. */
const SITE_3D_ABOVE_M = 0.8;

/** Aerial imagery fades in over this zoom range. */
export const AERIAL_ZOOM: [number, number] = [16, 17];
const AERIAL = 'aerial';

const is = (key: string, value: string): ExpressionSpecification => ['==', ['get', key], value];
const among = (key: string, values: string[]): ExpressionSpecification => ['match', ['get', key], values, true, false];

/**
 * Planning-relevant places from the tiles' `poi` layer (OpenMapTiles class / subclass): schools,
 * hospitals and clinics, places of worship, community centers, libraries, grocery stores, fire and
 * police stations. No restaurants or shops. `library/books` is a bookshop and `grocery` also holds
 * department stores and delis, so those match on subclass.
 */
export const PLACES_FILTER: ExpressionSpecification = [
  'any',
  among('class', ['school', 'college', 'place_of_worship', 'fire_station', 'police']),
  ['all', is('class', 'hospital'), among('subclass', ['hospital', 'clinic'])],
  ['all', is('class', 'town_hall'), is('subclass', 'community_centre')],
  ['all', is('class', 'library'), is('subclass', 'library')],
  ['all', is('class', 'grocery'), among('subclass', ['supermarket', 'greengrocer', 'marketplace'])],
];

/**
 * Building names. The tiles' `building` layer has no names, so these are the named `poi` features
 * that are mostly buildings and are not businesses: state and city buildings, courthouses,
 * campus offices, dormitories, museums, visitor offices. College buildings are already places.
 */
export const BUILDING_NAMES_FILTER: ExpressionSpecification = [
  'all',
  ['has', 'name'],
  [
    'any',
    ['all', is('class', 'town_hall'), among('subclass', ['townhall', 'courthouse', 'public_building'])],
    ['all', is('class', 'office'), among('subclass', ['government', 'educational_institution'])],
    ['all', is('class', 'lodging'), is('subclass', 'dormitory')],
    ['all', is('class', 'information'), is('subclass', 'office')],
    is('class', 'museum'),
  ],
];

// ---------------------------------------------------------------------------------------------
// Icons: a small ink badge with a pictogram knocked out of it, stored as a signed distance field.

/** Badge size in image px (pixelRatio 2, so 16 css px) and the distance field's reach. */
const ICON = 32;
const SDF_R = 8;

type Draw = (g: CanvasRenderingContext2D) => void;

const disc: Draw = (g) => {
  g.beginPath();
  g.arc(ICON / 2, ICON / 2, ICON / 2 - 0.5, 0, Math.PI * 2);
  g.fill();
};

/** Badge shape, then the pictogram cut out of it (`cut`), then any parts drawn back in (`keep`). */
const badge = (shape: Draw, cut: Draw, keep?: Draw): Draw => (g) => {
  shape(g);
  g.globalCompositeOperation = 'destination-out';
  cut(g);
  g.globalCompositeOperation = 'source-over';
  keep?.(g);
};

const square: Draw = (g) => {
  g.beginPath();
  g.roundRect(1, 1, ICON - 2, ICON - 2, 7);
  g.fill();
};

const path = (g: CanvasRenderingContext2D, pts: number[]) => {
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k]!, pts[k + 1]!);
  g.closePath();
  g.fill();
};

const star = (g: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
  const pts: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  path(g, pts);
};

/** Pictograms, drawn in a 32 px box. */
export const PLACE_ICONS: Record<string, Draw> = {
  // Mortarboard.
  'place-school': badge(disc, (g) => {
    path(g, [16, 7, 28, 13, 16, 19, 4, 13]);
    g.fillRect(10, 15, 12, 7);
  }),
  // Cross.
  'place-health': badge(disc, (g) => {
    g.fillRect(13, 6, 6, 20);
    g.fillRect(6, 13, 20, 6);
  }),
  // Chapel with a door.
  'place-worship': badge(
    disc,
    (g) => path(g, [16, 5, 24, 13, 24, 26, 8, 26, 8, 13]),
    (g) => g.fillRect(14, 19, 4, 7),
  ),
  // Two people.
  'place-community': badge(disc, (g) => {
    for (const x of [11, 21]) {
      g.beginPath();
      g.arc(x, 11, 3.6, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.roundRect(x - 5, 16, 10, 10, 4);
      g.fill();
    }
  }),
  // Open book.
  'place-library': badge(disc, (g) => {
    path(g, [5, 9, 15, 11.5, 15, 25, 5, 22.5]);
    path(g, [17, 11.5, 27, 9, 27, 22.5, 17, 25]);
  }),
  // Basket with a handle.
  'place-grocery': badge(disc, (g) => {
    path(g, [6, 14, 26, 14, 23, 25, 9, 25]);
    g.lineWidth = 2.6;
    g.beginPath();
    g.arc(16, 14, 6, Math.PI, 0);
    g.stroke();
  }),
  // Flame.
  'place-fire': badge(disc, (g) => {
    g.beginPath();
    g.moveTo(16, 5);
    g.bezierCurveTo(19, 10, 24, 13, 24, 19);
    g.arc(16, 19, 8, 0, Math.PI);
    g.bezierCurveTo(8, 14, 12, 12, 13, 9);
    g.quadraticCurveTo(15, 12, 16, 5);
    g.fill();
  }),
  // Star badge.
  'place-police': badge(disc, (g) => star(g, 16, 17, 11)),
  // House with a heart: nursing homes and assisted living.
  'place-care': badge(
    disc,
    (g) => path(g, [16, 5, 27, 14, 27, 26, 5, 26, 5, 14]),
    (g) => {
      g.beginPath();
      g.moveTo(16, 24);
      g.bezierCurveTo(9.5, 19.5, 10.5, 13.5, 16, 16.5);
      g.bezierCurveTo(21.5, 13.5, 22.5, 19.5, 16, 24);
      g.fill();
    },
  ),
};

/** A bus stop: a rounded square (places are round) with the front of a bus. */
const BUS_ICON: Record<string, Draw> = {
  'bus-stop': badge(
    square,
    (g) => {
      g.beginPath();
      g.roundRect(8, 5, 16, 19, 3);
      g.fill();
      g.fillRect(10, 23, 4, 4);
      g.fillRect(18, 23, 4, 4);
    },
    (g) => {
      g.fillRect(10.5, 8, 11, 7);
      g.fillRect(10, 18.5, 3, 2.5);
      g.fillRect(19, 18.5, 3, 2.5);
    },
  ),
};

const PLACE_ICON_BY_CLASS: ExpressionSpecification = [
  'match',
  ['get', 'class'],
  ['school', 'college'],
  'place-school',
  'hospital',
  'place-health',
  'place_of_worship',
  'place-worship',
  'town_hall',
  'place-community',
  'library',
  'place-library',
  'grocery',
  'place-grocery',
  'fire_station',
  'place-fire',
  'police',
  'place-police',
  'place-community',
];

/**
 * A signed distance field of `draw` (alpha = distance, 0.75 on the edge), the encoding MapLibre
 * expects for `sdf: true` images: tiny-sdf's, with a radius of SDF_R image px.
 */
function sdfImage(draw: Draw, size = ICON): ImageData {
  const W = size + 2 * SDF_R;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = W;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.translate(SDF_R, SDF_R);
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  draw(g);
  const src = g.getImageData(0, 0, W, W).data;
  const alpha = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) alpha[i] = src[i * 4 + 3]! / 255;
  const out = new ImageData(W, W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = alpha[i]!;
      const inside = a >= 0.5;
      let best = SDF_R * SDF_R;
      for (let dy = -SDF_R; dy <= SDF_R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= W) continue;
        for (let dx = -SDF_R; dx <= SDF_R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          if (alpha[yy * W + xx]! >= 0.5 === inside) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
        }
      }
      // Positive outside. An antialiased edge pixel's coverage says how far the edge is; elsewhere
      // the edge lies halfway to the nearest pixel on the other side.
      const signed = a > 0 && a < 1 ? 0.5 - a : (inside ? -1 : 1) * (Math.sqrt(best) - 0.5);
      const v = 255 - 255 * (signed / SDF_R + 0.25);
      out.data[i * 4] = 255;
      out.data[i * 4 + 1] = 255;
      out.data[i * 4 + 2] = 255;
      out.data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(v)));
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sources and layers.

/**
 * The detail files built for Raleigh only: GoRaleigh's stops, and OSM care homes and site
 * footprints in Raleigh's box. Other cities (story.ts) skip them; places, addresses and the 3D city
 * come from the OpenFreeMap tiles and work everywhere.
 */
const raleighData = () => currentCityId() === 'raleigh';

/** NC OneMap's imagery covers North Carolina only. */
const aerialCovers = () => cityById(currentCityId())?.state === 'North Carolina';

/** The aerial photo shows in North Carolina, unless the Satellite toggle has the whole map's imagery. */
export function setAerial(map: MapLibreMap, satellite: boolean) {
  if (map.getLayer(AERIAL)) map.setLayoutProperty(AERIAL, 'visibility', aerialCovers() && !satellite ? 'visible' : 'none');
}

/** GoRaleigh's GTFS feed (pipeline/bus_stops.py), recorded in meta.json. */
const BUS_ATTRIBUTION = 'Bus stops: <a href="https://goraleigh.org" target="_blank">GoRaleigh GTFS</a>';

/**
 * NC OneMap's statewide orthoimagery (NC Orthoimagery Program, 6 inch, natural color), its Web
 * Mercator tile cache. Terms (nconemap.gov/pages/terms): free and unrestricted use, no release
 * needed; cite NC OneMap / NC Center for Geographic Information and Analysis.
 */
const AERIAL_TILES =
  'https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest_cached/ImageServer/tile/{z}/{y}/{x}';
const AERIAL_ATTRIBUTION =
  'Imagery: <a href="https://www.nconemap.gov" target="_blank">NC OneMap</a>, NC Center for Geographic Information and Analysis';

export function detailSources(): Record<string, SourceSpecification> {
  return {
    // Credits only where the data is used (Raleigh's stops, North Carolina's imagery).
    [BUS_STOPS]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, ...(raleighData() ? { attribution: BUS_ATTRIBUTION } : {}) },
    // OpenStreetMap (pipeline/care_homes.py); OSM is already credited by the tiles.
    [CARE_HOMES]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    // OpenStreetMap footprints (pipeline/site_buildings.py); OSM is already credited by the tiles.
    [SITE_BUILDINGS]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    // minzoom: no tile is ever requested below the zoom where the imagery starts to show.
    [AERIAL]: { type: 'raster', tiles: [AERIAL_TILES], tileSize: 256, minzoom: AERIAL_ZOOM[0], maxzoom: 20, ...(aerialCovers() ? { attribution: AERIAL_ATTRIBUTION } : {}) },
  };
}

/**
 * Aerial imagery from z16, fading in until z17: above the land, green and water fills, below the
 * buildings, streets and water, so the printed street map stays on top of the photo. Toned per
 * mood: a little washed out by day so the inks read; dark and grey at night.
 */
export function aerialLayer(P: Palette): LayerSpecification {
  return {
    id: AERIAL,
    type: 'raster',
    source: AERIAL,
    minzoom: AERIAL_ZOOM[0],
    // Hidden outside North Carolina: no tile is requested for a hidden layer.
    layout: { visibility: aerialCovers() ? 'visible' : 'none' },
    paint: {
      'raster-opacity': ['interpolate', ['linear'], ['zoom'], AERIAL_ZOOM[0], 0, AERIAL_ZOOM[1], P.aerial.opacity],
      'raster-saturation': P.aerial.saturation,
      'raster-contrast': P.aerial.contrast,
      'raster-brightness-min': P.aerial.brightnessMin,
      'raster-brightness-max': P.aerial.brightnessMax,
      'raster-fade-duration': 200,
    },
  };
}

const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];

/**
 * Shelter sites as their real buildings (z15+), just above the other building footprints: a bold
 * printed fill inside an ink outline, hollow when the building floods (like the hollow square).
 * The fill is also the hover / tap target for the site card, so flooded ones keep it at opacity 0.
 */
export function siteBuildingLayers(P: Palette): LayerSpecification[] {
  return [
    {
      id: SITE_BUILDINGS,
      type: 'fill',
      source: SITE_BUILDINGS,
      minzoom: SITE_BUILDING_ZOOM,
      // Targets: shown only while a shelter is armed (installDetail follows useMapUi.siteTargets).
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['case', hovered, P.siteHover, P.siteFill],
        'fill-opacity': ['case', hovered, 1, ['get', 'floods'], 0, 1],
      },
    },
    {
      id: `${SITE_BUILDINGS}-line`,
      type: 'line',
      source: SITE_BUILDINGS,
      minzoom: SITE_BUILDING_ZOOM,
      layout: { 'line-join': 'round', visibility: 'none' },
      paint: {
        'line-color': P.siteLine,
        'line-width': ['interpolate', ['linear'], ['zoom'], SITE_BUILDING_ZOOM, 1.5, 18, 3],
      },
    },
  ];
}

/**
 * 3D (camera tilted): the shelter site's building in the site color, drawn right after the tiles'
 * 3D buildings. Its height comes from the tile building under it (feature-state `height`, set in
 * installDetail) plus SITE_3D_ABOVE_M, and the footprint is pushed out by about as much, so the
 * site's walls and roof cover the tile building's. In the storm both colors are the night
 * building color, so sites stay hidden there (DESIGN.md "Map").
 */
export function siteBuilding3dLayer(P: Palette): LayerSpecification {
  return {
    id: SITE_BUILDINGS_3D,
    type: 'fill-extrusion',
    source: SITE_BUILDINGS,
    minzoom: 13,
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': ['case', ['get', 'floods'], P.site3dFloods, P.site3d],
      'fill-extrusion-height': ['+', ['coalesce', ['feature-state', 'height'], 8], SITE_3D_ABOVE_M],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.92,
    },
  };
}

/**
 * Detail labels, in draw order: house numbers (z16+, the lowest priority), building names (z16+),
 * places (z14+, names z15+). They go among the labels, below street and place names, so those win
 * any collision.
 */
export function detailLabelLayers(P: Palette): LayerSpecification[] {
  return [
    {
      id: 'addresses',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'housenumber',
      minzoom: ADDRESS_ZOOM,
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-font': REGULAR,
        'text-size': ['interpolate', ['linear'], ['zoom'], ADDRESS_ZOOM, 9.5, 18, 11],
        'text-padding': 1,
      },
      paint: { 'text-color': P.address, 'text-halo-color': P.halo, 'text-halo-width': 1 },
    },
    {
      id: 'building-names',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'poi',
      minzoom: ADDRESS_ZOOM,
      filter: BUILDING_NAMES_FILTER,
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': REGULAR,
        'text-size': 10.5,
        'text-max-width': 8,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': P.placeLabel, 'text-halo-color': P.halo, 'text-halo-width': 1.5 },
    },
    {
      id: BUS_STOPS,
      type: 'symbol',
      source: BUS_STOPS,
      minzoom: BUS_STOP_ZOOM,
      layout: {
        'icon-image': 'bus-stop',
        'icon-size': ['interpolate', ['linear'], ['zoom'], BUS_STOP_ZOOM, 0.75, 17, 1],
        'icon-padding': 1,
        'text-field': ['step', ['zoom'], '', ADDRESS_ZOOM, ['get', 'name']],
        'text-font': REGULAR,
        'text-size': 10,
        'text-max-width': 8,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.9,
        'text-justify': 'auto',
        'text-optional': true,
      },
      paint: {
        'icon-color': P.busIcon,
        'icon-halo-color': P.halo,
        'icon-halo-width': 1.2,
        'text-color': P.placeLabel,
        'text-halo-color': P.halo,
        'text-halo-width': 1.5,
      },
    },
    {
      id: CARE_HOMES,
      type: 'symbol',
      source: CARE_HOMES,
      minzoom: PLACE_ZOOM,
      layout: {
        'icon-image': 'place-care',
        'icon-size': ['interpolate', ['linear'], ['zoom'], PLACE_ZOOM, 0.85, 17, 1.1],
        'icon-padding': 2,
        'text-field': ['step', ['zoom'], '', PLACE_NAME_ZOOM, ['coalesce', ['get', 'name'], '']],
        'text-font': REGULAR,
        'text-size': 11,
        'text-max-width': 9,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.95,
        'text-justify': 'auto',
        'text-optional': true,
      },
      paint: {
        'icon-color': P.placeIcon,
        'icon-halo-color': P.halo,
        'icon-halo-width': 1.2,
        'text-color': P.placeLabel,
        'text-halo-color': P.halo,
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'places',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'poi',
      minzoom: PLACE_ZOOM,
      filter: PLACES_FILTER,
      layout: {
        'icon-image': PLACE_ICON_BY_CLASS,
        'icon-size': ['interpolate', ['linear'], ['zoom'], PLACE_ZOOM, 0.85, 17, 1.1],
        'icon-padding': 2,
        'text-field': ['step', ['zoom'], '', PLACE_NAME_ZOOM, ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
        'text-font': REGULAR,
        'text-size': 11,
        'text-max-width': 9,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.95,
        'text-justify': 'auto',
        'text-optional': true,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: {
        'icon-color': P.placeIcon,
        'icon-halo-color': P.halo,
        'icon-halo-width': 1.2,
        'text-color': P.placeLabel,
        'text-halo-color': P.halo,
        'text-halo-width': 1.5,
      },
    },
  ];
}

/** A matched site's footprint, from pipeline/site_buildings.py. */
export interface SiteBuilding {
  id: string;
  match: 'contains' | 'self' | 'grounds';
  osm: string;
  polygons: number[][][][];
}

const siteBuildings = new Map<string, Promise<SiteBuilding[]>>();
/**
 * site_buildings.json, fetched once per city per page load (the map and the site squares both need
 * it). Raleigh only: elsewhere every site keeps its square.
 */
export function loadSiteBuildings(): Promise<SiteBuilding[]> {
  const city = currentCityId();
  let p = siteBuildings.get(city);
  if (!p) siteBuildings.set(city, (p = raleighData() ? getJson<SiteBuilding[]>('site_buildings.json') : Promise.resolve([])));
  return p;
}

/** What the site card shows: the building under the pointer, where it is on screen. */
export interface SiteCardInfo {
  name: string;
  kind: string;
  floodStep: number | null;
  x: number;
  y: number;
}

/** Site 3D buildings get their height from the tiles from this zoom (3D buildings start at 13). */
const SITE_3D_ZOOM = 14;

interface Footprint {
  /** The feature's id in the site-buildings source. */
  fid: number;
  floods: boolean;
  polys: number[][][][];
  bbox: [number, number, number, number];
  /** The tile building's render_height, once found. */
  height?: number;
}

/**
 * The footprint grown by about `m` meters (scaled about its middle; holes shrink), so the site's 3D
 * walls stand just in front of the tile building's instead of on the same plane. Under a meter,
 * so the flat outline barely moves.
 */
function pushOut(polys: number[][][][], m: number): number[][][][] {
  return polys.map((poly) => {
    const c = middle(poly[0]!);
    const kx = 111_320 * Math.cos((c[1] * Math.PI) / 180);
    const outer = poly[0]!;
    const r = outer.reduce((sum, p) => sum + Math.hypot((p[0]! - c[0]) * kx, (p[1]! - c[1]) * 111_320), 0) / outer.length;
    const k = 1 + m / Math.max(r, 3);
    return poly.map((ring, i) => {
      const f = i === 0 ? k : 1 / k;
      return ring.map((p) => [c[0] + (p[0]! - c[0]) * f, c[1] + (p[1]! - c[1]) * f]);
    });
  });
}

/** Points a little inside the footprint's corners: one of them lies on the building (U shapes too). */
function probes(polys: number[][][][]): [number, number][] {
  const ring = polys[0]![0]!;
  const c = middle(ring);
  const step = Math.max(1, Math.floor((ring.length - 1) / 6));
  const out: [number, number][] = [c];
  for (let k = 0; k < ring.length - 1; k += step) out.push([ring[k]![0]! + (c[0] - ring[k]![0]!) * 0.04, ring[k]![1]! + (c[1] - ring[k]![1]!) * 0.04]);
  return out;
}

function bboxOf(polys: number[][][][]): Footprint['bbox'] {
  const b: Footprint['bbox'] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polys)
    for (const [x, y] of poly[0]!) {
      b[0] = Math.min(b[0], x!); b[1] = Math.min(b[1], y!);
      b[2] = Math.max(b[2], x!); b[3] = Math.max(b[3], y!);
    }
  return b;
}

const inBbox = (b: Footprint['bbox'], [x, y]: [number, number]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

function inRing(ring: number[][] | Position[], [x, y]: [number, number]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

/** Inside an outer ring and outside its holes (GeoJSON MultiPolygon coordinates). */
const inPolygons = (polys: number[][][][], p: [number, number]) =>
  polys.some((poly) => inRing(poly[0]!, p) && !poly.slice(1).some((hole) => inRing(hole, p)));

/** The average of a ring's corners: inside any building that is not strongly concave. */
function middle(ring: Position[]): [number, number] {
  let x = 0;
  let y = 0;
  const n = ring.length - 1;
  for (let k = 0; k < n; k++) {
    x += ring[k]![0]!;
    y += ring[k]![1]!;
  }
  return [x / n, y / n];
}

interface CareHome {
  id: string;
  name: string | null;
  kind: 'nursing_home' | 'assisted_living';
  lat: number;
  lon: number;
}

interface BusStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Fill a GeoJSON source of the style once both the data and the style are there. */
function fill(map: MapLibreMap, id: string, data: FeatureCollection) {
  const set = () => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  if (map.getSource(id)) set();
  else map.once('load', set);
}

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${dataBase()}/${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return (await res.json()) as T;
}

/** A shelter site's building for the deck.gl city (world/sites.ts): pushed-out footprint and height. */
export interface SiteSolid {
  polygon: number[][][];
  /** Top of the site building: the tile building's height under it (8 m until found) + 0.8 m. */
  height: number;
  floods: boolean;
}
let solids: SiteSolid[] = [];
const solidListeners = new Set<(s: SiteSolid[]) => void>();
function publishSolids(footprints: Footprint[]) {
  solids = footprints.flatMap((f) =>
    f.polys.map((polygon) => ({ polygon, height: (f.height ?? 8) + SITE_3D_ABOVE_M, floods: f.floods })),
  );
  for (const cb of solidListeners) cb(solids);
}
/** The site buildings as their heights are found (called now, then on each change). */
export function onSiteSolids(cb: (s: SiteSolid[]) => void): () => void {
  solidListeners.add(cb);
  cb(solids);
  return () => solidListeners.delete(cb);
}

/** GoRaleigh's stops and the care homes (Raleigh's files) into their sources. */
function loadRaleighPoints(map: MapLibreMap, live: () => boolean) {
  getJson<BusStop[]>('bus_stops.json').then(
    (stops) => {
      if (!live()) return;
      const fc: FeatureCollection<Point, { name: string }> = {
        type: 'FeatureCollection',
        features: stops.map((s, i) => ({ type: 'Feature', id: i, properties: { name: s.name }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })),
      };
      fill(map, BUS_STOPS, fc);
    },
    (e: unknown) => console.warn('Bus stops did not load:', e),
  );

  getJson<CareHome[]>('care_homes.json').then(
    (homes) => {
      if (!live()) return;
      fill(map, CARE_HOMES, {
        type: 'FeatureCollection',
        features: homes.map((h, i) => ({ type: 'Feature', id: i, properties: { name: h.name, kind: h.kind }, geometry: { type: 'Point', coordinates: [h.lon, h.lat] } })),
      });
    },
    (e: unknown) => console.warn('Care homes did not load:', e),
  );
}

/**
 * Adds the detail icons to `map` (now, and again if the style ever asks for one it lacks) and loads
 * the detail data files into their sources. A missing file only leaves its layer empty. Returns a
 * cleanup.
 */
export function installDetail(map: MapLibreMap, onSite: (card: SiteCardInfo | null) => void): () => void {
  let live = true;
  Promise.all([loadSiteBuildings(), loadMapData()]).then(
    ([buildings, data]) => {
      if (!live) return;
      const sites = new Map(data.sites.map((s) => [s.id, s]));
      const fc: FeatureCollection<MultiPolygon> = { type: 'FeatureCollection', features: [] };
      buildings.forEach((b, i) => {
        const s = sites.get(b.id);
        // Only sites that stay dry are shelter targets (a shelter in a building that floods helps no one).
        if (!s || (s.floodStep !== null && s.floodStep <= 3)) return;
        fc.features.push({
          type: 'Feature',
          id: i,
          properties: { name: s.name, kind: s.kind, floodStep: s.floodStep, floods: s.floodStep !== null },
          geometry: { type: 'MultiPolygon', coordinates: pushOut(b.polygons, SITE_3D_ABOVE_M) },
        });
      });
      fill(map, SITE_BUILDINGS, fc);
      footprints = fc.features.map((f) => ({
        fid: f.id as number,
        floods: !!f.properties?.floods,
        polys: f.geometry.coordinates,
        bbox: bboxOf(f.geometry.coordinates),
      }));
      publish();
      markSoon(0);
    },
    (e: unknown) => console.warn('Site buildings did not load:', e),
  );

  // The site card: hover with a mouse, tap on a phone. Tapping anywhere else closes it.
  let hover: string | number | null = null;
  const setHover = (id: string | number | null) => {
    if (id === hover) return;
    if (hover !== null) map.setFeatureState({ source: SITE_BUILDINGS, id: hover }, { hover: false });
    hover = id;
    if (id !== null) map.setFeatureState({ source: SITE_BUILDINGS, id }, { hover: true });
  };
  const show = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f || f.id === undefined) return;
    setHover(f.id);
    const p = f.properties as { name: string; kind: string; floodStep?: number | null };
    onSite({ name: p.name, kind: p.kind, floodStep: p.floodStep ?? null, x: e.point.x, y: e.point.y });
  };
  const hide = () => {
    setHover(null);
    onSite(null);
  };
  const onMapClick = (e: MapMouseEvent) => {
    if (!map.getLayer(SITE_BUILDINGS) || !map.queryRenderedFeatures(e.point, { layers: [SITE_BUILDINGS] }).length) hide();
  };
  map.on('mousemove', SITE_BUILDINGS, show);
  map.on('click', SITE_BUILDINGS, show);
  map.on('mouseleave', SITE_BUILDINGS, hide);
  map.on('click', onMapClick);
  map.on('zoomstart', hide);

  // 3D: the tiles merge many buildings into one feature (a MultiPolygon per height group), so a
  // site's building can't be colored on its own there. Instead the site's footprint is extruded
  // in the site color (siteBuilding3dLayer) to the height of the tile building under it, read
  // here once per site as its tile loads with the 3D layer on.
  let footprints: Footprint[] = [];
  let markTimer = 0;
  const mark = () => {
    const on = map.getPitch() > TILT_3D;
    // With the realistic city (world/), deck.gl draws the site buildings (onSiteSolids).
    const targets = useMapUi.getState().siteTargets;
    if (map.getLayer(SITE_BUILDINGS_3D)) map.setLayoutProperty(SITE_BUILDINGS_3D, 'visibility', on && targets && !REALISM ? 'visible' : 'none');
    if (!on || map.getZoom() < SITE_3D_ZOOM) return;
    const view = map.getBounds();
    const todo = footprints.filter((s) => s.height === undefined && view.intersects([[s.bbox[0], s.bbox[1]], [s.bbox[2], s.bbox[3]]]));
    if (!todo.length) return;
    const parts: { bbox: Footprint['bbox']; ring: Position[]; height: number }[] = [];
    for (const f of map.querySourceFeatures('omt', { sourceLayer: 'building' })) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      const height = Number(f.properties?.render_height ?? 0);
      for (const poly of polys) if (poly[0] && poly[0].length >= 4) parts.push({ bbox: bboxOf([poly as number[][][]]), ring: poly[0], height });
    }
    let found = false;
    for (const s of todo) {
      const hit = probes(s.polys).map((p) => parts.find((q) => inBbox(q.bbox, p) && inRing(q.ring, p))).find(Boolean);
      if (!hit) continue;
      s.height = hit.height;
      found = true;
      if (REALISM) continue;
      map.setFeatureState({ source: SITE_BUILDINGS, id: s.fid }, { height: hit.height });
    }
    if (found) publish();
  };
  const markSoon = (ms: number) => {
    clearTimeout(markTimer);
    markTimer = window.setTimeout(mark, ms);
  };
  const onTiles = (e: { sourceId?: string; tile?: unknown }) => {
    if (e.sourceId === 'omt' && e.tile && map.getPitch() > TILT_3D) markSoon(300);
  };
  const onMoveEnd = () => markSoon(50);
  map.on('sourcedata', onTiles);
  map.on('moveend', onMoveEnd);

  // Planning targets come and go with the armed piece: the site buildings (2D and 3D) show while a
  // shelter is armed; the GoRaleigh stops step aside while the bus stop targets show.
  const publish = () => publishSolids(useMapUi.getState().siteTargets ? footprints : []);
  const applyTargets = () => {
    const { siteTargets, stopTargets } = useMapUi.getState();
    for (const id of [SITE_BUILDINGS, `${SITE_BUILDINGS}-line`]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', siteTargets ? 'visible' : 'none');
    if (map.getLayer(BUS_STOPS)) map.setLayoutProperty(BUS_STOPS, 'visibility', stopTargets ? 'none' : 'visible');
    if (!siteTargets) hide();
    publish();
    markSoon(0);
  };
  const stopTargets = useMapUi.subscribe((s, prev) => {
    if (s.siteTargets !== prev.siteTargets || s.stopTargets !== prev.stopTargets) applyTargets();
  });
  if (map.isStyleLoaded()) applyTargets();
  else map.once('load', applyTargets);

  if (raleighData()) loadRaleighPoints(map, () => live);

  const icons: Record<string, Draw> = { ...PLACE_ICONS, ...BUS_ICON };
  const add = (id: string) => {
    const draw = icons[id];
    if (draw && !map.hasImage(id)) map.addImage(id, sdfImage(draw), { sdf: true, pixelRatio: 2 });
  };
  const onMissing = (e: { id: string }) => add(e.id);
  map.on('styleimagemissing', onMissing);
  for (const id of Object.keys(icons)) add(id);
  return () => {
    live = false;
    map.off('styleimagemissing', onMissing);
    map.off('mousemove', SITE_BUILDINGS, show);
    map.off('click', SITE_BUILDINGS, show);
    map.off('mouseleave', SITE_BUILDINGS, hide);
    map.off('click', onMapClick);
    map.off('zoomstart', hide);
    map.off('sourcedata', onTiles);
    map.off('moveend', onMoveEnd);
    map.off('load', applyTargets);
    stopTargets();
    clearTimeout(markTimer);
  };
}
