// Camera framing: show every loaded cell and site, at any screen size and pitch.
import type { Map as MapLibreMap } from 'maplibre-gl';
import { cellToBoundary } from 'h3-js';
import type { MapData } from '../data';

type LngLat = [number, number];

/**
 * What the camera must show: every cell's corners and every site, the places people act on.
 * Flood polygons are left out on purpose: they can run far along a creek, and fitting them pushed
 * the phone view below zoom 13, where street names and buildings disappear. Water past the
 * edge of the screen reads naturally on a map.
 */
export function dataPoints({ cells, sites }: MapData): LngLat[] {
  const pts: LngLat[] = [];
  for (const c of cells) pts.push(...(cellToBoundary(c.h3, true) as LngLat[]));
  for (const s of sites) pts.push([s.lon, s.lat]);
  // Real data has tens of thousands of vertices; a few thousand frame just as well.
  const stride = Math.ceil(pts.length / 4000);
  return stride > 1 ? pts.filter((_, k) => k % stride === 0) : pts;
}

/**
 * Fit `points` at `pitch`. A pitched camera turns the data's bounding box into a trapezoid, so
 * instead of fitting the box, binary-search the largest zoom at which every point projects inside
 * the padded viewport, re-centering on the projected extent at each step.
 */
export function framePoints(map: MapLibreMap, points: LngLat[], pitch: number, padding: number) {
  if (points.length === 0) return;
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  if (w === 0 || h === 0) return;

  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  const start = map.cameraForBounds([[west, south], [east, north]], { padding, bearing: 0 });
  if (!start?.zoom) return;
  const center: LngLat = [(west + east) / 2, (south + north) / 2];

  const extent = () => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of points) {
      const { x, y } = map.project(p);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  };
  const fitsAt = (zoom: number) => {
    map.jumpTo({ center, zoom, pitch, bearing: 0 });
    for (let k = 0; k < 3; k++) {
      const e = extent();
      map.setCenter(map.unproject([(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2]));
    }
    const e = extent();
    return e.x0 >= padding && e.x1 <= w - padding && e.y0 >= padding && e.y1 <= h - padding;
  };

  let lo = start.zoom - 3;
  let hi = start.zoom + 3;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    if (fitsAt(mid)) lo = mid;
    else hi = mid;
  }
  fitsAt(lo);
}
