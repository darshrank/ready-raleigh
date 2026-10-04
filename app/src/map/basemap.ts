// The basemap, written from scratch on OpenFreeMap's OpenMapTiles vector tiles. It should read as
// a real Raleigh street map (DESIGN.md "Map"), drawn in our inks. No sprite is loaded, so no POI
// icon can ever appear.
//
// Two moods share one layer list: every layer's paint comes from a palette, so the storm turns the
// city to night by re-applying the same layers with the night palette (paint updates only, no
// relayout). The water (map/flood.ts) is part of the same style, between the streets and the labels.
import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { rgba, tint, type Tokens } from '../tokens';
import { floodFlatLayers, floodSources, flood3dLayers, closuresLayer } from './flood';
import { aerialLayer, detailLabelLayers, detailSources, siteBuilding3dLayer, siteBuildingLayers } from './detail';

export const TILES = 'https://tiles.openfreemap.org/planet';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
/** Satellite imagery (the Satellite toggle): Esri World Imagery, no key, credited while it shows. */
export const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_ATTRIBUTION = 'Imagery <a href="https://www.esri.com" target="_blank">&copy; Esri</a>, Maxar, Earthstar Geographics';

const REGULAR = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];
const ITALIC = ['Noto Sans Italic'];

const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
const isClass = (classes: string[]): ExpressionSpecification => ['match', ['get', 'class'], classes, true, false];
const roadClass = (classes: string[]): ExpressionSpecification => ['all', notTunnel, isClass(classes)];

/** Width by zoom: `stops` is [zoom, px, zoom, px, ...]. */
export const width = (...stops: number[]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], ...stops] as ExpressionSpecification;

const MINOR = ['minor', 'service'];
const MAJOR = ['primary', 'secondary', 'tertiary', 'trunk'];

export type Mood = 'day' | 'storm';

/** Every color the basemap uses, per mood. */
export interface Palette {
  land: string;
  green: string;
  wood: number;
  park: number;
  river: string;
  waterway: string;
  building: string;
  building3d: string;
  /** 3D: a shelter site's building (map/detail.ts), dry or flooding. */
  site3d: string;
  site3dFloods: string;
  rail: string;
  casing: string;
  /** Casing opacity for minor, major and motorway streets (0 at night: streets are faint lines). */
  casingOpacity: [number, number, number];
  street: string;
  major: string;
  motorway: string;
  label: string;
  halo: string;
  /** The satellite imagery: full daylight, or dimmed and greyed for the night. */
  imagery: { brightness: number; saturation: number };
  /** Places (map/detail.ts): the badge and the name. */
  placeIcon: string;
  placeLabel: string;
  /** House numbers. */
  address: string;
  /** GoRaleigh bus stop badges. */
  busIcon: string;
  /** Shelter sites as buildings (z15+): fill, fill under the pointer, outline. */
  siteFill: string;
  siteHover: string;
  siteLine: string;
  /** Aerial imagery from z16 (map/detail.ts): full opacity at z17 and the photo's tone. */
  aerial: { opacity: number; saturation: number; contrast: number; brightnessMin: number; brightnessMax: number };
}

/**
 * The palette for `mood`. With `satellite`, the imagery is the land: the printed fills (green,
 * building footprints) go clear and the streets are faint lines over the photo, so the water,
 * the pieces and the names stay what you read.
 */
export function palette(mood: Mood, tokens: Tokens, satellite = false): Palette {
  const P = basePalette(mood, tokens);
  if (!satellite) return P;
  const { rgb } = tokens;
  const line = mood === 'storm' ? rgb['storm-label'] : rgb.bond;
  return {
    ...P,
    wood: 0,
    park: 0,
    building: rgba(rgb.ink, 0),
    casingOpacity: [0, 0, 0],
    street: rgba(line, mood === 'storm' ? 0.18 : 0.35),
    major: rgba(line, mood === 'storm' ? 0.28 : 0.5),
    motorway: rgba(line, mood === 'storm' ? 0.35 : 0.6),
  };
}

