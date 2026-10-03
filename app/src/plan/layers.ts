// deck.gl layers for the planning phase: flood roads, coverage halftone, previews, cursor, pieces.
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { IconLayer, LineLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { engineIndex } from '@shared/engine';
import type { FloodRoad, Placement } from '@shared/types';
import type { MapData } from '../data';
import { withAlpha } from '../map/layers';
import { tokens } from '../tokens';
import { pieceAtlas, type FloodPiece, type IconKey } from './pieces';
import { anchorOf, cellCenter } from './targets';
import { targetOf, type Target } from './store';

type LngLat = [number, number];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ms = (n: number) => (reducedMotion() ? 0 : n);

/** Flood-prone roads, the road protection targets: --alarm lines, wider while a road is being picked. */
export function floodRoadsLayer(roads: FloodRoad[], protectedIds: Set<string>, targeting: boolean) {
  const { rgb } = tokens();
  return new PathLayer<FloodRoad>({
    id: 'flood-roads',
    data: roads.filter((r) => !protectedIds.has(r.id)),
    getPath: (r) => r.coords,
    getColor: rgb.alarm,
    getWidth: targeting ? 6 : 3.5,
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    updateTriggers: { getWidth: targeting },
  });
}

/** Protected roads stay open: --safe with an ink casing, like a street on the basemap. */
export function protectedRoadsLayers(roads: FloodRoad[]) {
  const { rgb } = tokens();
  const common = { data: roads, getPath: (r: FloodRoad) => r.coords, widthUnits: 'pixels' as const, capRounded: true, jointRounded: true };
  return [
    new PathLayer<FloodRoad>({ id: 'protected-roads-casing', ...common, getColor: rgb.ink, getWidth: 9 }),
    new PathLayer<FloodRoad>({ id: 'protected-roads', ...common, getColor: rgb.safe, getWidth: 5 }),
  ];
}

/** From this zoom covered dots get a thin ink rim, so they read over streets and the aerial photo. */
export const COVERAGE_RIM_ZOOM = 15;

/**
 * Coverage as a --safe halftone over the at-risk cells: the dot grows with the protected share of
 * the cell. Data is the fixed list of at-risk cells, so each dot keeps its index and its radius and
 * color can transition: the dots print themselves when a piece lands. Coverage never fades with the
 * zoom (the hex fills do); `rim` adds the ink edge up close.
 */
export function coverageLayer(data: MapData, atRisk: number[], share: Float32Array, rim = false) {
  const { rgb } = tokens();
  return new ScatterplotLayer<number>({
    id: 'coverage',
    data: atRisk,
    getPosition: (i) => cellCenter(data, i),
    getRadius: (_, { index }) => 32 + 33 * (share[index] ?? 0),
    getFillColor: (_, { index }) => withAlpha(rgb.safe, (share[index] ?? 0) > 0 ? 0.9 : 0),
    stroked: rim,
    getLineColor: (_, { index }) => withAlpha(rgb.ink, (share[index] ?? 0) > 0 ? 0.85 : 0),
    lineWidthUnits: 'pixels',
    getLineWidth: 1,
    radiusUnits: 'meters',
    // Same floor as the flood dots: at the city-wide view cells sit ~4 px apart and stay dots.
    radiusMinPixels: 1.2,
    radiusMaxPixels: 9,
    updateTriggers: { getRadius: share, getFillColor: share, getLineColor: share },
    transitions: { getRadius: ms(300), getFillColor: ms(300) },
  });
}

/** What a piece under the pointer would cover: hollow --safe rings, printed before the piece lands. */
export function previewLayer(data: MapData, cells: number[]) {
  const { rgb } = tokens();
  return new ScatterplotLayer<number>({
    id: 'coverage-preview',
    data: cells,
    getPosition: (i) => cellCenter(data, i),
    getRadius: 75,
    radiusUnits: 'meters',
    radiusMinPixels: 2,
    radiusMaxPixels: 11,
    stroked: true,
    filled: false,
    getLineColor: rgb.safe,
    lineWidthUnits: 'pixels',
    getLineWidth: 1.5,
  });
}

/** The target under the pointer: a signal ring (site, cell) or a signal band under a road. */
export function targetLayers(data: MapData, hover: Target | null) {
  const { rgb } = tokens();
  if (!hover) return [];
  if (hover.type === 'road_protection') {
    const road = data.floodRoads.find((r) => r.id === hover.roadId);
    if (!road) return [];
    const common = { data: [road], getPath: (r: FloodRoad) => r.coords, widthUnits: 'pixels' as const, capRounded: true, jointRounded: true };
    return [
      new PathLayer<FloodRoad>({ id: 'target-road-casing', ...common, getColor: rgb.ink, getWidth: 16 }),
      new PathLayer<FloodRoad>({ id: 'target-road', ...common, getColor: rgb.signal, getWidth: 11 }),
    ];
  }
  const at = anchorOf(data, hover);
  if (!at) return [];
  const rings = [ring('target-ring', at, 17)];
  return hover.type === 'bus_pickup' ? [...cellOutline('target-cell', data.cells[hover.cell]!.h3), ...rings] : rings;
}

function ring(id: string, at: LngLat, radiusPx: number) {
  const { rgb } = tokens();
  return new ScatterplotLayer<LngLat>({
    id,
    data: [at],
    getPosition: (p) => p,
    getRadius: radiusPx,
    radiusUnits: 'pixels',
    stroked: true,
    filled: false,
    getLineColor: rgb.signal,
    getLineWidth: 4,
    lineWidthUnits: 'pixels',
    parameters: { depthCompare: 'always' },
  });
}

function cellOutline(id: string, h3: string) {
  const { rgb } = tokens();
  return [
    new H3HexagonLayer<string>({
      id: `${id}-casing`,
      data: [h3],
      getHexagon: (h) => h,
      filled: false,
      stroked: true,
      extruded: false,
      getLineColor: rgb.ink,
      getLineWidth: 6,
      lineWidthUnits: 'pixels',
    }),
    new H3HexagonLayer<string>({
      id,
      data: [h3],
      getHexagon: (h) => h,
      filled: true,
      getFillColor: withAlpha(rgb.signal, 0.25),
      stroked: true,
      extruded: false,
      getLineColor: rgb.signal,
      getLineWidth: 3,
      lineWidthUnits: 'pixels',
    }),
  ];
}

/** Keyboard cursor: the cell an arrow key last moved to. */
export function cursorLayer(data: MapData, cell: number | null) {
  return cell === null ? [] : cellOutline('cursor', data.cells[cell]!.h3);
}

interface PieceDatum {
  id: string;
  icon: IconKey;
  at: LngLat;
}

let atlasCache: ReturnType<typeof pieceAtlas> | null = null;
const atlas = () => (atlasCache ??= pieceAtlas(tokens().hex));

/** Icon height in px. The face is 60 of the 80-unit box, so the disc is 30 px across. */
export const PIECE_SIZE = 40;

function pieceData(data: MapData, placements: Placement[], selectedId: string | null): PieceDatum[] {
  const out: PieceDatum[] = [];
  for (const p of placements) {
    const t = targetOf(p);
    const at = t && anchorOf(data, t);
    if (!at) continue;
    out.push({ id: p.id, icon: `${p.type as FloodPiece}${p.id === selectedId ? ':sel' : ''}` as IconKey, at });
  }
  return out;
}

/**
 * Placed pieces. A piece that lands "stamps": new icons start at 1.3x and settle in 200 ms.
 * New pieces are appended, so only they enter; the rest keep their size.
 */
export function piecesLayer(data: MapData, placements: Placement[], selectedId: string | null, hiddenId: string | null) {
  const { atlas: iconAtlas, mapping } = atlas();
  return new IconLayer<PieceDatum>({
    id: 'pieces',
    data: pieceData(data, placements, selectedId).filter((d) => d.id !== hiddenId),
    iconAtlas,
    iconMapping: mapping,
    getIcon: (d) => d.icon,
    getPosition: (d) => d.at,
    getSize: PIECE_SIZE,
    sizeUnits: 'pixels',
    parameters: { depthCompare: 'always' },
    transitions: {
      getSize: { duration: ms(200), easing: (x: number) => 1 - (1 - x) ** 3, enter: (to: ArrayLike<number>) => Array.from(to, (v) => v * 1.3) },
    },
  });
}

/** The piece the player is about to place or drop: the same disc, half printed. */
export function ghostLayer(data: MapData, piece: Placement | null, selected: boolean) {
  const { atlas: iconAtlas, mapping } = atlas();
  const items = piece ? pieceData(data, [piece], selected ? piece.id : null) : [];
  return new IconLayer<PieceDatum>({
    id: 'ghost',
    data: items,
    iconAtlas,
    iconMapping: mapping,
    getIcon: (d) => d.icon,
    getPosition: (d) => d.at,
    getSize: PIECE_SIZE,
    sizeUnits: 'pixels',
    opacity: 0.6,
    parameters: { depthCompare: 'always' },
  });
}

/** Where a bus pickup helps (no-car residents at risk within a short walk): a faint signal tint. */
export function busAreaLayer(data: MapData, visible: boolean) {
  const { rgb } = tokens();
  return new H3HexagonLayer<number>({
    id: 'bus-area',
    data: busAreaCells(data),
    visible,
    getHexagon: (i) => data.cells[i]!.h3,
    extruded: false,
    stroked: false,
    getFillColor: withAlpha(rgb.signal, 0.28),
  });
}

const busAreaCache = new WeakMap<MapData, number[]>();
function busAreaCells(data: MapData): number[] {
  let out = busAreaCache.get(data);
  if (!out) {
    const ok = engineIndex(data).busOk;
    out = [];
    for (let i = 0; i < ok.length; i++) if (ok[i]) out.push(i);
    busAreaCache.set(data, out);
  }
  return out;
}

export interface Link {
  from: LngLat;
  to: LngLat;
}

/** Bus pickup to the shelter its riders reach: a --safe line with an ink casing. */
export function linkLayers(links: Link[], id = 'links') {
  const { rgb } = tokens();
  const common = { data: links, getSourcePosition: (l: Link) => l.from, getTargetPosition: (l: Link) => l.to, widthUnits: 'pixels' as const, parameters: { depthCompare: 'always' as const } };
  return [
    new LineLayer<Link>({ id: `${id}-casing`, ...common, getColor: rgb.ink, getWidth: 6 }),
    new LineLayer<Link>({ id, ...common, getColor: rgb.safe, getWidth: 3 }),
  ];
}

