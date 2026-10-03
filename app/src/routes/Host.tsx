import { BUDGET, PLANNING_SECONDS } from '@shared/config';
import { useMapData } from '../data';
import { MapView } from '../map/MapView';
import { useFloodMap } from '../map/useFloodMap';
import { clock, money } from '../ui/format';

/** Projector view: full-bleed map, room code big, players along the bottom. */
export function Host({ code }: { code: string }) {
  const { data } = useMapData();
  const { layers, frame, onClick } = useFloodMap(data);
  const joinUrl = `${window.location.host}/play/${code}`;

  return (
    <div className="relative h-full">
      <MapView layers={layers} frame={frame} onClick={onClick} tiltControl={false} />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-4 p-4 lg:p-6">
        <div className="border-(length:--rule) border-ink bg-bond px-4 py-3">
          <p className="text-15">Join at {joinUrl}</p>
          <p className="font-display text-48 font-extrabold tracking-wide lg:text-72">{code}</p>
        </div>
        <div className="tabular flex gap-2 font-display text-32 font-bold lg:text-48">
          <span className="border-(length:--rule) border-ink bg-ink px-3 py-1 text-signal">{clock(PLANNING_SECONDS)}</span>
          <span className="border-(length:--rule) border-ink bg-bond px-3 py-1">{money(BUDGET)}</span>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 border-t-(length:--rule) border-ink bg-bond px-4 py-3 lg:px-6">
        <p className="text-18">Waiting for players to join.</p>
      </div>
    </div>
  );
}
