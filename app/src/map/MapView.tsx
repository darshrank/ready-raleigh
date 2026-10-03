import { useEffect, useRef } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { LayersList, PickingInfo } from '@deck.gl/core';
import { tokens } from '../tokens';
import { basemapStyle } from './basemap';
import { framePoints } from './frame';

/** DESIGN.md: pitch 45 in planning, 55 in simulation. */
export const PLANNING_PITCH = 45;

interface Props {
  layers: LayersList;
  /** Points to frame. The camera fits them on load and on resize until the user moves the map. */
  frame: [number, number][] | null;
  pitch?: number;
  /** Clicks on the map. `info.object` is null when nothing pickable was hit. */
  onClick?: (info: PickingInfo) => void;
  label?: string;
}

export function MapView({ layers, frame, pitch = PLANNING_PITCH, onClick, label = 'Map of Raleigh' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const userMoved = useRef(false);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: basemapStyle(tokens()),
      center: [-78.64, 35.78],
      zoom: 11,
      pitch,
      attributionControl: { compact: true },
    });
    // Fold the attribution to its (i) button. MapLibre unfolds it when the source's attribution
    // first arrives, which can be after 'load'; by 'idle' it has.
    map.once('idle', () => {
      map.getContainer().querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
    });
    map.on('movestart', (e) => {
      if ('originalEvent' in e && e.originalEvent) userMoved.current = true;
    });
    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      onClick: (info) => onClickRef.current?.(info),
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    });
    map.addControl(overlay);
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      mapRef.current = null;
      overlayRef.current = null;
      map.remove();
    };
    // The map is created once; pitch changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  // Frame the data on load, and again on resize (rail opening, rotation) until the user takes over.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frame) return;
    const padding = () => Math.round(Math.min(40, map.getContainer().clientWidth * 0.05));
    userMoved.current = false;
    framePoints(map, frame, pitch, padding());
    const refit = () => {
      if (!userMoved.current) framePoints(map, frame, pitch, padding());
    };
    map.on('resize', refit);
    return () => {
      map.off('resize', refit);
    };
  }, [frame, pitch]);

  // maplibre-gl.css sets `position: relative` on the container and, being unlayered, beats
  // Tailwind's layered utilities. So the wrapper positions and the container only fills it.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" role="region" aria-label={label} />
    </div>
  );
}
