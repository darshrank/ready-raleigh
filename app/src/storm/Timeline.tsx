// The storm timeline: the city's own clock (story.ts), its day, dusk, night and dawn as bands, a
// pin for every step and every place the news helicopter goes, and a playhead. Like the counters,
// it animates from the storm clock with its own rAF loop and writes to the DOM directly.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FINAL_FLOOD_STEP } from '@shared/config';
import { currentStory } from '../story';
import { PLATE } from '../ui/Hud';
import { clockLabel, lightAt, lightBands, stormHour, type Light } from './clock';
import { STORM_MS, stepStart, type Storm } from './sim';

/** Flat sky inks: a pale day, gold at dusk and dawn, storm blue at night. */
const BAND_CLASS: Record<Light, string> = { day: 'bg-flood/25', dusk: 'bg-signal/60', night: 'bg-storm-land', dawn: 'bg-signal/60' };

export interface StormPin {
  at: number;
  label: string;
  kind: 'step' | 'event' | 'clear';
}

export function stormPins(storm: Storm): StormPin[] {
  const pins: StormPin[] = [];
  const steps = currentStory().steps;
  for (let k = 1; k <= FINAL_FLOOD_STEP; k++) pins.push({ at: stepStart(k), label: steps[k] ?? `Step ${k}`, kind: 'step' });
  for (const e of storm.events) pins.push({ at: e.hold, label: e.label, kind: 'event' });
  pins.push({ at: STORM_MS, label: currentStory().passed, kind: 'clear' });
  return pins.sort((a, b) => a.at - b.at);
}

export function StormTimeline({ storm, stormAt }: { storm: Storm; stormAt: number }) {
  const pins = useMemo(() => stormPins(storm), [storm]);
  const bands = useMemo(() => lightBands(), []);
  const headRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const [latest, setLatest] = useState<StormPin | null>(null);
  const [light, setLight] = useState<Light>(() => lightAt(stormHour(0)));

  useEffect(() => {
    let raf = 0;
    let shown = -1;
    let shownLight: Light | null = null;
    const tick = (now: number) => {
      const t = now - stormAt;
      const f = Math.min(1, Math.max(0, t / STORM_MS));
      if (headRef.current) headRef.current.style.left = `${f * 100}%`;
      const hour = stormHour(t);
      const text = clockLabel(hour);
      if (clockRef.current && clockRef.current.textContent !== text) clockRef.current.textContent = text;
      let k = -1;
      while (k + 1 < pins.length && pins[k + 1]!.at <= t) k++;
      if (k !== shown) {
        shown = k;
        setLatest(k >= 0 ? pins[k]! : null);
      }
      const l = lightAt(hour);
      if (l !== shownLight) {
        shownLight = l;
        setLight(l);
      }
      if (t <= STORM_MS + 200) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stormAt, pins]);

  return (
    <div className={PLATE + ' pointer-events-auto w-[min(640px,calc(100vw-1.5rem))] px-3 pt-2 pb-3'} aria-hidden>
      <div className="flex items-center gap-2">
        <SkyIcon light={light} />
        <span ref={clockRef} className="tabular font-display text-24 leading-none font-extrabold whitespace-nowrap">
          {clockLabel(stormHour(0))}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-15 font-semibold">{latest?.label ?? currentStory().band[0]}</span>
      </div>
      <div className="relative mt-2 h-4">
        <div className="absolute inset-0 flex overflow-hidden border-(length:--rule) border-ink">
          {bands.map((b) => (
            <div key={b.from} className={BAND_CLASS[b.light]} style={{ width: `${(b.to - b.from) * 100}%` }} />
          ))}
        </div>
        {pins.map((p) => (
          <span
            key={`${p.kind}-${p.at}`}
            className={
              'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-ink ' +
              (p.kind === 'event' ? 'size-3 rotate-45 bg-alarm' : p.kind === 'clear' ? 'size-3 rounded-full bg-signal' : 'h-5 w-1.5 bg-bond')
            }
            style={{ left: `${(p.at / STORM_MS) * 100}%` }}
          />
        ))}
        <div ref={headRef} className="absolute -top-1.5 bottom-[-6px] w-1 -translate-x-1/2 bg-ink" style={{ left: '0%' }} />
      </div>
    </div>
  );
}

function SkyIcon({ light }: { light: Light }) {
  if (light === 'night')
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
        <path d="M14 3a8 8 0 1 0 5 13A7 7 0 0 1 14 3z" className="fill-ink" />
      </svg>
    );
  if (light === 'day')
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0 stroke-ink" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="4.5" className="fill-signal" />
        <path d="M11 1.5v2.5M11 18v2.5M1.5 11H4M18 11h2.5M4.3 4.3l1.8 1.8M15.9 15.9l1.8 1.8M4.3 17.7l1.8-1.8M15.9 6.1l1.8-1.8" />
      </svg>
    );
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0 stroke-ink" strokeWidth="2">
      <path d="M2 15h18" />
      <path d="M6 15a5 5 0 0 1 10 0" className="fill-signal" />
      <path d="M11 4v3M4.5 7.5l2 2M17.5 7.5l-2 2" />
    </svg>
  );
}