function basePalette(mood: Mood, { hex, rgb }: Tokens): Palette {
  if (mood === 'storm')
    return {
      land: hex['storm-land'],
      green: hex.safe,
      wood: 0.05,
      park: 0.08,
      river: rgba(rgb['storm-water'], 0.45),
      waterway: rgba(rgb['storm-water'], 0.75),
      building: rgba(rgb['storm-street'], 0.85),
      building3d: hex['storm-building'],
      // The storm hides shelter sites (DESIGN.md "Map"): their buildings look like any other.
      site3d: hex['storm-building'],
      site3dFloods: hex['storm-building'],
      rail: rgba(rgb['storm-street'], 1),
      casing: hex['storm-land'],
      casingOpacity: [0, 0, 0],
      street: hex['storm-street'],
      major: hex['storm-street'],
      motorway: rgba(rgb['storm-label'], 0.35),
      label: hex['storm-label'],
      halo: hex['storm-land'],
      imagery: { brightness: 0.42, saturation: -0.4 },
      placeIcon: rgba(rgb['storm-label'], 0.85),
      placeLabel: rgba(rgb['storm-label'], 0.9),
      address: rgba(rgb['storm-label'], 0.6),
      busIcon: rgba(rgb['storm-label'], 0.85),
      siteFill: rgba(rgb['storm-label'], 0.14),
      siteHover: rgba(rgb['storm-label'], 0.3),
      siteLine: rgba(rgb['storm-label'], 0.55),
      aerial: { opacity: 0.8, saturation: -0.6, contrast: -0.1, brightnessMin: 0, brightnessMax: 0.38 },
    };
  return {
    land: hex.chalk,
    green: hex.safe,
    wood: 0.1,
    park: 0.16,
    river: rgba(rgb.flood, 0.35),
    waterway: rgba(rgb.flood, 0.7),
    building: rgba(rgb.ink, 0.08),
    building3d: hex.bond,
    site3d: rgba(tint(rgb.bond, rgb.ink, 0.55), 1),
    site3dFloods: rgba(tint(rgb.bond, rgb.ink, 0.2), 1),
    rail: rgba(rgb.ink, 0.6),
    casing: hex.ink,
    casingOpacity: [0.3, 0.55, 0.75],
    street: hex.bond,
    major: hex.bond,
    motorway: hex.bond,
    label: hex.ink,
    halo: hex.chalk,
    imagery: { brightness: 1, saturation: 0 },
    placeIcon: rgba(rgb.ink, 0.85),
    placeLabel: rgba(rgb.ink, 0.85),
    address: rgba(rgb.ink, 0.55),
    busIcon: rgba(rgb.ink, 0.85),
    siteFill: rgba(rgb.ink, 0.3),
    siteHover: rgba(rgb.signal, 0.75),
    siteLine: hex.ink,
    aerial: { opacity: 0.85, saturation: -0.35, contrast: -0.12, brightnessMin: 0.12, brightnessMax: 1 },
  };
}

/** The street map under the water: land, green, rivers, buildings, rail, streets. */
function groundLayers(P: Palette): LayerSpecification[] {
  /** A street drawn as a fill inside a thin casing, like a printed street map. */
  const street = (id: string, classes: string[], minzoom: number, casing: number[], fill: number[], c: number, color: string) =>
    [
      {
        id: `${id}-casing`,
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom,
        filter: roadClass(classes),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': P.casing, 'line-opacity': P.casingOpacity[c]!, 'line-width': width(...casing) },
      },
      {
        id,
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom,
        filter: roadClass(classes),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': width(...fill) },
      },
    ] satisfies LayerSpecification[];

  return [
    { id: 'land', type: 'background', paint: { 'background-color': P.land } },
    {
      id: 'woods',
      type: 'fill',
      source: 'omt',
      'source-layer': 'landcover',
      filter: isClass(['wood', 'grass']),
      paint: { 'fill-color': P.green, 'fill-opacity': P.wood },
    },
    {
      id: 'parks',
      type: 'fill',
      source: 'omt',
      'source-layer': 'park',
      paint: { 'fill-color': P.green, 'fill-opacity': P.park },
    },
    {
      id: 'grounds',
      type: 'fill',
      source: 'omt',
      'source-layer': 'landuse',
      filter: isClass(['cemetery', 'pitch', 'playground', 'stadium']),
      paint: { 'fill-color': P.green, 'fill-opacity': P.wood },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'omt',
      'source-layer': 'water',
      filter: notTunnel,
      paint: { 'fill-color': P.river },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'omt',
      'source-layer': 'waterway',
      filter: notTunnel,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': P.waterway, 'line-width': width(11, 0.8, 17, 4) },
    },
    // Satellite imagery covers the printed land and water when the toggle is on (applyPalette).
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      layout: { visibility: 'none' },
      paint: { 'raster-brightness-max': P.imagery.brightness, 'raster-saturation': P.imagery.saturation, 'raster-fade-duration': 150 },
    },
    aerialLayer(P),
    {
      id: 'buildings',
      type: 'fill',
      source: 'omt',
      'source-layer': 'building',
      minzoom: 13,
      paint: { 'fill-color': P.building },
    },
    ...siteBuildingLayers(P),
    {
      id: 'rail',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      minzoom: 11,
      filter: roadClass(['rail', 'transit']),
      paint: { 'line-color': P.rail, 'line-width': width(11, 0.6, 17, 1.6), 'line-dasharray': [3, 2] },
    },
    ...street('roads-minor', MINOR, 13, [13, 0.8, 17, 9], [13, 0.4, 17, 7.5], 0, P.street),
    ...street('roads-major', MAJOR, 10, [10, 1, 17, 14], [10, 0.4, 17, 11.5], 1, P.major),
    // Motorways are wider streets with a heavier casing; solid ink made interchanges into blots.
    ...street('roads-motorway', ['motorway'], 8, [8, 1.2, 17, 18], [8, 0.4, 17, 14], 2, P.motorway),
  ];
}

