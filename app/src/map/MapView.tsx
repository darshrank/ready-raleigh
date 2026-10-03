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
  /**
   * Animated layers (the storm). While set, a requestAnimationFrame loop asks it for the layers
   * every frame, outside React, and `layers` is ignored. Returning null keeps the last frame.
   */
  frameLayers?: ((now: number) => LayersList | null) | null;
  /** Points to frame. The camera fits them on load and on resize until the user moves the map. */
  frame: [number, number][] | null;
  /** Show the Tilt toggle (bottom left). The projector view turns it off. */
  tiltControl?: boolean;
  /** Clicks on the map. `info.object` is null when nothing pickable was hit. */
  onClick?: (info: PickingInfo) => void;
  /** Called once the map exists; may return a cleanup. Lets a route add its own input handling. */
  onReady?: (map: MapLibreMap, overlay: MapboxOverlay) => void | (() => void);
  /** MapLibre's own arrow-key panning. Off when the route uses the arrows (keyboard play). */
  keyboard?: boolean;
  /** Cursor override (for example 'crosshair' while placing). */
  cursor?: string | null;
  label?: string;
}

export function MapView({
  layers,
  frameLayers = null,
  frame,
  tiltControl = true,
  onClick,
  onReady,
  keyboard = true,
  cursor = null,
  label = 'Map of Raleigh',
}: Props) {
  const tilt = useMapUi((s) => s.tilt);
  const setTilt = useMapUi((s) => s.setTilt);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const userMoved = useRef(false);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

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
    map.on('zoomend', () => useMapUi.getState().setZoom(map.getZoom()));
    map.on('movestart', (e) => {
      if ('originalEvent' in e && e.originalEvent) userMoved.current = true;
    });
    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      onClick: (info) => onClickRef.current?.(info),
      getCursor: ({ isHovering, isDragging }) =>
        cursorRef.current ?? (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    });
    map.addControl(overlay);
    if (!keyboard) map.keyboard.disable();
    // Dev only: lets screenshot scripts and the console inspect the map.
    if (import.meta.env.DEV) (window as unknown as { __map?: MapLibreMap }).__map = map;
    mapRef.current = map;
    overlayRef.current = overlay;
    const cleanup = onReadyRef.current?.(map, overlay);
    return () => {
      cleanup?.();
      mapRef.current = null;
      overlayRef.current = null;
      map.remove();
    };
    // The map is created once; `keyboard` is read at creation.
  }, []);

  useEffect(() => {
    if (!frameLayers) overlayRef.current?.setProps({ layers });
  }, [layers, frameLayers]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !frameLayers) return;
    let raf = 0;
    const tick = (now: number) => {
      const next = frameLayers(now);
      if (next) overlay.setProps({ layers: next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frameLayers]);

  // deck.gl only asks getCursor on pointer moves; apply a changed override right away.
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas && cursor) canvas.style.cursor = cursor;
  }, [cursor]);

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
