// The planner page's bus pickup demand: where players keep asking for an evacuation bus pickup,
// from GET /api/planner/bus-demand. A list for planners, hexagons on the map, and downloads for GIS.
import { useEffect, useMemo, useState } from 'react';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { TextLayer } from '@deck.gl/layers';
import type { BusDemandReport, DemandArea } from '@shared/demand';
import { withAlpha } from '../map/layers';
import { tokens } from '../tokens';

const URL = '/api/planner/bus-demand?mode=flood';
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

/**
 * Demand areas on the map. A gap (no stop within a five-minute walk) is a --signal hexagon with a
 * thick ink edge; an area that already has a stop is a hollow --safe hexagon. The player count sits
 * in the middle, so the map does not rely on color alone.
 */
export function useBusDemandLayers(report: BusDemandReport | null) {
  return useMemo(() => {
    if (!report?.areas.length) return [];
    const { rgb } = tokens();
    return [
      new H3HexagonLayer<DemandArea>({
        id: 'bus-demand',
        data: report.areas,
        getHexagon: (a) => a.area,
        extruded: false,
        stroked: true,
        filled: true,
        getFillColor: (a) => (a.gap ? withAlpha(rgb.signal, 0.55) : withAlpha(rgb.safe, 0.12)),
        getLineColor: (a) => (a.gap ? rgb.ink : rgb.safe),
        getLineWidth: (a) => (a.gap ? 3 : 2),
        lineWidthUnits: 'pixels',
      }),
      new TextLayer<DemandArea>({
        id: 'bus-demand-count',
        data: report.areas,
        getPosition: (a) => [a.lon, a.lat],
        getText: (a) => String(a.players),
        getSize: 15,
        getColor: rgb.ink,
        fontFamily: '"Big Shoulders Display", "Arial Narrow", sans-serif',
        fontWeight: 800,
        outlineWidth: 3,
        outlineColor: withAlpha(rgb.bond, 1),
        fontSettings: { sdf: true },
      }),
    ];
  }, [report]);
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const distance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

export function BusDemandPanel({ report, error }: State) {
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
      <p className="text-15">{report.summary}</p>
      <dl className="grid grid-cols-3 gap-2 text-13">
        {[
          ['plays', report.plays],
          ['players', report.players],
          ['gaps', report.gaps],
        ].map(([label, n]) => (
          <div key={label} className="flex flex-col-reverse border-(length:--rule) border-ink bg-bond px-2 py-1">
            <dt>{label}</dt>
            <dd className="font-display text-32 leading-none font-extrabold tabular-nums">{fmt(n as number)}</dd>
          </div>
        ))}
      </dl>
      {report.areas.length > 0 && (
        <ol className="grid gap-2">
          {report.areas.map((a) => (
            <li key={a.area} className="grid gap-1 border-(length:--rule) border-ink bg-bond px-3 py-2 text-13">
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
              <p>{a.reason}</p>
            </li>
          ))}
        </ol>
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
        <p className="mt-1">{report.method}</p>
        <p className="mt-1">
          Bus stops: {report.transitSources.map((s) => `${s.agency} (${fmt(s.stops)} stops, feed to ${s.feedEnd ?? 'unknown'})`).join(', ')}.
          {stale.length > 0 && ` ${stale.map((s) => s.agency).join(' and ')} has no newer feed published, so recent stops may be missing.`}
        </p>
      </details>
    </section>
  );
}