/** 3D buildings from the tiles' heights. Shown only while the camera is tilted (map/flood.ts). */
function buildings3dLayer(P: Palette): LayerSpecification {
  return {
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: 'omt',
    'source-layer': 'building',
    minzoom: 13,
    filter: ['!=', ['get', 'hide_3d'], true],
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': P.building3d,
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.92,
    },
  };
}

function labelLayers(P: Palette): LayerSpecification[] {
  const label = { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.5 };
  return [
    {
      id: 'water-names',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'water_name',
      layout: { 'text-field': ['get', 'name'], 'text-font': ITALIC, 'text-size': 12 },
      paint: label,
    },
    {
      id: 'waterway-names',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'waterway',
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': ITALIC,
        'text-size': 12,
      },
      paint: label,
    },
    // Detail by zoom, below the street and place names so those win any collision.
    ...detailLabelLayers(P),
    {
      id: 'street-names-minor',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'transportation_name',
      minzoom: 15,
      filter: isClass(MINOR),
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': REGULAR,
        'text-size': 11,
      },
      paint: label,
    },
    {
      id: 'street-names-major',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'transportation_name',
      minzoom: 12,
      filter: isClass([...MAJOR, 'motorway']),
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': REGULAR,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 17, 13],
      },
      paint: label,
    },
    {
      id: 'place-names',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'place',
      filter: isClass(['city', 'town', 'suburb', 'neighbourhood', 'quarter']),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': BOLD,
        'text-size': ['match', ['get', 'class'], ['city', 'town'], 15, 13],
        'text-max-width': 8,
      },
      paint: { ...label, 'text-halo-width': 2 },
    },
  ];
}

/** The layers a palette paints, in draw order (without the water, which has its own colors). */
function paletteLayers(P: Palette): LayerSpecification[] {
  return [...groundLayers(P), buildings3dLayer(P), siteBuilding3dLayer(P), ...labelLayers(P)];
}

/**
 * Draw order: the street map, then the water and the submerged streets (above roads and
 * buildings), then 3D buildings and 3D water, then road-closed barriers, then every label on top
 * so names stay readable over the water.
 */
export function basemapStyle(t: Tokens): StyleSpecification {
  const P = palette('day', t);
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      omt: { type: 'vector', url: TILES, attribution: ATTRIBUTION },
      satellite: { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 19, attribution: SATELLITE_ATTRIBUTION },
      ...floodSources(),
      ...detailSources(),
    },
    layers: [
      ...groundLayers(P),
      ...floodFlatLayers(t),
      buildings3dLayer(P),
      siteBuilding3dLayer(P),
      ...flood3dLayers(t),
      closuresLayer(),
      ...labelLayers(P),
    ],
  };
}

/**
 * Re-paint the basemap in `mood`, with or without the satellite imagery, fading over `ms` (0 swaps
 * at once). MapLibre skips values that did not change.
 */
export function applyPalette(map: MapLibreMap, mood: Mood, t: Tokens, ms: number, satellite = false) {
  map.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none');
  for (const layer of paletteLayers(palette(mood, t, satellite))) {
    if (!('paint' in layer) || !layer.paint) continue;
    for (const [prop, value] of Object.entries(layer.paint)) {
      // Only colors, opacities and the imagery's tone (satellite, aerial photo) change; widths and
      // heights stay.
      if (!/color|opacity|brightness|saturation|contrast/.test(prop)) continue;
      map.setPaintProperty(layer.id, `${prop}-transition`, { duration: ms, delay: 0 });
      map.setPaintProperty(layer.id, prop, value);
    }
  }
}
