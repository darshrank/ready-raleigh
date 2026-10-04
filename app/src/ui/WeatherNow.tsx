// "Weather right now" on the title screen: the city's real conditions from the nearest NWS station,
// polled by the server into Tiger Data. The storm that follows is a simulation; this plate is the
// real sky today. Without the server (or before the first poll) it shows nothing.
import { useEffect, useState } from 'react';
import { type CityWeather, fetchWeather } from '../api';
import type { CityId } from '../cities';
import { PLATE } from './Hud';

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const inches = (mm: number) => (mm / 25.4 < 0.01 && mm > 0 ? '< 0.01' : (mm / 25.4).toFixed(2));

function ago(iso: string, now = Date.now()) {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

/** The last 24 hours of temperature as a small line, in °F. */
function Trend({ points }: { points: CityWeather['tempTrend'] }) {
  if (points.length < 3) return null;
  const f = points.map((p) => p.tempC * 1.8 + 32);
  const [lo, hi] = [Math.min(...f), Math.max(...f)];
  const w = 120;
  const h = 34;
  const span = Math.max(hi - lo, 1);
  const d = f.map((v, k) => `${((k / (f.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - lo) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return (
    <figure className="shrink-0 short:hidden">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Temperature over the last 24 hours, from ${Math.round(lo)} to ${Math.round(hi)} °F`}>
        <polyline points={d} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="tabular text-13 leading-none">24 h: {Math.round(lo)}–{Math.round(hi)}°F</figcaption>
    </figure>
  );
}

/** The city's weather now, fetched once per city; null while loading or without the server. */
export function useCityWeather(city: CityId): CityWeather | null {
  const [w, setW] = useState<CityWeather | null>(null);
  useEffect(() => {
    let on = true;
    setW(null);
    void fetchWeather(city).then((x) => on && setW(x));
    return () => {
      on = false;
    };
  }, [city]);
  return w && !w.stale && w.tempF !== null && w.observedAt ? w : null;
}

/** The full plate (wide screens), or one compact row (phones, above the briefing card). */
export function WeatherNow({ w, name, compact = false, className = '' }: { w: CityWeather; name: string; compact?: boolean; className?: string }) {
  const details = [
    w.windMph !== null ? `Wind ${w.windMph} mph` : null,
    w.humidityPct !== null ? `Humidity ${w.humidityPct}%` : null,
    w.rainNext24hMm === null ? null : w.rainNext24hMm === 0 ? 'No rain in the next 24 h' : `Rain next 24 h ${inches(w.rainNext24hMm)} in`,
  ].filter(Boolean);

  if (compact) {
    return (
      <section aria-label={`Weather right now in ${name}`} className={PLATE + ' pointer-events-auto flex w-full items-center gap-3 px-3 py-2 ' + className}>
        <p className="tabular font-display text-32 leading-none font-extrabold">{w.tempF}°F</p>
        <div className="min-w-0 text-13 leading-tight">
          <p className="font-semibold">
            <span aria-hidden className="mr-1.5 inline-block size-2 border-2 border-ink bg-signal" />
            Live in {name}{w.conditions ? `: ${sentence(w.conditions)}` : ''}
          </p>
          <p>
            NWS {w.station}, {ago(w.observedAt!)}, via Tiger Data
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={`Weather right now in ${name}`} className={PLATE + ' pointer-events-auto w-full max-w-md p-3 lg:px-4 ' + className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-13">
        <p className="font-semibold tracking-wide uppercase">
          <span aria-hidden className="mr-1.5 inline-block size-2.5 border-2 border-ink bg-signal align-[-1px]" />
          Weather right now
        </p>
        <p>
          NWS {w.station}, {ago(w.observedAt!)}
        </p>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <p className="tabular font-display text-48 leading-none font-extrabold short:text-32">{w.tempF}°F</p>
        <div className="min-w-0 flex-1 text-15 leading-snug short:text-13">
          {w.conditions && <p className="font-semibold">{sentence(w.conditions)}</p>}
          {details.length > 0 && <p className="tabular text-13">{details.join(' · ')}</p>}
        </div>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-13 leading-snug">Real readings, stored in Tiger Data. The storm in this game is a simulation.</p>
        <Trend points={w.tempTrend} />
      </div>
    </section>
  );
}
