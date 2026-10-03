// The basemap, written from scratch on OpenFreeMap's OpenMapTiles vector tiles. It should read as
// a real Raleigh street map (DESIGN.md "Map"), drawn in our inks. No sprite is loaded, so no POI
// icon can ever appear.
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { Tokens } from '../tokens';

const TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

const REGULAR = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];
const ITALIC = ['Noto Sans Italic'];

const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
const isClass = (classes: string[]): ExpressionSpecification => ['match', ['get', 'class'], classes, true, false];
const roadClass = (classes: string[]): ExpressionSpecification => ['all', notTunnel, isClass(classes)];

/** Width by zoom: `stops` is [zoom, px, zoom, px, ...]. */
const width = (...stops: number[]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], ...stops] as ExpressionSpecification;

const MINOR = ['minor', 'service'];
const MAJOR = ['primary', 'secondary', 'tertiary', 'trunk'];

export function basemapStyle({ hex }: Tokens): StyleSpecification {
  const label = { 'text-color': hex.ink, 'text-halo-color': hex.chalk, 'text-halo-width': 1.5 };

  /** A street drawn as a bond fill inside a thin ink casing, like a printed street map. */
  const street = (id: string, classes: string[], minzoom: number, casing: number[], fill: number[], inkOpacity: number) =>
    [
      {
        id: `${id}-casing`,
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom,
        filter: roadClass(classes),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': hex.ink, 'line-opacity': inkOpacity, 'line-width': width(...casing) },
      },
      {
        id,
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom,
        filter: roadClass(classes),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': hex.bond, 'line-width': width(...fill) },
      },
    ] satisfies LayerSpecification[];

  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { omt: { type: 'vector', url: TILES, attribution: ATTRIBUTION } },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': hex.chalk } },
      {
        id: 'woods',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: isClass(['wood', 'grass']),
        paint: { 'fill-color': hex.safe, 'fill-opacity': 0.1 },
      },
      {
        id: 'parks',
        type: 'fill',
        source: 'omt',
        'source-layer': 'park',
        paint: { 'fill-color': hex.safe, 'fill-opacity': 0.16 },
      },
      {
        id: 'grounds',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        filter: isClass(['cemetery', 'pitch', 'playground', 'stadium']),
        paint: { 'fill-color': hex.safe, 'fill-opacity': 0.1 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'omt',
        'source-layer': 'water',
        filter: notTunnel,
        paint: { 'fill-color': hex.flood, 'fill-opacity': 0.35 },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'omt',
        'source-layer': 'waterway',
        filter: notTunnel,
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': hex.flood, 'line-opacity': 0.7, 'line-width': width(11, 0.8, 17, 4) },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'omt',
        'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': hex.ink, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.07, 16, 0.1] },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: roadClass(['rail', 'transit']),
        paint: {
          'line-color': hex.ink,
          'line-opacity': 0.6,
          'line-width': width(11, 0.6, 17, 1.6),
          'line-dasharray': [3, 2],
        },
      },
      ...street('roads-minor', MINOR, 13, [13, 0.8, 17, 9], [13, 0.4, 17, 7.5], 0.3),
      ...street('roads-major', MAJOR, 10, [10, 1, 17, 14], [10, 0.4, 17, 11.5], 0.55),
      // Motorways are wider streets with a heavier casing; solid ink made interchanges into blots.
      ...street('roads-motorway', ['motorway'], 8, [8, 1.2, 17, 18], [8, 0.4, 17, 14], 0.75),
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
    ],
  };
}
