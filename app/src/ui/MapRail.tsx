// Pieces of the map rail: "Who lives here" and Facilities layers, legend, neighborhood card.
import { useEffect, useMemo } from 'react';
import type { Cell } from '@shared/types';
import { PEOPLE_ALPHA, type PeopleMetric } from '../map/layers';
import { cityPieces, pieceName } from '../plan/pieces';
import { currentStory, type Hazard } from '../story';
import { useMapUi } from '../store';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const METRICS: { value: PeopleMetric; label: string; more: string }[] = [
  { value: 'pop', label: 'Everyone', more: 'More residents' },
  { value: 'pop65', label: '65 and over', more: 'More people 65 and over' },
  { value: 'noCarHH', label: 'No car', more: 'More households with no car' },
];

/** "Who lives here": off by default. When on, pick what the fill shows and see its key. */
export function PeopleLayerControl() {
  const showPeople = useMapUi((s) => s.showPeople);
  const setShowPeople = useMapUi((s) => s.setShowPeople);
  const metric = useMapUi((s) => s.metric);
  const setMetric = useMapUi((s) => s.setMetric);
  const current = METRICS.find((m) => m.value === metric) ?? METRICS[0]!;

  return (
    <div>
      <button
        type="button"
        aria-pressed={showPeople}
        onClick={() => setShowPeople(!showPeople)}
        className="flex items-center gap-2 text-15 font-semibold"
      >
        <span
          aria-hidden
          className={'size-4 shrink-0 border-(length:--rule) border-ink ' + (showPeople ? 'bg-ink' : 'bg-bond')}
        />
        Who lives here
      </button>
      {showPeople && (
        <div className="mt-3">
          <div role="group" aria-label="Show" className="flex border-(length:--rule) border-ink">
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
          <div className="mt-2 flex items-center gap-2 text-13">
            Fewer
            <span aria-hidden className="flex bg-chalk">
              {PEOPLE_ALPHA.map((a) => (
                <span key={a} className="size-4 bg-ink" style={{ opacity: a }} />
              ))}
            </span>
            {current.more}
          </div>
        </div>
      )}
    </div>
  );
}

/** Facilities: hospitals and shelter sites. On by default; sites still show while placing a shelter. */
export function FacilitiesControl() {
  const on = useMapUi((s) => s.showFacilities);
  const set = useMapUi((s) => s.setShowFacilities);
  return (
    <button type="button" aria-pressed={on} onClick={() => set(!on)} className="flex items-center gap-2 text-15 font-semibold">
      <span aria-hidden className={'size-4 shrink-0 border-(length:--rule) border-ink ' + (on ? 'bg-ink' : 'bg-bond')} />
      Hospitals and {pieceName('shelter').toLowerCase()} sites
    </button>
  );
}

/** Legend water swatches: the day water of each step (map/flood.ts), deepest first. */
const WATER_SWATCH: Record<number, string> = {
  1: 'bg-flood-deep opacity-60',
  2: 'bg-flood opacity-50',
  3: 'bg-flood opacity-30',
};
/** Failing ground and heat (map/flood.ts groundLook): the same three strengths in signal or alarm. */
const groundSwatch = (step: number) =>
  `${currentStory().hazard === 'quake' ? 'bg-signal' : 'bg-alarm'} ${step === 1 ? 'opacity-80' : step === 2 ? 'opacity-55' : 'opacity-35'}`;

const EVENT: Record<Hazard, string> = { flood: 'The storm', quake: 'The quake', heat: 'The heat wave' };
const UNDER: Record<Hazard, string> = {
  flood: 'Street under water (flowing dashes)',
  quake: 'Street on failing ground',
  heat: 'Street in dangerous heat',
};
const SITE_LOST: Record<Hazard, string> = { flood: 'that floods', quake: 'on failing ground', heat: 'that loses power' };

