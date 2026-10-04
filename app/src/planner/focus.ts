// What the planner is pointing at: hovering or tapping a row in the rail (a top place, a civic
// signal, a bus demand area) rings that place on the map, so the list and the map read together.
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { MapData } from '../data';
import { withAlpha } from '../map/layers';
import { cellCenter, roadMidpoint } from '../plan/targets';
import { tokens } from '../tokens';

export interface Focus {
  /** Rail row that owns it, e.g. "top:2", "signal:<id>", "bus:<area>". */
  key: string;
  lon: number;
  lat: number;
  label: string;
  /** A bus demand area: its H3 hexagon is outlined too. */
  hex?: string;
}

type LngLat = [number, number];

/** Where a planner target ('site:<id>', 'road:<id>', 'cell:<i>', 'stop:<id>') sits, or null. */
export function spotPoint(data: MapData, target: string): LngLat | null {
  const at = target.indexOf(':');
  const kind = target.slice(0, at);
  const id = target.slice(at + 1);
  if (kind === 'site') {
    const s = data.sites.find((x) => x.id === id);
    return s ? [s.lon, s.lat] : null;
  }
  if (kind === 'road') {
    const r = data.floodRoads.find((x) => x.id === id);
    return r ? roadMidpoint(r) : null;
  }
  if (kind === 'cell') {
    const i = Number(id);
    return Number.isInteger(i) && data.cells[i] ? cellCenter(data, i) : null;
  }
  if (kind === 'stop') {
    const s = data.stops.find((x) => x.id === id);
    return s ? [s.lon, s.lat] : null;
  }
  return null;
}

/** A bold ink-and-signal ring with the place's name, and the hexagon for a demand area. */
export function focusLayers(focus: Focus | null) {
  if (!focus) return [];
  const { rgb } = tokens();
  const at: LngLat = [focus.lon, focus.lat];
  return [
    ...(focus.hex
      ? [new H3HexagonLayer<string>({
          id: 'focus-hex',
          data: [focus.hex],
          getHexagon: (h) => h,
          extruded: false,
          stroked: true,
          filled: true,
          getFillColor: withAlpha(rgb.signal, 0.45),
          getLineColor: rgb.ink,
          getLineWidth: 4,
          lineWidthUnits: 'pixels',
        })]
      : []),
    new ScatterplotLayer<LngLat>({
      id: 'focus-ring',
      data: [at, at],
      getPosition: (p) => p,
      // Two rings: a thick ink one and a signal one inside it, like a stamped circle.
      getRadius: (_p, { index }) => (index === 0 ? 30 : 26),
      radiusUnits: 'pixels',
      stroked: true,
      filled: false,
      getLineColor: (_p, { index }) => (index === 0 ? rgb.ink : rgb.signal),
      getLineWidth: (_p, { index }) => (index === 0 ? 7 : 4),
      lineWidthUnits: 'pixels',
      parameters: { depthCompare: 'always' },
    }),
    new TextLayer<LngLat>({
      id: 'focus-label',
      data: [at],
      getPosition: (p) => p,
      getText: () => focus.label,
      getPixelOffset: [0, 46],
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

export type SetFocus = (f: Focus | null | ((cur: Focus | null) => Focus | null)) => void;

/**
 * Row props that point the map at `make()`: hover or keyboard focus shows it, leaving clears it,
 * and a tap shows it on phones (no hover there; it stays until another row is tapped).
 */
export function focusRow(key: string, make: () => Omit<Focus, 'key'> | null, current: Focus | null, setFocus: SetFocus) {
  const show = () => {
    const f = make();
    if (f) setFocus({ key, ...f });
  };
  const clear = () => setFocus((cur) => (cur?.key === key ? null : cur));
  return {
    tabIndex: 0,
    onMouseEnter: show,
    onMouseLeave: clear,
    onFocus: show,
    onBlur: clear,
    onClick: show,
    'aria-current': current?.key === key ? ('true' as const) : undefined,
  };
}
