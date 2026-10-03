// deck.gl layers over the basemap: a light data layer on a real map (DESIGN.md "Map").
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { IconLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { cellsToMultiPolygon } from 'h3-js';
import type { Cell, Site } from '@shared/types';
import { tokens, type RGB } from '../tokens';
import type { HalftoneDot } from './halftone';

export type PeopleMetric = 'pop' | 'pop65' | 'noCarHH';

type RGBA = [number, number, number, number];
const withAlpha = ([r, g, b]: RGB, a: number): RGBA => [r, g, b, Math.round(a * 255)];

/** "Who lives here" fill: ink at four flat opacities, never above 30%. */
export const PEOPLE_ALPHA = [0.06, 0.13, 0.21, 0.3];
// Alpha 1/255, not 0: deck.gl does not pick fully transparent fills, and 1/255 cannot be seen.
const CLEAR: RGBA = [0, 0, 0, 1];

/**
 * Every cell, always present and pickable so a tap anywhere opens the neighborhood card.
 * Invisible unless `showPeople`, then a flat low-opacity fill by the chosen metric. No outlines.
 */
export function cellsLayer(cells: Cell[], metric: PeopleMetric, showPeople: boolean) {
  const { rgb } = tokens();
  const max = Math.max(1, ...cells.map((c) => c[metric]));
  const fill = (c: Cell): RGBA => {
    if (!showPeople) return CLEAR;
    const step = Math.min(PEOPLE_ALPHA.length - 1, Math.floor((c[metric] / max) * PEOPLE_ALPHA.length));
    return withAlpha(rgb.ink, PEOPLE_ALPHA[step] ?? 0);
  };
  return new H3HexagonLayer<Cell>({
    id: 'cells',
    data: cells,
    getHexagon: (c) => c.h3,
    extruded: false,
    stroked: false,
    getFillColor: fill,
    pickable: true,
    updateTriggers: { getFillColor: [metric, showPeople] },
  });
}

/** The selected neighborhood: a signal tint inside a 2.5 px ink outline. */
export function hoodLayer(cells: Cell[], hood: string | null) {
  const { rgb } = tokens();
  const h3s = hood ? cells.filter((c) => c.hood === hood).map((c) => c.h3) : [];
  const polygons = h3s.length ? cellsToMultiPolygon(h3s, true) : [];
  return new PolygonLayer<number[][][]>({
    id: 'hood',
    data: polygons,
    getPolygon: (p) => p,
    getFillColor: withAlpha(rgb.signal, 0.35),
    getLineColor: rgb.ink,
    getLineWidth: 2.5,
    lineWidthUnits: 'pixels',
    lineJointRounded: true,
  });
}

/** Dot radius in meters by flood step: the floodway prints heaviest. Spacing is 120 m. */
export const DOT_RADIUS_M: Record<number, number> = { 1: 36, 2: 28, 3: 20 };

export function floodDotsLayer(dots: HalftoneDot[]) {
  const { rgb } = tokens();
  return new ScatterplotLayer<HalftoneDot>({
    id: 'flood-halftone',
    data: dots,
    getPosition: (d) => [d.lon, d.lat],
    getRadius: (d) => DOT_RADIUS_M[d.step] ?? 20,
    radiusUnits: 'meters',
    radiusMinPixels: 1.2,
    radiusMaxPixels: 10, // stay dots, not discs, when zoomed in
    // Slightly translucent so streets and labels read through the water.
    getFillColor: withAlpha(rgb.flood, 0.75),
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

export function sitesLayer(sites: Site[]) {
  return new IconLayer<Site>({
    id: 'sites',
    data: sites,
    iconAtlas: siteAtlas(tokens().hex),
    iconMapping: SITE_MAPPING,
    getIcon: (s) => (s.floodStep === null ? 'dry' : 'floods'),
    getPosition: (s) => [s.lon, s.lat],
    getSize: 16,
    sizeUnits: 'pixels',
    pickable: true,
    // Always on top: billboards stand upright, so a tilted map would otherwise clip them.
    parameters: { depthCompare: 'always' },
  });
}
