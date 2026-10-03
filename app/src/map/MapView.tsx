import { useEffect, useRef } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import type { Cell } from '@shared/types';
import { weightedPeople } from '@shared/config';

// OpenFreeMap, free and keyless. P5 restyles it to the DESIGN.md palette.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const RALEIGH: [number, number] = [-78.655, 35.783];

type RGB = [number, number, number];
const BOND: RGB = [247, 249, 248];
const INK: RGB = [30, 42, 71];

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Share of a cell's weighted people that comes from the vulnerable groups. */
const vulnerableShare = (c: Cell) => {
  const w = weightedPeople(c);
  return w > 0 ? (w - c.pop) / w : 0;
};

function hexLayer(cells: Cell[]) {
  const shares = cells.map(vulnerableShare);
  const lo = Math.min(...shares);
  const hi = Math.max(...shares);
  const norm = (c: Cell) => (hi > lo ? (vulnerableShare(c) - lo) / (hi - lo) : 0.5);

  return new H3HexagonLayer<Cell>({
    id: 'cells',
    data: cells,
    getHexagon: (c) => c.h3,
    extruded: true,
    getElevation: (c) => c.pop,
    elevationScale: 0.15,
    getFillColor: (c) => mix(BOND, INK, norm(c)),
    getLineColor: INK,
    lineWidthMinPixels: 1,
    stroked: true,
    pickable: true,
  });
}

export function MapView({ cells }: { cells: Cell[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: RALEIGH,
      zoom: 13.2,
      pitch: 45,
      attributionControl: { compact: true },
    });
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);
    overlayRef.current = overlay;
    return () => {
      overlayRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    overlayRef.current?.setProps({ layers: [hexLayer(cells)] });
  }, [cells]);

  // maplibre-gl.css sets `position: relative` on the container and, being unlayered, beats
  // Tailwind's layered utilities. So the wrapper positions and the container only fills it.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" aria-label="Map of Raleigh" />
    </div>
  );
}
