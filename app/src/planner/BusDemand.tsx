// The planner page's bus pickup demand: where players keep asking for an evacuation bus pickup,
// from GET /api/planner/bus-demand. A list for planners, hexagons on the map, and downloads for GIS.
import { useEffect, useState } from 'react';
import type { BusDemandReport } from '@shared/demand';
import { currentCityId } from '../story';
import { type Focus, type SetFocus, focusRow } from './focus';
import type { Peg } from './pegs';

// The city the page shows (?city=, Raleigh by default), like the map.
const URL = `/api/planner/bus-demand?mode=flood&city=${currentCityId()}`;
const REFRESH_MS = 15_000;

type State = { report: BusDemandReport | null; error: boolean };

/** The report, refreshed every 15 s so new plays show up while the page is open. */
export function useBusDemand(): State {
  const [state, setState] = useState<State>({ report: null, error: false });
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(URL, { signal: AbortSignal.timeout(10_000) })
        .then((r) => (r.ok ? (r.json() as Promise<BusDemandReport>) : Promise.reject(new Error(String(r.status)))))
        .then((report) => live && setState({ report, error: false }))
        .catch(() => live && setState((s) => ({ report: s.report, error: true })));
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return state;
}

/** Demand areas as bus pegs: blue where a stop is near, pink at a gap. */
export function busDemandPegs(report: BusDemandReport | null): Peg[] {
  return (report?.areas ?? []).map((a) => ({
    key: `bus:${a.area}`, lon: a.lon, lat: a.lat, symbol: 'bus_pickup', face: a.gap ? 'alarm' : 'flood',
    // Down and right of the area's center: a top-place bus pickup often sits on the same spot. No
    // number badge (numbers on the map are ranks); the player count is in the rail and the label.
    label: `${a.hood}, ${a.players} players`, size: 34, offset: [20, 20] as [number, number],
  }));
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const distance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/** Areas listed before "Show all". */
const SHOWN = 3;

export function BusDemandPanel({ report, error, focus, setFocus }: State & { focus: Focus | null; setFocus: SetFocus }) {
  const [all, setAll] = useState(false);
  if (!report) {
    return (
      <section className="grid gap-2">
        <h2 className="text-18 font-semibold">Bus pickup demand</h2>
        <p className="text-15">
          {error ? 'The planner server is off, so there is no player data to show. The game still works.' : 'Loading player data.'}
        </p>
      </section>
    );
  }
  const stale = report.transitSources.filter((s) => s.expired);
  return (
    <section className="grid gap-3" aria-labelledby="bus-demand-title">
      <h2 id="bus-demand-title" className="text-18 font-semibold">Bus pickup demand</h2>
      <p className="text-13">Where players keep asking for an evacuation bus pickup (blue bus pegs; pink where no stop is within a five-minute walk).</p>
      <dl className="grid grid-cols-3 gap-2 text-13">
        {[
          ['plays', report.plays],
          ['players', report.players],
          ['gaps', report.gaps],
        ].map(([label, n]) => (
          <div key={label} className="flex flex-col-reverse border-(length:--rule) border-ink bg-bond px-2 py-1">
            <dt>{label}</dt>
            <dd className="font-display text-24 leading-none font-extrabold tabular-nums">{fmt(n as number)}</dd>
          </div>
        ))}
      </dl>
      {report.areas.length > 0 && (
        <ol className="grid gap-1.5">
          {(all ? report.areas : report.areas.slice(0, SHOWN)).map((a) => (
            <li
              key={a.area}
              title={a.reason}
              {...focusRow(`bus:${a.area}`, focus, setFocus)}
              className={`grid cursor-pointer gap-0.5 border-(length:--rule) border-ink px-2 py-1.5 text-13 ${focus?.key === `bus:${a.area}` ? 'bg-signal' : 'bg-bond'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-15 font-semibold">
                  {a.rank}. {a.hood}
                </span>
                <span
                  className={
                    'shrink-0 border-(length:--rule) px-1.5 font-semibold ' +
                    (a.gap ? 'border-ink bg-signal' : 'border-safe')
                  }
                >
                  {a.gap ? 'No stop nearby' : 'Stop nearby'}
                </span>
              </div>
              <p className="tabular-nums">
                {fmt(a.players)} players ({Math.round(100 * a.playerShare)}%) · {fmt(a.noCarHouseholds)}{' '}
                {Math.round(a.noCarHouseholds) === 1 ? 'household' : 'households'} with no car
                {a.nearestStop ? ` · nearest stop ${distance(a.nearestStop.meters)}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
      {report.areas.length > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="justify-self-start text-13 font-semibold underline">
          {all ? 'Show fewer' : `Show all ${report.areas.length} areas`}
        </button>
      )}
      <div className="flex flex-wrap gap-2 text-15 font-semibold">
        <a href={`${URL}&format=csv`} download className="border-(length:--rule) border-ink bg-bond px-3 py-1 shadow-piece hover:bg-chalk">
          Download CSV
        </a>
        <a href={`${URL}&format=geojson`} download className="border-(length:--rule) border-ink bg-bond px-3 py-1 shadow-piece hover:bg-chalk">
          Download GeoJSON
        </a>
      </div>
      <details className="text-13">
        <summary className="cursor-pointer font-semibold">How this is counted</summary>
        <p className="mt-1">{report.summary}</p>
        <p className="mt-1">{report.method}</p>
        <p className="mt-1">
          Bus stops: {report.transitSources.map((s) => `${s.agency} (${fmt(s.stops)} stops, feed to ${s.feedEnd ?? 'unknown'})`).join(', ')}.
          {stale.length > 0 && ` ${stale.map((s) => s.agency).join(' and ')} has no newer feed published, so recent stops may be missing.`}
        </p>
      </details>
    </section>
  );
}
