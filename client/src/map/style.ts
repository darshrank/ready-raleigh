// Builds our map style: OpenFreeMap "liberty" (OSM) recolored with the design tokens,
// plus AWS Terrarium terrain + hillshade (DATA.md §2, PLAN.md §8.2).
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { TERRAIN_EXAGGERATION } from '@rr/shared';
import { token } from '../tokens.ts';

export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const TERRARIUM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRARIUM_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain: Mapzen/AWS (USGS 3DEP et al.)</a>';

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * (1 + amt))));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Linear mix of two hex colors (t = 0 → a, 1 → b). */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

// Labels that compete with the game (bus stops, minor POIs, one-way arrows).
const HIDDEN = new Set(['natural_earth', 'poi_r20', 'poi_r7', 'poi_transit', 'road_one_way_arrow', 'road_one_way_arrow_opposite']);

function recolor(layer: LayerSpecification): LayerSpecification {
  const grass = token('map-grass');
  const road = token('map-road');
  const water = token('map-water');
  const bldg = token('map-bldg');
  const paper = token('paper');
  const land = mix(grass, paper, 0.55);
  const id = layer.id;
  const set = (paint: Record<string, unknown>) => ({ ...layer, paint: { ...(layer as { paint?: object }).paint, ...paint } }) as LayerSpecification;

  if (layer.type === 'background') return set({ 'background-color': land });
  if (id === 'park' || id === 'landcover_grass') return set({ 'fill-color': grass, 'fill-opacity': 0.85 });
  if (id === 'landcover_wood') return set({ 'fill-color': shade(grass, -0.2), 'fill-opacity': 0.75 });
  if (id === 'landuse_residential') return set({ 'fill-color': mix(grass, paper, 0.7), 'fill-opacity': 0.7 });
  if (id === 'water') return set({ 'fill-color': water });
  if (id.startsWith('waterway_') && layer.type === 'line') return set({ 'line-color': water });
  if (layer.type === 'line' && /^(road|bridge|tunnel)_/.test(id) && !/rail|path|pedestrian/.test(id)) {
    return set({ 'line-color': id.endsWith('_casing') ? shade(road, -0.22) : road });
  }
  if (id === 'building') return set({ 'fill-color': bldg });
  if (id === 'building-3d') {
    return set({
      'fill-extrusion-color': bldg,
      'fill-extrusion-opacity': 0.95,
    });
  }
  return layer;
}

export async function buildStyle(signal?: AbortSignal): Promise<StyleSpecification> {
  const res = await fetch(BASE_STYLE_URL, { signal });
  if (!res.ok) throw new Error(`Basemap style failed (${res.status})`);
  const base = (await res.json()) as StyleSpecification;

  const layers = base.layers.filter((l) => !HIDDEN.has(l.id)).map(recolor);
  const hillshade: LayerSpecification = {
    id: 'hillshade',
    type: 'hillshade',
    source: 'hillshade-dem',
    paint: {
      'hillshade-exaggeration': 0.35,
      'hillshade-shadow-color': 'rgba(40, 60, 30, 0.45)',
      'hillshade-highlight-color': 'rgba(255, 255, 240, 0.25)',
    },
  };
  // Hillshade sits above land cover, below water and roads.
  const at = layers.findIndex((l) => l.id === 'waterway_tunnel');
  layers.splice(at < 0 ? 1 : at, 0, hillshade);

  // Separate sources for terrain and hillshade (MapLibre recommends this for quality).
  const dem = {
    type: 'raster-dem' as const,
    tiles: [TERRARIUM_TILES],
    encoding: 'terrarium' as const,
    tileSize: 256,
    maxzoom: 15,
  };

  return {
    ...base,
    sources: { ...base.sources, 'terrain-dem': { ...dem, attribution: TERRARIUM_ATTRIBUTION }, 'hillshade-dem': dem },
    layers,
    terrain: { source: 'terrain-dem', exaggeration: TERRAIN_EXAGGERATION },
    sky: {
      'sky-color': '#9fc6ef',
      'horizon-color': '#e6eef5',
      'fog-color': '#e6eef5',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.85,
    },
  };
}
