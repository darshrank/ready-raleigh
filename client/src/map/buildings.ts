// Pack buildings (PMTiles) as 3D extrusions colored by construction type (PLAN.md §8.2).
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { token } from '../tokens.ts';

let protocolAdded = false;
const DEFAULT_HEIGHT_M = 4; // shown only for buildings with no height data (flagged in the inspector)

export function addPackBuildings(map: maplibregl.Map, area: string): void {
  if (!protocolAdded) {
    maplibregl.addProtocol('pmtiles', new Protocol().tile);
    protocolAdded = true;
  }
  map.addSource('pack-buildings', {
    type: 'vector',
    url: `pmtiles://${location.origin}/packs/${area}/buildings.pmtiles`,
    promoteId: 'id',
  });
  if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', 'none');
  const facade = [
    'match',
    ['get', 'construction'],
    'WOOD', token('bldg-wood'),
    'MASONRY', token('bldg-masonry'),
    'CONCRETE', token('bldg-concrete'),
    'STEEL', token('bldg-steel'),
    'MANUFCHOME', token('bldg-manufactured'),
    token('map-bldg'),
  ] as maplibregl.ExpressionSpecification;
  map.addLayer({
    id: 'pack-buildings-3d',
    type: 'fill-extrusion',
    source: 'pack-buildings',
    'source-layer': 'buildings',
    minzoom: 12,
    paint: {
      'fill-extrusion-color': [
        'case',
        ['boolean', ['feature-state', 'focus'], false], token('safe'),
        ['==', ['feature-state', 'flood'], 2], token('danger'),
        ['==', ['feature-state', 'flood'], 1], token('alert'),
        facade,
      ],
      'fill-extrusion-height': ['coalesce', ['get', 'height_m'], DEFAULT_HEIGHT_M],
      'fill-extrusion-opacity': 0.96,
      'fill-extrusion-vertical-gradient': true,
    },
  });
}