export function Legend({ planning = false, storm = false }: { planning?: boolean; storm?: boolean }) {
  const story = currentStory();
  const flood = story.hazard === 'flood';
  const site = pieceName('shelter');
  // Roads close (and can be protected) in the flood and the quake, not in the heat.
  const roads = cityPieces().includes('road_protection');
  return (
    <div className="grid gap-3 text-13">
      <div>
        <p className="text-15 font-semibold">{flood ? 'Where water reaches' : 'Where the disaster reaches'}</p>
        <ul className="mt-1.5 grid gap-1">
          {[1, 2, 3].map((step) => (
            <li key={step} className="flex items-center gap-2">
              <span aria-hidden className={'h-3.5 w-6 shrink-0 ' + (flood ? WATER_SWATCH[step] : groundSwatch(step))} />
              {story.steps[step]}
            </li>
          ))}
        </ul>
      </div>
      {storm && (
        <div>
          <p className="text-15 font-semibold">{EVENT[story.hazard]}</p>
          <ul className="mt-1.5 grid gap-1">
            <li className="flex items-center gap-2">
              <svg width="24" height="14" aria-hidden className="shrink-0">
                <line x1="2" y1="7" x2="15" y2="7" className="stroke-safe" strokeWidth="2" strokeLinecap="round" />
                <circle cx="18" cy="7" r="3" className="fill-safe" />
              </svg>
              Residents reaching a {site.toLowerCase()} or bus
            </li>
            <li className="flex items-center gap-2">
              <svg width="24" height="14" aria-hidden className="shrink-0 fill-none stroke-alarm" strokeWidth="1.5">
                <circle cx="12" cy="7" r="4" />
              </svg>
              Residents stranded
            </li>
            <li className="flex items-center gap-2">
              <svg width="24" height="14" aria-hidden className="shrink-0">
                <line x1="1" y1="7" x2="23" y2="7" className="stroke-flood-deep" strokeWidth="6" />
                <line x1="1" y1="7" x2="23" y2="7" className="stroke-bond" strokeWidth="2" strokeDasharray="3 5" />
              </svg>
              {UNDER[story.hazard]}
            </li>
            {roads && (
              <>
                <li className="flex items-center gap-2">
                  <svg width="24" height="14" viewBox="0 0 26 11" aria-hidden className="shrink-0">
                    <rect x="0.75" y="0.75" width="24.5" height="9.5" className="fill-bond stroke-ink" strokeWidth="1.5" />
                    <path d="M5 10 9 1h3l-4 9zM13 10l4-9h3l-4 9z" className="fill-alarm" />
                  </svg>
                  Road closed
                </li>
                <li className="flex items-center gap-2">
                  <svg width="24" height="14" aria-hidden className="shrink-0">
                    <line x1="3" y1="7" x2="21" y2="7" className="stroke-ink" strokeWidth="8" strokeLinecap="round" />
                    <line x1="3" y1="7" x2="21" y2="7" className="stroke-safe" strokeWidth="4.5" strokeLinecap="round" />
                  </svg>
                  Protected road, stays open
                </li>
              </>
            )}
          </ul>
        </div>
      )}
      {planning && (
        <div>
          <p className="text-15 font-semibold">Your plan</p>
          <ul className="mt-1.5 grid gap-1">
            <li className="flex items-center gap-2">
              <svg width="24" height="14" aria-hidden className="shrink-0 fill-safe">
                <circle cx="6" cy="7" r="3" />
                <circle cx="17" cy="7" r="5" />
              </svg>
              Residents covered (bigger dot, more of the block)
            </li>
            {roads && (
              <>
                <li className="flex items-center gap-2">
                  <svg width="24" height="14" aria-hidden className="shrink-0">
                    <line x1="2" y1="7" x2="22" y2="7" className="stroke-alarm" strokeWidth="3.5" strokeLinecap="round" />
                  </svg>
                  {flood ? 'Flood-prone road, closes in the flood' : 'Quake-prone road, closes in the quake'}
                </li>
                <li className="flex items-center gap-2">
                  <svg width="24" height="14" aria-hidden className="shrink-0">
                    <line x1="3" y1="7" x2="21" y2="7" className="stroke-ink" strokeWidth="8" strokeLinecap="round" />
                    <line x1="3" y1="7" x2="21" y2="7" className="stroke-safe" strokeWidth="4.5" strokeLinecap="round" />
                  </svg>
                  Protected road, stays open
                </li>
              </>
            )}
          </ul>
        </div>
      )}
      <div>
        <p className="text-15 font-semibold">Facilities</p>
        <ul className="mt-1.5 grid gap-1">
          <li className="flex items-center gap-2">
            <svg width="24" height="16" viewBox="0 0 40 40" aria-hidden className="shrink-0">
              <path d="M14 3h12v11h11v12H26v11H14V26H3V14h11z" className="fill-ink" />
            </svg>
            Hospital
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="mx-1.5 size-3 shrink-0 bg-ink" />
            {site} site, {flood ? 'stays dry' : 'stays open'}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="mx-1.5 size-3 shrink-0 border-[3px] border-ink bg-bond" />
            {site} site {SITE_LOST[story.hazard]}, cannot open
          </li>
        </ul>
      </div>
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

export function NeighborhoodCard({ cells, hideEmpty = false, compact = false }: { cells: Cell[]; hideEmpty?: boolean; compact?: boolean }) {
  const hood = useMapUi((s) => s.selectedHood);
  const selectHood = useMapUi((s) => s.selectHood);
  const stats = useMemo(() => (hood ? hoodStats(cells, hood) : null), [cells, hood]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && selectHood(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectHood]);

  if (!hood || !stats) {
    return hideEmpty ? null : <p className="text-15">Tap the map to see who lives there.</p>;
  }

  return (
    <section aria-live="polite" aria-labelledby="hood-name">
      <div className="flex items-start justify-between gap-3">
        <h2 id="hood-name" className={'font-display font-extrabold ' + (compact ? 'text-24 leading-tight' : 'text-32')}>
          {hood}
        </h2>
        <button type="button" onClick={() => selectHood(null)} className="shrink-0 text-13 underline">
          Close
        </button>
      </div>
      <dl className={'tabular grid grid-cols-3 gap-3 ' + (compact ? 'mt-1' : 'mt-3')}>
        {[
          ['Residents', stats.pop],
          ['Age 65 and over', stats.pop65],
          ['Households with no car', stats.noCarHH],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse justify-end">
            <dt className="text-13">{label}</dt>
            <dd className={'font-display font-bold ' + (compact ? 'text-24' : 'text-32')}>{fmt(value as number)}</dd>
          </div>
        ))}
      </dl>
      <p className={'border-t-(length:--rule) border-ink pt-2 ' + (compact ? 'mt-2 text-13' : 'mt-3 text-15')}>
        {stats.firstStep === null ? (
          currentStory().hazard === 'flood' ? 'Stays dry through the 500-year flood.' : 'Outside the hazard steps.'
        ) : (
          <>
            First {currentStory().verb} at <strong>{currentStory().steps[stats.firstStep]?.toLowerCase()}</strong>{' '}
            (step {stats.firstStep}). <span className="tabular">{fmt(stats.popInWater)}</span> residents
            live where it reaches.
          </>
        )}
      </p>
    </section>
  );
}
