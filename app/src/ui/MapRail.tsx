// Pieces of the map rail: height toggle, legend, neighborhood card.
import { useEffect, useMemo } from 'react';
import type { Cell } from '@shared/types';
import { FLOOD_STEP_NAMES } from '@shared/config';
import type { HeightMetric } from '../map/layers';
import { useMapUi } from '../store';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const METRICS: { value: HeightMetric; label: string }[] = [
  { value: 'pop', label: 'Everyone' },
  { value: 'pop65', label: '65 and over' },
  { value: 'noCarHH', label: 'No car' },
];

export function HeightToggle() {
  const metric = useMapUi((s) => s.metric);
  const setMetric = useMapUi((s) => s.setMetric);
  return (
    <fieldset>
      <legend className="text-15 font-semibold">Hexagon height shows</legend>
      <div className="mt-2 flex border-(length:--rule) border-ink">
        {METRICS.map((m, k) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={metric === m.value}
            onClick={() => setMetric(m.value)}
            className={
              'flex-1 px-2 py-2 text-15 ' +
              (k > 0 ? 'border-l-(length:--rule) border-ink ' : '') +
              (metric === m.value ? 'bg-ink font-semibold text-bond' : 'bg-bond text-ink hover:bg-chalk')
            }
          >
            {m.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Sizes match DOT_RADIUS_M in layers.ts (48, 36, 24 m), scaled for the legend. */
const LEGEND_DOTS = [
  { step: 1, r: 6 },
  { step: 2, r: 4.5 },
  { step: 3, r: 3 },
];

export function Legend() {
  return (
    <div className="grid gap-3 text-13">
      <div>
        <p className="text-15 font-semibold">Where water reaches</p>
        <ul className="mt-1.5 grid gap-1">
          {LEGEND_DOTS.map(({ step, r }) => (
            <li key={step} className="flex items-center gap-2">
              <svg width="24" height="14" aria-hidden className="shrink-0 fill-flood">
                <circle cx="12" cy="7" r={r} />
              </svg>
              {FLOOD_STEP_NAMES[step]}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-15 font-semibold">Shelter sites</p>
        <ul className="mt-1.5 grid gap-1">
          <li className="flex items-center gap-2">
            <span aria-hidden className="mx-1.5 size-3 shrink-0 bg-ink" />
            Stays dry, can open as a shelter
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="mx-1.5 size-3 shrink-0 border-[3px] border-ink bg-bond" />
            Floods, cannot open
          </li>
        </ul>
      </div>
      <p>Darker hexagons have a larger share of older, low-income and car-free residents.</p>
    </div>
  );
}

function hoodStats(cells: Cell[], hood: string) {
  const inHood = cells.filter((c) => c.hood === hood);
  const steps = inHood.map((c) => c.floodStep).filter((s): s is number => s !== null);
  return {
    pop: inHood.reduce((t, c) => t + c.pop, 0),
    pop65: inHood.reduce((t, c) => t + c.pop65, 0),
    noCarHH: inHood.reduce((t, c) => t + c.noCarHH, 0),
    firstStep: steps.length ? Math.min(...steps) : null,
    popInWater: inHood.filter((c) => c.floodStep !== null).reduce((t, c) => t + c.pop, 0),
  };
}

export function NeighborhoodCard({ cells }: { cells: Cell[] }) {
  const hood = useMapUi((s) => s.selectedHood);
  const selectHood = useMapUi((s) => s.selectHood);
  const stats = useMemo(() => (hood ? hoodStats(cells, hood) : null), [cells, hood]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && selectHood(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectHood]);

  if (!hood || !stats) {
    return <p className="text-15">Tap a hexagon to see who lives there.</p>;
  }

  return (
    <section aria-live="polite" aria-labelledby="hood-name">
      <div className="flex items-start justify-between gap-3">
        <h2 id="hood-name" className="font-display text-32 font-extrabold">
          {hood}
        </h2>
        <button type="button" onClick={() => selectHood(null)} className="shrink-0 text-13 underline">
          Close
        </button>
      </div>
      <dl className="tabular mt-3 grid grid-cols-3 gap-3">
        {[
          ['Residents', stats.pop],
          ['Age 65 and over', stats.pop65],
          ['Households with no car', stats.noCarHH],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse justify-end">
            <dt className="text-13">{label}</dt>
            <dd className="font-display text-32 font-bold">{fmt(value as number)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t-(length:--rule) border-ink pt-2 text-15">
        {stats.firstStep === null ? (
          'Stays dry through the 500-year flood.'
        ) : (
          <>
            First floods in the <strong>{FLOOD_STEP_NAMES[stats.firstStep]?.toLowerCase()}</strong>{' '}
            (step {stats.firstStep}). <span className="tabular">{fmt(stats.popInWater)}</span> residents
            live where the water reaches.
          </>
        )}
      </p>
    </section>
  );
}
