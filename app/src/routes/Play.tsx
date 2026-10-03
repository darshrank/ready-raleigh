import { BUDGET, PLANNING_SECONDS } from '@shared/config';
import { useMapData } from '../data';
import { MapView } from '../map/MapView';
import { useFloodMap } from '../map/useFloodMap';
import { clock, money } from '../ui/format';

/** Phone or laptop player: budget and timer on top, map, tray as a bottom sheet. */
export function Play({ code }: { code: string }) {
  const { data } = useMapData();
  const { layers, frame, onClick } = useFloodMap(data);

  return (
    <div className="mx-auto flex h-full max-w-[720px] flex-col">
      <header className="tabular flex items-baseline justify-between border-b-(length:--rule) border-ink bg-bond px-4 py-2">
        <p>
          <span className="font-display text-32 font-bold">{money(BUDGET)}</span>{' '}
          <span className="text-13">left in budget</span>
        </p>
        <p className="font-display text-32 font-bold">{clock(PLANNING_SECONDS)}</p>
      </header>
      <div className="relative min-h-0 flex-1">
        <MapView layers={layers} frame={frame} onClick={onClick} />
      </div>
      <section className="border-t-(length:--rule) border-ink bg-bond px-4 py-4">
        <p className="text-15">
          Room <strong className="tabular">{code}</strong>. Your pieces arrive when the host starts
          the round.
        </p>
      </section>
    </div>
  );
}
