// deck.gl layers for the map shell: population pieces, flood halftone, shelter sites.
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import { latLngToCell } from 'h3-js';
import type { Cell, Site } from '@shared/types';
import { weightedPeople } from '@shared/config';
import { tint, tokens, type RGB } from '../tokens';
import type { HalftoneDot } from './halftone';

export type HeightMetric = 'pop' | 'pop65' | 'noCarHH';

/** Tallest hexagon in meters. Low on purpose: stacked board pieces, not skyscrapers. */
const MAX_HEIGHT_M = 60;
/** Ink screen tints for the vulnerability classes, lightest first. Flat steps, no ramp. */
const TINTS = [0, 0.18, 0.34, 0.5];
const H3_RES = 9;

/** Share of a cell's weighted people that comes from the vulnerable groups. */
const vulnerableShare = (c: Cell) => {
  const w = weightedPeople(c);
  return w > 0 ? (w - c.pop) / w : 0;
};

/** Height in meters of every cell for the chosen metric, keyed by H3 index. */
export function cellHeights(cells: Cell[], metric: HeightMetric): Map<string, number> {
  const max = Math.max(1, ...cells.map((c) => c[metric]));
  return new Map(cells.map((c) => [c.h3, (c[metric] / max) * MAX_HEIGHT_M]));
}

/** Height of the piece under a point, so dots and squares sit on top of it. */
const heightAt = (heights: Map<string, number>, lon: number, lat: number) =>
  heights.get(latLngToCell(lat, lon, H3_RES)) ?? 0;

export function hexLayer(
  cells: Cell[],
  heights: Map<string, number>,
  metric: HeightMetric,
  selectedHood: string | null,
) {
  const { rgb } = tokens();
  const shares = cells.map(vulnerableShare);
  const lo = Math.min(...shares);
  const hi = Math.max(...shares);
  const fill = (c: Cell): RGB => {
    if (c.hood === selectedHood) return rgb.signal;
    const t = hi > lo ? (vulnerableShare(c) - lo) / (hi - lo) : 0;
    return tint(rgb.bond, rgb.ink, TINTS[Math.min(TINTS.length - 1, Math.floor(t * TINTS.length))] ?? 0);
  };

  return new H3HexagonLayer<Cell>({
    id: 'cells',
    data: cells,
    getHexagon: (c) => c.h3,
    extruded: true,
    getElevation: (c) => heights.get(c.h3) ?? 0,
    getFillColor: fill,
    wireframe: true,
    getLineColor: rgb.ink,
    material: { ambient: 0.75, diffuse: 0.35, shininess: 0, specularColor: [0, 0, 0] },
    pickable: true,
    updateTriggers: { getElevation: metric, getFillColor: selectedHood },
  });
}

/** Dot radius in meters by flood step: the floodway prints heaviest. */
const DOT_RADIUS_M: Record<number, number> = { 1: 48, 2: 36, 3: 24 };

export function floodDotsLayer(dots: HalftoneDot[], heights: Map<string, number>, metric: HeightMetric) {
  const { rgb } = tokens();
  return new ScatterplotLayer<HalftoneDot>({
    id: 'flood-halftone',
    data: dots,
    // +2 m keeps the dot above the piece's top face (no z-fighting).
    getPosition: (d) => [d.lon, d.lat, heightAt(heights, d.lon, d.lat) + 2],
    getRadius: (d) => DOT_RADIUS_M[d.step] ?? 20,
    radiusUnits: 'meters',
    radiusMinPixels: 1.5,
    getFillColor: rgb.flood,
    updateTriggers: { getPosition: metric },
  });
}

// Two 32 px squares in one atlas: solid ink for usable sites, hollow for sites that flood.
const siteAtlas = ({ ink, bond }: { ink: string; bond: string }) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32">` +
      `<rect x="3" y="3" width="26" height="26" fill="${ink}" stroke="${bond}" stroke-width="4"/>` +
      `<rect x="37" y="5" width="22" height="22" fill="${bond}" stroke="${ink}" stroke-width="6"/>` +
      `</svg>`,
  );
const SITE_MAPPING = {
  dry: { x: 0, y: 0, width: 32, height: 32 },
  floods: { x: 32, y: 0, width: 32, height: 32 },
};

export function sitesLayer(sites: Site[], heights: Map<string, number>, metric: HeightMetric) {
  return new IconLayer<Site>({
    id: 'sites',
    data: sites,
    iconAtlas: siteAtlas(tokens().hex),
    iconMapping: SITE_MAPPING,
    getIcon: (s) => (s.floodStep === null ? 'dry' : 'floods'),
    getPosition: (s) => [s.lon, s.lat, heightAt(heights, s.lon, s.lat) + 4],
    getSize: 16,
    sizeUnits: 'pixels',
    pickable: true,
    // Billboards stand upright, so the piece they sit on would clip their lower half.
    parameters: { depthCompare: 'always' },
    updateTriggers: { getPosition: metric },
  });
}
