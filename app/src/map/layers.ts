// deck.gl layers over the basemap: a light data layer on a real map (DESIGN.md "Map").
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { IconLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { cellsToMultiPolygon } from 'h3-js';
import type { Cell, Site } from '@shared/types';
import type { Hospital } from '@shared/data';
import { tokens, type RGB } from '../tokens';

export type PeopleMetric = 'pop' | 'pop65' | 'noCarHH';

export type RGBA = [number, number, number, number];
export const withAlpha = ([r, g, b]: RGB, a: number): RGBA => [r, g, b, Math.round(a * 255)];

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

/**
 * Site squares grow with the zoom: 160 m across, clamped to 5-14 px. At the city-wide opening view
 * (about z10.7) the 184 sites stay 5 px specks instead of one blob downtown; from z13 they are
 * full-size targets. While a shelter is being placed they never drop below 9 px.
 */
export function sitesLayer(sites: Site[], { targeting = false, visible = true } = {}) {
  return new IconLayer<Site>({
    id: 'sites',
    data: sites,
    visible,
    iconAtlas: siteAtlas(tokens().hex),
    iconMapping: SITE_MAPPING,
    getIcon: (s) => (s.floodStep === null ? 'dry' : 'floods'),
    getPosition: (s) => [s.lon, s.lat],
    getSize: 160,
    sizeUnits: 'meters',
    sizeMinPixels: targeting ? 9 : 5,
    sizeMaxPixels: targeting ? 18 : 14,
    pickable: true,
    // Always on top: billboards stand upright, so a tilted map would otherwise clip them.
    parameters: { depthCompare: 'always' },
  });
}

// A medical cross: ink with a bond edge, so it reads apart from site squares and round pieces.
const hospitalIcon = ({ ink, bond }: { ink: string; bond: string }) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
      `<path d="M14 3h12v11h11v12H26v11H14V26H3V14h11z" fill="${ink}" stroke="${bond}" stroke-width="3" stroke-linejoin="miter"/>` +
      `</svg>`,
  );

/** "WakeMed Health & Hospitals: Raleigh Campus" reads as "WakeMed Raleigh Campus" on a map. */
const hospitalName = (h: Hospital) => h.name.replace(/ Health & Hospitals:/, '');

/** Label above the cross when another hospital sits just east, so close neighbors don't overprint. */
const labelAbove = (h: Hospital, all: Hospital[]) =>
  all.some((o) => o !== h && o.lon > h.lon && o.lon - h.lon < 0.02 && Math.abs(o.lat - h.lat) < 0.01);

/** Below this zoom the whole city is on screen and hospital names crowd the place names. */
export const HOSPITAL_LABEL_ZOOM = 10.5;

/**
 * Hospitals (hospitals.json): a cross, and the name from HOSPITAL_LABEL_ZOOM. Part of the Facilities
 * layer. `night` names them in the storm's label colors (DESIGN.md night palette).
 */
export function hospitalLayers(hospitals: Hospital[], visible: boolean, zoom: number, night = false) {
  const { hex, rgb } = tokens();
  return [
    new IconLayer<Hospital>({
      id: 'hospitals',
      data: hospitals,
      visible,
      getIcon: () => ({ url: hospitalIcon(hex), width: 40, height: 40, id: 'hospital' }),
      getPosition: (h) => [h.lon, h.lat],
      getSize: 20,
      sizeUnits: 'pixels',
      parameters: { depthCompare: 'always' },
    }),
    new TextLayer<Hospital>({
      id: 'hospital-names',
      data: hospitals,
      visible: visible && zoom >= HOSPITAL_LABEL_ZOOM,
      getPosition: (h) => [h.lon, h.lat],
      getText: hospitalName,
      getSize: 13,
      getColor: night ? rgb['storm-label'] : rgb.ink,
      getTextAnchor: (h) => (labelAbove(h, hospitals) ? 'middle' : 'start'),
      getAlignmentBaseline: (h) => (labelAbove(h, hospitals) ? 'bottom' : 'center'),
      getPixelOffset: (h) => (labelAbove(h, hospitals) ? [0, -12] : [14, 0]),
      fontFamily: '"Public Sans", system-ui, sans-serif',
      fontWeight: 600,
      characterSet: 'auto',
      fontSettings: { sdf: true },
      outlineWidth: 4,
      outlineColor: [...(night ? rgb['storm-land'] : rgb.chalk), 255],
      parameters: { depthCompare: 'always' },
    }),
  ];
}

