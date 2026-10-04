// The flood game pieces: round discs like board game tokens (DESIGN.md "Game pieces").
// One SVG source draws both the tray buttons (DOM) and the map icons (deck.gl atlas).
import { BUS_STOP_ACTIVATE_COST, COSTS } from '@shared/config';

export type FloodPiece = 'shelter' | 'bus_pickup' | 'road_protection';
export const FLOOD_PIECES: FloodPiece[] = ['shelter', 'bus_pickup', 'road_protection'];

export const PIECE_INFO: Record<FloodPiece, { name: string; verb: string; covers: string; key: string }> = {
  shelter: {
    name: 'Shelter',
    verb: 'Place shelter',
    covers: 'People who can drive to it within 15 minutes',
    key: '1',
  },
  bus_pickup: {
    name: 'Bus pickup',
    verb: 'Place bus pickup',
    covers: 'Takes households with no car to a shelter. $0.5M at an existing bus stop',
    key: '2',
  },
  road_protection: {
    name: 'Road protection',
    verb: 'Protect a road',
    covers: 'Keeps one flood-prone road open',
    key: '3',
  },
};

export const pieceCost = (p: FloodPiece) => COSTS[p];
/** The least a piece can cost: a bus pickup at an existing stop is cheaper than a new one. */
export const minPieceCost = (p: FloodPiece) => (p === 'bus_pickup' ? Math.min(COSTS[p], BUS_STOP_ACTIVATE_COST) : COSTS[p]);

// Pictograms on a 64 x 64 grid, drawn in `ink` with `face` cut-outs.
const PICTOGRAM: Record<FloodPiece, (ink: string, face: string) => string> = {
  // A house: the building residents go to.
  shelter: (ink, face) =>
    `<path d="M12 31 32 13l20 18v20H12z" fill="${ink}"/>` + `<rect x="27" y="36" width="10" height="15" fill="${face}"/>`,
  // A bus, front view.
  bus_pickup: (ink, face) =>
    `<rect x="17" y="12" width="30" height="34" fill="${ink}"/>` +
    `<rect x="21" y="17" width="22" height="12" fill="${face}"/>` +
    `<rect x="21" y="35" width="5" height="5" fill="${face}"/><rect x="38" y="35" width="5" height="5" fill="${face}"/>` +
    `<rect x="19" y="46" width="7" height="6" fill="${ink}"/><rect x="38" y="46" width="7" height="6" fill="${ink}"/>`,
  // A road running into the distance, its center line kept clear.
  road_protection: (ink, face) =>
    `<path d="M26 12h12l12 40H14z" fill="${ink}"/>` +
    `<rect x="30.5" y="16" width="3" height="7" fill="${face}"/><rect x="30.5" y="28" width="3" height="8" fill="${face}"/>` +
    `<rect x="30" y="41" width="4" height="9" fill="${face}"/>`,
};

/** Disc geometry in SVG units: 80 x 80 box, face radius 30, hard shadow offset 6 (3 px at 40 px). */
export const DISC_BOX = 80;

/** One disc: hard ink shadow (unless `shadow` is false, for the tray's CSS shadow), face, ink rim, pictogram. */
export function discSvg(piece: FloodPiece, colors: { ink: string; face: string }, shadow = true): string {
  const { ink, face } = colors;
  return (
    (shadow ? `<circle cx="42" cy="42" r="30" fill="${ink}"/>` : '') +
    `<circle cx="36" cy="36" r="30" fill="${face}" stroke="${ink}" stroke-width="5"/>` +
    `<g transform="translate(36 36) scale(0.72) translate(-32 -32)">${PICTOGRAM[piece](ink, face)}</g>`
  );
}

export type IconKey = `${FloodPiece}` | `${FloodPiece}:sel`;

/** Atlas for deck.gl: each piece with a bond face, then each with a signal face (selected). */
export function pieceAtlas(hex: { ink: string; bond: string; signal: string }) {
  const mapping = {} as Record<IconKey, { x: number; y: number; width: number; height: number; anchorX: number; anchorY: number }>;
  let svg = '';
  FLOOD_PIECES.forEach((piece, k) => {
    for (const [row, face, suffix] of [[0, hex.bond, ''], [1, hex.signal, ':sel']] as const) {
      const x = k * DISC_BOX;
      const y = row * DISC_BOX;
      svg += `<g transform="translate(${x} ${y})">${discSvg(piece, { ink: hex.ink, face })}</g>`;
      // Anchor on the face's center, not the box's: the shadow hangs off the bottom right.
      mapping[`${piece}${suffix}` as IconKey] = { x, y, width: DISC_BOX, height: DISC_BOX, anchorX: 36, anchorY: 36 };
    }
  });
  const width = FLOOD_PIECES.length * DISC_BOX;
  const atlas =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${2 * DISC_BOX}">${svg}</svg>`);
  return { atlas, mapping };
}
