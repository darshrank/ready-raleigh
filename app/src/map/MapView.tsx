import { useEffect, useRef } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { LayersList, PickingInfo } from '@deck.gl/core';
import { useMapUi } from '../store';
import { tokens } from '../tokens';
import { basemapStyle } from './basemap';
import { framePoints } from './frame';

/** DESIGN.md: top-down by default; the Tilt toggle tilts to 45 degrees. */
const TILT_PITCH = 45;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  layers: LayersList;
  /** Points to frame. The camera fits them on load and on resize until the user moves the map. */
  frame: [number, number][] | null;
  /** Show the Tilt toggle (bottom left). The projector view turns it off. */
  tiltControl?: boolean;
  /** Clicks on the map. `info.object` is null when nothing pickable was hit. */
  onClick?: (info: PickingInfo) => void;
  label?: string;
}

export function MapView({ layers, frame, tiltControl = true, onClick, label = 'Map of Raleigh' }: Props) {
  const tilt = useMapUi((s) => s.tilt);
  const setTilt = useMapUi((s) => s.setTilt);
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
      pitch: useMapUi.getState().tilt ? TILT_PITCH : 0,
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
    // Dev only: lets screenshot scripts and the console inspect the map.
    if (import.meta.env.DEV) (window as unknown as { __map?: MapLibreMap }).__map = map;
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      mapRef.current = null;
      overlayRef.current = null;
      map.remove();
    };
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
    framePoints(map, frame, map.getPitch(), padding());
    const refit = () => {
      if (!userMoved.current) framePoints(map, frame, map.getPitch(), padding());
    };
    map.on('resize', refit);
    return () => {
      map.off('resize', refit);
    };
  }, [frame]);

  // Tilt keeps the user's view and only changes the pitch.
  useEffect(() => {
    const map = mapRef.current;
    const pitch = tilt ? TILT_PITCH : 0;
    if (!map || map.getPitch() === pitch) return;
    map.easeTo({ pitch, duration: reducedMotion() ? 0 : 400 });
  }, [tilt]);

  // maplibre-gl.css sets `position: relative` on the container and, being unlayered, beats
  // Tailwind's layered utilities. So the wrapper positions and the container only fills it.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" role="region" aria-label={label} />
      {tiltControl && (
        <button
          type="button"
          aria-pressed={tilt}
          onClick={() => setTilt(!tilt)}
          className={
            'absolute bottom-3 left-3 border-(length:--rule) border-ink px-3 py-1 text-13 font-semibold ' +
            (tilt ? 'bg-ink text-bond' : 'bg-bond text-ink')
          }
        >
          Tilt
        </button>
      )}
    </div>
  );
}
