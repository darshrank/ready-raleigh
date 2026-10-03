// The basemap, written from scratch on OpenFreeMap's OpenMapTiles vector tiles so it only
// carries what DESIGN.md asks for: chalk land, flood-tinted water, thin ink roads, few labels.
// No sprite is loaded, so no POI icon can ever appear.
import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';
import type { Tokens } from '../tokens';

const TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
const roadClass = (classes: string[]): ExpressionSpecification => [
  'all',
  notTunnel,
  ['match', ['get', 'class'], classes, true, false],
];
/** Line width by zoom, from `lo` px at z12 to `hi` px at z17. */
const width = (lo: number, hi: number): ExpressionSpecification => [
  'interpolate', ['exponential', 1.4], ['zoom'], 12, lo, 17, hi,
];

export function basemapStyle({ hex }: Tokens): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      omt: { type: 'vector', url: TILES, attribution: ATTRIBUTION },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': hex.chalk } },
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
        paint: { 'line-color': hex.flood, 'line-opacity': 0.35, 'line-width': width(0.6, 2.5) },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom: 13,
        filter: roadClass(['minor', 'service']),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': hex.ink, 'line-opacity': 0.35, 'line-width': width(0.3, 1.2) },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: roadClass(['primary', 'secondary', 'tertiary', 'trunk']),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': hex.ink, 'line-opacity': 0.8, 'line-width': width(0.5, 1.8) },
      },
      {
        id: 'roads-motorway',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: roadClass(['motorway']),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': hex.ink, 'line-width': width(0.8, 2.6) },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: roadClass(['rail']),
        paint: {
          'line-color': hex.ink,
          'line-opacity': 0.5,
          'line-width': width(0.5, 1.2),
          'line-dasharray': [3, 3],
        },
      },
      {
        id: 'road-names',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'transportation_name',
        minzoom: 14,
        filter: ['match', ['get', 'class'], ['primary', 'secondary', 'trunk'], true, false],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
        },
        paint: { 'text-color': hex.ink, 'text-halo-color': hex.chalk, 'text-halo-width': 1.5 },
      },
      {
        id: 'place-names',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'place',
        filter: ['match', ['get', 'class'], ['city', 'town', 'suburb', 'neighbourhood', 'quarter'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['match', ['get', 'class'], ['city', 'town'], 14, 12],
          'text-max-width': 8,
        },
        paint: { 'text-color': hex.ink, 'text-halo-color': hex.chalk, 'text-halo-width': 1.5 },
      },
    ],
  };
}
