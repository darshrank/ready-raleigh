import type { ReactNode } from 'react';
import { useMapData } from '../data';
import { MapView } from '../map/MapView';
import { useFloodMap } from '../map/useFloodMap';
import { Link } from '../router';

/**
 * Map with a rail. Desktop: map left, rail right (30%). Phone: map on top, rail as a bottom sheet.
 * The map is always the largest thing on screen.
 */
export function MapScreen({ title, rail }: { title: string; rail: (data: ReturnType<typeof useMapData>) => ReactNode }) {
  const state = useMapData();
  const { layers, frame, onClick } = useFloodMap(state.data);

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="relative h-[58svh] shrink-0 lg:h-full lg:flex-1">
        <MapView layers={layers} frame={frame} onClick={onClick} />
      </div>
      <aside className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-t-(length:--rule) border-ink bg-bond px-4 py-4 lg:w-[30%] lg:max-w-[440px] lg:min-w-[340px] lg:flex-none lg:border-t-0 lg:border-l-(length:--rule) lg:px-6 lg:py-6">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-24 font-extrabold lg:text-32">{title}</h1>
          <Link to="/" className="text-13 underline">
            Ready Raleigh
          </Link>
        </header>
        {state.error ? (
          <p className="text-15">
            Could not load the map data ({state.error}). Reload the page to try again.
          </p>
        ) : (
          rail(state)
        )}
      </aside>
    </div>
  );
}