// An existing registered shelter: a --safe house with an ink edge, so it reads as "already here"
// next to the round bond pieces the player places.
const existingShelterIcon = ({ ink, safe, bond }: { ink: string; safe: string; bond: string }) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
      `<path d="M4 19 20 5l16 14v17H4z" fill="${safe}" stroke="${ink}" stroke-width="3" stroke-linejoin="miter"/>` +
      `<rect x="16" y="24" width="8" height="12" fill="${bond}" stroke="${ink}" stroke-width="2"/>` +
      `</svg>`,
  );

export interface ExistingShelter {
  id: string;
  name: string;
  lon: number;
  lat: number;
  capacity?: number;
}

/** Registered shelters already in place, with their names from zoom 12. */
export function existingSheltersLayers(shelters: ExistingShelter[], zoom: number, night = false) {
  const { hex, rgb } = tokens();
  return [
    new IconLayer<ExistingShelter>({
      id: 'existing-shelters',
      data: shelters,
      getIcon: () => ({ url: existingShelterIcon(hex), width: 40, height: 40, id: 'existing-shelter' }),
      getPosition: (s) => [s.lon, s.lat],
      getSize: 22,
      sizeUnits: 'pixels',
      pickable: true,
      parameters: { depthCompare: 'always' },
    }),
    new TextLayer<ExistingShelter>({
      id: 'existing-shelter-names',
      data: shelters,
      visible: zoom >= 12,
      getPosition: (s) => [s.lon, s.lat],
      getText: (s) => (s.capacity ? `${s.name} (${s.capacity.toLocaleString('en-US')})` : s.name),
      getSize: 13,
      getColor: night ? rgb['storm-label'] : rgb.ink,
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      getPixelOffset: [15, 0],
      fontFamily: '"Public Sans", system-ui, sans-serif',
      fontWeight: 600,
      characterSet: 'auto',
      fontSettings: { sdf: true },
      outlineWidth: 4,
      outlineColor: [...(night ? rgb['storm-land'] : rgb.chalk), 255],
      parameters: { depthCompare: 'always' },
    }),
  ];
}

// An existing bus stop: a small bond sign with an ink edge and a bus bar.
const busStopIcon = ({ ink, bond }: { ink: string; bond: string }) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">` +
      `<rect x="2" y="2" width="20" height="20" fill="${bond}" stroke="${ink}" stroke-width="3"/>` +
      `<rect x="7" y="8" width="10" height="7" fill="${ink}"/>` +
      `</svg>`,
  );

/** Existing bus stops where a pickup helps: shown while a bus pickup is being placed. */
export function busStopsLayer(stops: { id: string; lon: number; lat: number }[], visible: boolean) {
  const { hex } = tokens();
  return new IconLayer<{ id: string; lon: number; lat: number }>({
    id: 'bus-stops',
    data: stops,
    visible,
    getIcon: () => ({ url: busStopIcon(hex), width: 24, height: 24, id: 'bus-stop' }),
    getPosition: (s) => [s.lon, s.lat],
    // 70 m across: specks at the city view, full-size signs from about z14.
    getSize: 70,
    sizeUnits: 'meters',
    sizeMinPixels: 4,
    sizeMaxPixels: 16,
    parameters: { depthCompare: 'always' },
  });
}

