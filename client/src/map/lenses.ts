// Lenses (PLAN §6.2): four overlays that recolor the 3D scene in place. Loaded lazily from the pack.
import type maplibregl from 'maplibre-gl';
import type { LensId } from '@rr/shared';
import { token } from '../tokens.ts';

export const LENS_META: Record<LensId, { label: string; icon: string; legend: [string, string][] }> = {
  elevation: { label: 'Elevation', icon: '⛰', legend: [['var(--water-deep)', '< 3 ft above creek'], ['var(--water)', '3–6 ft'], ['var(--map-water)', '6–10 ft']] },
  water: { label: 'Water', icon: '≋', legend: [['var(--water)', 'Streams'], ['var(--alert)', 'FEMA 1% flood zone'], ['var(--heat-2)', 'Future 1% zone'], ['var(--danger)', 'Culverts']] },
  surface: { label: 'Surface', icon: '▦', legend: [['var(--ink-500)', 'Parking (paved)'], ['var(--bldg-masonry)', 'Masonry'], ['var(--bldg-wood)', 'Wood']] },
  people: { label: 'People', icon: '☺', legend: [['var(--heat-1)', 'Lower vulnerability'], ['var(--heat-3)', 'Higher'], ['var(--heat-4)', 'Highest']] },
};

const loaded = new Set<LensId>();
const BEFORE = 'pack-buildings-3d';

export async function setLens(map: maplibregl.Map, area: string, lens: LensId, on: boolean): Promise<void> {
  if (on && !loaded.has(lens)) {
    const res = await fetch(`/packs/${area}/lenses/${lens}.geojson`);
    if (!res.ok) throw new Error(`Lens data missing (${res.status})`);
    map.addSource(`lens-${lens}`, { type: 'geojson', data: (await res.json()) as GeoJSON.FeatureCollection });
    addLayers(map, lens);
    loaded.add(lens);
  }
  for (const id of layerIds(lens)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

export function clearLenses(map: maplibregl.Map): void {
  for (const l of loaded) for (const id of layerIds(l)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
}

function layerIds(lens: LensId): string[] {
  return { elevation: ['lens-elev'], water: ['lens-fema', 'lens-streams', 'lens-culverts'], surface: ['lens-parking'], people: ['lens-people', 'lens-people-line'] }[lens];
}

function addLayers(map: maplibregl.Map, lens: LensId): void {
  const src = `lens-${lens}`;
  const before = map.getLayer(BEFORE) ? BEFORE : undefined;
  if (lens === 'elevation') {
    map.addLayer({ id: 'lens-elev', type: 'fill', source: src, paint: { 'fill-color': ['match', ['get', 'band'], 0, token('water-deep'), 1, token('water'), token('map-water')], 'fill-opacity': 0.55 } }, before);
  } else if (lens === 'water') {
    map.addLayer({ id: 'lens-fema', type: 'fill', source: src, filter: ['in', ['get', 'kind'], ['literal', ['fema_1pct', 'fema_1pct_future']]], paint: { 'fill-color': ['match', ['get', 'kind'], 'fema_1pct', token('alert'), token('heat-2')], 'fill-opacity': 0.28, 'fill-outline-color': token('alert') } }, before);
    map.addLayer({ id: 'lens-streams', type: 'line', source: src, filter: ['==', ['get', 'kind'], 'stream'], paint: { 'line-color': token('water'), 'line-width': ['interpolate', ['linear'], ['coalesce', ['get', 'area_km2'], 1], 1, 2, 300, 7] }, layout: { 'line-cap': 'round' } }, before);
    map.addLayer({ id: 'lens-culverts', type: 'circle', source: src, filter: ['==', ['get', 'kind'], 'culvert'], paint: { 'circle-radius': 6, 'circle-color': token('danger'), 'circle-stroke-color': token('text'), 'circle-stroke-width': 2 } });
  } else if (lens === 'surface') {
    map.addLayer({ id: 'lens-parking', type: 'fill', source: src, paint: { 'fill-color': token('ink-500'), 'fill-opacity': 0.7 } }, before);
  } else {
    map.addLayer({ id: 'lens-people', type: 'fill', source: src, paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'vuln'], 1.0, token('heat-1'), 1.25, token('heat-3'), 1.5, token('heat-4')], 'fill-opacity': 0.5 } }, before);
    map.addLayer({ id: 'lens-people-line', type: 'line', source: src, paint: { 'line-color': token('ink-900'), 'line-width': 1, 'line-opacity': 0.4 } }, before);
  }
}
