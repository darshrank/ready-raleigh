// What the planner is pointing at: hovering or tapping a row in the rail (a top place, a civic
// signal, a bus demand area) turns its peg on the map yellow (pegs.ts), so the list and the map
// read together.
import type { MapData } from '../data';
import { cellCenter, roadMidpoint } from '../plan/targets';

export interface Focus {
  /** Rail row and peg it belongs to: "top:2", "signal:<id>", "bus:<area>". */
  key: string;
}

export type SetFocus = (f: Focus | null | ((cur: Focus | null) => Focus | null)) => void;

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

/**
 * Row props that point at the row's peg: hover or keyboard focus shows it, leaving clears it, and
 * a tap shows it on phones (no hover there; it stays until another row is tapped).
 */
export function focusRow(key: string, current: Focus | null, setFocus: SetFocus) {
  const show = () => setFocus({ key });
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
