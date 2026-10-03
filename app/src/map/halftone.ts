// Halftone dots from flood polygons. Stand-in until pipeline/ exports the dot grid (P3):
// same idea, a regular grid about every 120 m, each dot tagged with the first step that reaches it.
import type { FloodStepsCollection } from '@shared/data';

export interface HalftoneDot {
  lon: number;
  lat: number;
  step: number;
}

type Ring = [number, number][];
const M_PER_DEG_LAT = 111_320;

function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a]!;
    const [xb, yb] = ring[b]!;
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

/** Polygon with holes: inside the outer ring and outside every hole. */
const inPolygon = (p: [number, number], rings: Ring[]) =>
  rings.length > 0 && inRing(p, rings[0]!) && !rings.slice(1).some((hole) => inRing(p, hole));

export function halftoneDots(fc: FloodStepsCollection, spacingM = 120): HalftoneDot[] {
  const polys: { step: number; rings: Ring[] }[] = fc.features.flatMap((f) =>
    f.geometry.type === 'Polygon'
      ? [{ step: f.properties.step, rings: f.geometry.coordinates }]
      : f.geometry.coordinates.map((rings) => ({ step: f.properties.step, rings })),
  );
  if (polys.length === 0) return [];

  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { rings } of polys) {
    for (const [x, y] of rings[0] ?? []) {
      w = Math.min(w, x); e = Math.max(e, x);
      s = Math.min(s, y); n = Math.max(n, y);
    }
  }

  // Offset rows (hexagonal packing) read like a print screen rather than graph paper.
  const dLat = (spacingM * Math.sqrt(3)) / 2 / M_PER_DEG_LAT;
  const dLon = spacingM / (M_PER_DEG_LAT * Math.cos((((s + n) / 2) * Math.PI) / 180));
  const dots: HalftoneDot[] = [];
  for (let row = 0, lat = s; lat <= n; row++, lat += dLat) {
    for (let lon = w + (row % 2) * (dLon / 2); lon <= e; lon += dLon) {
      let step = Infinity;
      for (const poly of polys) {
        if (poly.step < step && inPolygon([lon, lat], poly.rings)) step = poly.step;
      }
      if (step !== Infinity) dots.push({ lon, lat, step });
    }
  }
  return dots;
}
