// The landing globe: the same OpenFreeMap tiles as the city map, printed in the day inks
// (chalk land, flood-blue water, ink borders and names), or in the night palette on the Dark map
// (storm blue land, brighter water, pale names). Streets fade in as you zoom toward a city.
// With Satellite on, the city map's imagery is the land and sea (dimmed on the Dark map), under
// pale borders and roads and the same names.
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { tint, type Tokens } from '../tokens';
import { ATTRIBUTION, GLYPHS, SATELLITE_ATTRIBUTION, SATELLITE_TILES, TILES, palette, width } from './basemap';

const REGULAR = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];

export function globeStyle(t: Tokens, dark = false, satellite = false): StyleSpecification {
  const { hex, rgb } = t;
  const ink = dark ? hex['storm-label'] : hex.ink;
  const land = dark ? hex['storm-building'] : hex.chalk;
  // Opaque tints, not alpha: ocean polygons overlap at the poles and alpha would darken there.
  const water = `rgb(${(dark ? tint(rgb['storm-land'], rgb['storm-water'], 0.45) : tint(rgb.chalk, rgb.flood, 0.42)).join(',')})`;
  const label = { 'text-color': ink, 'text-halo-color': dark ? hex['storm-land'] : hex.chalk, 'text-halo-width': satellite ? 2 : 1.5 };
  // Over the photo, lines are pale so they read on forest and ocean alike (like the city map's streets).
  const line = satellite ? hex[dark ? 'storm-label' : 'bond'] : ink;
  const imagery = palette(dark ? 'storm' : 'day', t).imagery;
  const photo: LayerSpecification[] = satellite
    ? [{
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        paint: { 'raster-brightness-max': imagery.brightness, 'raster-saturation': imagery.saturation, 'raster-fade-duration': 150 },
      }]
    : [];
  return {
    version: 8,
    projection: { type: 'globe' },
    glyphs: GLYPHS,
    sources: {
      omt: { type: 'vector', url: TILES, attribution: ATTRIBUTION },
      ...(satellite ? { satellite: { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 19, attribution: SATELLITE_ATTRIBUTION } } : {}),
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': land } },
      { id: 'parks', type: 'fill', source: 'omt', 'source-layer': 'park', minzoom: 8, paint: { 'fill-color': hex.safe, 'fill-opacity': dark ? 0.08 : 0.14 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': water } },
      ...photo,
      {
        id: 'roads',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom: 6,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false],
        paint: {
          'line-color': line,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, satellite ? 0.2 : 0.12, 11, satellite ? 0.5 : 0.35],
          'line-width': width(6, 0.4, 14, 3),
        },
      },
      {
        id: 'states',
        type: 'line',
        source: 'omt',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': line, 'line-opacity': satellite ? 0.5 : 0.35, 'line-width': 0.8, 'line-dasharray': [3, 2] },
      },
      {
        id: 'countries',
        type: 'line',
        source: 'omt',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': line, 'line-opacity': satellite ? 0.8 : dark ? 0.55 : 0.7, 'line-width': 1.2 },
      },
      {
        id: 'country-names',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'place',
        maxzoom: 5,
        filter: ['==', ['get', 'class'], 'country'],
        layout: { 'text-field': ['get', 'name:en'], 'text-font': BOLD, 'text-size': 12, 'text-max-width': 8 },
        paint: label,
      },
      {
        id: 'city-names',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'place',
        minzoom: 5,
        filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
        layout: { 'text-field': ['get', 'name'], 'text-font': REGULAR, 'text-size': 12 },
        paint: label,
      },
    ],
  };
}
