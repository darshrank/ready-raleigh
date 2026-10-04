// The planner map's pegs: round discs in the game's piece style (ink rim, hard ink shadow, a
// pictogram), one look per kind of finding, so the map reads at a glance:
//   top places        bond (white) face, the piece's pictogram (shelter, bus pickup, road)
//   consensus         safe (green) face, two people; grey once it faded
//   blind spot        alarm (pink) face, an eye; grey once covered
//   bus demand area   flood (blue) face, a bus; alarm (pink) where no stop is nearby
// The one the planner points at (hover or tap in the rail) turns signal yellow and grows.
import { IconLayer, TextLayer } from '@deck.gl/layers';
import { withAlpha } from '../map/layers';
import { DISC_BOX, PICTOGRAM } from '../plan/pieces';
import { tokens, type TokenName } from '../tokens';

export type PegSymbol = 'shelter' | 'bus_pickup' | 'road_protection' | 'consensus' | 'blind_spot';
export type PegFace = 'bond' | 'signal' | 'safe' | 'alarm' | 'flood' | 'chalk';
export type PegIcon = `${PegSymbol}:${PegFace}`;

const SYMBOLS: Record<PegSymbol, (ink: string, face: string) => string> = {
  ...PICTOGRAM,
  // Two people side by side: residents agreeing.
  consensus: (ink) =>
    `<circle cx="22" cy="22" r="7" fill="${ink}"/><circle cx="42" cy="22" r="7" fill="${ink}"/>` +
    `<path d="M10 50c0-12 5-18 12-18s12 6 12 18z" fill="${ink}"/><path d="M30 50c0-12 5-18 12-18s12 6 12 18z" fill="${ink}"/>`,
  // An eye: a place nobody is looking at.
  blind_spot: (ink, face) =>
    `<path d="M8 32c7-11 15-16 24-16s17 5 24 16c-7 11-15 16-24 16S15 43 8 32z" fill="${ink}"/>` +
    `<circle cx="32" cy="32" r="9" fill="${face}"/><circle cx="32" cy="32" r="4" fill="${ink}"/>`,
};
const FACES: PegFace[] = ['bond', 'signal', 'safe', 'alarm', 'flood', 'chalk'];

type IconBox = { x: number; y: number; width: number; height: number; anchorX: number; anchorY: number };
let cache: { atlas: string; mapping: Record<PegIcon, IconBox> } | null = null;

/** Every symbol on every face, as one deck.gl icon atlas (same geometry as the game's discs). */
export function pegAtlas() {
  if (cache) return cache;
  const hex = tokens().hex;
  const symbols = Object.keys(SYMBOLS) as PegSymbol[];
  const mapping = {} as Record<PegIcon, IconBox>;
  let svg = '';
  symbols.forEach((symbol, col) => {
    FACES.forEach((face, row) => {
      const x = col * DISC_BOX;
      const y = row * DISC_BOX;
      const fill = hex[face as TokenName];
      svg +=
        `<g transform="translate(${x} ${y})">` +
        `<circle cx="42" cy="42" r="30" fill="${hex.ink}"/>` +
        `<circle cx="36" cy="36" r="30" fill="${fill}" stroke="${hex.ink}" stroke-width="5"/>` +
        `<g transform="translate(36 36) scale(0.72) translate(-32 -32)">${SYMBOLS[symbol](hex.ink, fill)}</g></g>`;
      mapping[`${symbol}:${face}`] = { x, y, width: DISC_BOX, height: DISC_BOX, anchorX: 36, anchorY: 36 };
    });
  });
  const atlas =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${symbols.length * DISC_BOX}" height="${FACES.length * DISC_BOX}">${svg}</svg>`);
  cache = { atlas, mapping };
  return cache;
}

export interface Peg {
  /** The rail row's focus key ("top:2", "signal:<id>", "bus:<area>"). */
  key: string;
  lon: number;
  lat: number;
  symbol: PegSymbol;
  face: PegFace;
  /** Small ink badge on the peg: a rank or a player count. */
  badge?: string;
  label: string;
  /** Peg size in px (the game's pieces are 40). */
  size?: number;
  /** Nudge in px, so two pegs on one place both show. */
  offset?: [number, number];
}

/** Pegs, their badges, and the name under the one in focus. */
export function pegLayers(id: string, pegs: Peg[], focusKey: string | null) {
  if (!pegs.length) return [];
  const { atlas, mapping } = pegAtlas();
  const { rgb } = tokens();
  const isActive = (p: Peg) => p.key === focusKey;
  const size = (p: Peg) => (p.size ?? 40) * (isActive(p) ? 1.35 : 1);
  const active = pegs.filter(isActive);
  return [
    new IconLayer<Peg>({
      id: `${id}-pegs`,
      // The one in focus draws last, on top.
      data: [...pegs.filter((p) => !isActive(p)), ...active],
      iconAtlas: atlas,
      iconMapping: mapping,
      getIcon: (p) => `${p.symbol}:${isActive(p) ? 'signal' : p.face}`,
      getPosition: (p) => [p.lon, p.lat],
      getPixelOffset: (p) => p.offset ?? [0, 0],
      getSize: size,
      sizeUnits: 'pixels',
      parameters: { depthCompare: 'always' },
      updateTriggers: { getIcon: focusKey, getSize: focusKey, data: focusKey },
    }),
    new TextLayer<Peg>({
      id: `${id}-badges`,
      data: pegs.filter((p) => p.badge),
      getPosition: (p) => [p.lon, p.lat],
      getText: (p) => p.badge!,
      getPixelOffset: (p) => [(p.offset?.[0] ?? 0) + size(p) * 0.38, (p.offset?.[1] ?? 0) - size(p) * 0.38],
      getSize: 15,
      getColor: rgb.bond,
      background: true,
      getBackgroundColor: withAlpha(rgb.ink, 1),
      backgroundPadding: [5, 2],
      fontFamily: '"Big Shoulders Display", "Arial Narrow", sans-serif',
      fontWeight: 800,
      parameters: { depthCompare: 'always' },
      updateTriggers: { getPixelOffset: focusKey },
    }),
    new TextLayer<Peg>({
      id: `${id}-label`,
      data: active,
      getPosition: (p) => [p.lon, p.lat],
      getText: (p) => p.label,
      getPixelOffset: (p) => [p.offset?.[0] ?? 0, (p.offset?.[1] ?? 0) + size(p) * 0.85],
      getSize: 15,
      getColor: rgb.ink,
      background: true,
      getBackgroundColor: withAlpha(rgb.signal, 1),
      getBorderColor: rgb.ink,
      getBorderWidth: 2,
      backgroundPadding: [6, 3],
      fontFamily: '"Public Sans", system-ui, sans-serif',
      fontWeight: 600,
      parameters: { depthCompare: 'always' },
    }),
  ];
}
