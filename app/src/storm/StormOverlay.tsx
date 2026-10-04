// What sits over the map during the storm: the broadcast band, the counters, and the results card.
// The band and counters animate from the storm clock with their own rAF loops, writing to the DOM
// directly, so React renders them once per step at most.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { FINAL_FLOOD_STEP } from '@shared/config';
import type { ScoreResult } from '@shared/types';
import { usePlan } from '../plan/store';
import { currentCityId, currentStory } from '../story';
import { GROW_MS, STORM_MS, TICK_MS, stepAt, stepStart, type Storm, type StormEvent } from './sim';
import { hush } from '../ui/voice';
import { leaveGame } from '../ui/Exit';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The flood step on screen, updated when the next one begins. */
function useStormStep(stormAt: number) {
  const [step, setStep] = useState(() => stepAt(performance.now() - stormAt));
  useEffect(() => {
    if (step >= FINAL_FLOOD_STEP) return;
    const wait = stormAt + stepStart(step + 1) - performance.now();
    const id = setTimeout(() => setStep(stepAt(performance.now() - stormAt)), Math.max(0, wait));
    return () => clearTimeout(id);
  }, [step, stormAt]);
  return step;
}

// Ticker speed in px/s: a calm base, faster while a new step's lines are still off screen.
const TICKER_BASE = 110;
const TICKER_MAX = 420;
const TICKER_CATCH_UP_S = 3;

/**
 * The emergency broadcast: an ink band that slides in once and scrolls the events of each step.
 * New lines join the end of the ticker; when it runs dry it repeats the latest step.
 */
export function Broadcast({ storm, stormAt, live }: { storm: Storm; stormAt: number; live: StormEvent | null }) {
  const reduce = useReducedMotion();
  const step = useStormStep(stormAt);
  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  const append = (lines: string[]) => {
    const strip = stripRef.current;
    if (!strip) return;
    for (const line of lines) {
      const item = document.createElement('span');
      item.className = 'shrink-0 whitespace-pre';
      item.textContent = `${line}   ·   `;
      strip.appendChild(item);
    }
  };

  // The ticker, outside React: each frame moves the strip and drops lines that have left the band.
  useEffect(() => {
    const track = trackRef.current;
    const strip = stripRef.current;
    if (reduce || !track || !strip) return;
    strip.replaceChildren();
    append(storm.band[stepRef.current] ?? []);
    let x = 0;
    let prev = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      let ahead = x + strip.scrollWidth - track.clientWidth;
      if (ahead < 40) {
        append(storm.band[stepRef.current] ?? []);
        ahead = x + strip.scrollWidth - track.clientWidth;
      }
      x -= Math.min(TICKER_MAX, Math.max(TICKER_BASE, ahead / TICKER_CATCH_UP_S)) * dt;
      let first = strip.firstElementChild as HTMLElement | null;
      while (first && x + first.offsetWidth < 0) {
        x += first.offsetWidth;
        first.remove();
        first = strip.firstElementChild as HTMLElement | null;
      }
      strip.style.transform = `translate3d(${x}px, 0, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The ticker starts once per storm; new steps append below.
  }, [storm, reduce]);

  // A new step: lines still waiting off the right edge are dropped, so the band stays current.
  const shown = useRef(step);
  useEffect(() => {
    const track = trackRef.current;
    const strip = stripRef.current;
    if (reduce || !track || !strip || step === shown.current) return;
    shown.current = step;
    const edge = track.getBoundingClientRect().right;
    for (const item of [...strip.children]) if (item.getBoundingClientRect().left > edge) item.remove();
    append(storm.band[step] ?? []);
  }, [step, storm, reduce]);

  return (
    <div>
    <motion.div
      initial={reduce ? false : { y: '-100%' }}
      animate={{ y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: reduce ? 0 : 0.5 }}
      className="flex items-stretch bg-ink font-display text-18 leading-none font-bold tracking-wide text-signal lg:text-24"
    >
      <p className="flex shrink-0 items-center bg-signal px-3 py-2 font-extrabold text-ink">EMERGENCY ALERT</p>
      {reduce ? (
        <p className="line-clamp-2 min-w-0 flex-1 px-3 py-2 lg:truncate">{(storm.band[step] ?? []).join(' · ')}</p>
      ) : (
        <div ref={trackRef} aria-hidden className="relative min-w-0 flex-1 overflow-hidden">
          <div ref={stripRef} className="absolute inset-y-0 left-0 flex items-center pl-3 will-change-transform" />
        </div>
      )}
      <p className="sr-only" role="status">
        {storm.spoken[step]}
      </p>
    </motion.div>
      <LiveCaption live={live} />
    </div>
  );
}

/** While the camera holds on an event: LIVE and the event's name, under the band. */
function LiveCaption({ live }: { live: StormEvent | null }) {
  const reduce = useReducedMotion();
  return (
    <div className="min-h-12 lg:min-h-16" aria-live="polite">
      {live && (
        <motion.p
          key={live.step}
          initial={reduce ? false : { x: '-100%' }}
          animate={{ x: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="inline-flex max-w-full items-stretch font-display leading-none font-extrabold tracking-wide"
        >
          <span className="flex items-center bg-alarm px-3 text-18 text-ink lg:text-24">LIVE</span>
          <span className="bg-bond px-3 py-2 text-24 leading-[1.05] text-ink lg:py-3 lg:text-32">{live.title}</span>
        </motion.p>
      )}
    </div>
  );
}

type CountKey = 'protectedPeople' | 'strandedPeople';

/** A counter's value at storm time `t`: each step ticks from the last step's number to its own. */
function countAt(storm: Storm, key: CountKey, t: number, reduce: boolean): number {
  let v = 0;
  let prev = 0;
  for (const s of storm.timeline) {
    const start = stepStart(s.step) + GROW_MS;
    if (t < start) break;
    v = prev + (s[key] - prev) * (reduce ? 1 : easeOut(clamp01((t - start) / TICK_MS)));
    prev = s[key];
  }
  return v;
}

/** 120 px counters for protected and stranded residents, ticking with the timeline. */
export function Counters({ storm, stormAt }: { storm: Storm; stormAt: number }) {
  const reduce = !!useReducedMotion();
  const protectedRef = useRef<HTMLSpanElement>(null);
  const strandedRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const end = stepStart(FINAL_FLOOD_STEP) + GROW_MS + TICK_MS;
    let raf = 0;
    const tick = (now: number) => {
      const t = now - stormAt;
      const write = (el: HTMLSpanElement | null, key: CountKey) => {
        const text = fmt(countAt(storm, key, t, reduce));
        if (el && el.textContent !== text) el.textContent = text;
      };
      write(protectedRef.current, 'protectedPeople');
      write(strandedRef.current, 'strandedPeople');
      if (t <= end) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [storm, stormAt, reduce]);

  const number = 'tabular font-display text-48 leading-none font-extrabold md:text-72 min-[1400px]:text-120';
  const panel = 'border-(length:--rule) border-ink bg-bond px-3 py-2 shadow-plate lg:px-5 lg:py-3';
  return (
    // Screen readers get the step's numbers from the band's status line.
    <div aria-hidden className="flex items-end justify-between gap-2 px-3 pt-3 pb-8 lg:px-6 lg:pt-6">
      <p className={panel}>
        <span ref={protectedRef} className={'block ' + number}>
          0
        </span>
        <span className="mt-1 flex items-center gap-2 text-15 font-semibold lg:text-24">
          <svg width="14" height="14" className="shrink-0 fill-safe">
            <circle cx="7" cy="7" r="6" />
          </svg>
          protected
        </span>
      </p>
      <p className={panel + ' text-right'}>
        <span ref={strandedRef} className={'block ' + number}>
          0
        </span>
        <span className="mt-1 flex items-center justify-end gap-2 text-15 font-semibold lg:text-24">
          <svg width="16" height="16" className="shrink-0 fill-none stroke-alarm" strokeWidth="2.5">
            <circle cx="8" cy="8" r="6" />
          </svg>
          stranded
        </span>
      </p>
    </div>
  );
}

/** The end of the storm: score, protected, stranded, Play again (same city) and Main menu. P8 replaces it with the full results. */
/** `footer` replaces "Play again" (rooms: the standing; the TV runs the next election). */
export function ResultsCard({ storm, result, footer, civic }: { storm: Storm; result: ScoreResult | null; footer?: ReactNode; civic?: ReactNode }) {
  const reset = usePlan((s) => s.reset);
  const reduce = useReducedMotion();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus({ preventScroll: true }), []);
  const last = storm.timeline[storm.timeline.length - 1];
  const prot = last?.protectedPeople ?? 0;
  const strand = last?.strandedPeople ?? 0;
  return (
    <motion.section
      aria-labelledby="results-title"
      initial={reduce ? false : { y: '120%' }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      // A room's standings plus the public record can outgrow a phone: the card scrolls inside itself.
      className="pointer-events-auto max-h-[calc(100dvh-5rem)] w-full max-w-md overflow-y-auto border-(length:--rule) border-ink bg-bond p-4 shadow-plate lg:p-6"
    >
      <h2 id="results-title" className="font-display text-32 font-extrabold">
        {currentStory().passed}
      </h2>
      <p className="mt-3 flex items-baseline gap-3">
        <span className="tabular font-display text-72 leading-none font-extrabold">{Math.round(result?.score ?? 0)}</span>
        <span className="text-18 font-semibold">out of 100</span>
      </p>
      <dl className="tabular mt-3 grid grid-cols-2 gap-3 border-t-(length:--rule) border-ink pt-3">
        <div>
          <dt className="text-13">Protected</dt>
          <dd className="font-display text-32 font-extrabold">{fmt(prot)}</dd>
        </div>
        <div>
          <dt className="text-13">Stranded</dt>
          <dd className="font-display text-32 font-extrabold">{fmt(strand)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-15">
        {(result?.baseline.protectedPeople ?? 0) >= 1
          ? `Existing shelters took ${fmt(result!.baseline.protectedPeople)}. Your plan reached ${fmt(prot - result!.baseline.protectedPeople)} of the ${fmt(prot + strand - result!.baseline.protectedPeople)} residents they could not.`
          : `Your plan reached ${Math.round(prot + strand > 0 ? (100 * prot) / (prot + strand) : 0)}% of the residents ${currentStory().cause} put at risk.`}
      </p>
      {civic}
      {/* The demo's last step: from one game to where the city should act, all residents' plans together. */}
      <a
        href={currentCityId() === 'raleigh' ? '/planner' : `/planner?city=${currentCityId()}`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center justify-between gap-3 border-(length:--rule) border-ink bg-flood px-3 py-2 font-display text-24 font-extrabold text-bond shadow-piece hover:bg-flood-deep"
      >
        <span>See where {currentStory().name} should act</span>
        <span aria-hidden>→</span>
      </a>
      {footer ?? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            ref={button}
            type="button"
            onClick={reset}
            className="border-(length:--rule) border-ink bg-ink px-4 py-3 text-left font-display text-24 font-extrabold text-signal hover:bg-bond hover:text-ink"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={leaveGame}
            className="border-(length:--rule) border-ink bg-bond px-4 py-3 text-left font-display text-24 font-extrabold text-ink hover:bg-chalk"
          >
            Main menu
          </button>
        </div>
      )}
    </motion.section>
  );
}

/** Jump the storm to its end. */
export function SkipStorm() {
  const skip = usePlan((s) => s.skipStorm);
  return (
    <button
      type="button"
      onClick={() => {
        hush(); // a report cut short; the last one may still finish when the storm ends on its own
        skip(STORM_MS);
      }}
      className="pointer-events-auto h-10 border-(length:--rule) border-ink bg-bond px-3 text-15 font-semibold shadow-piece hover:bg-chalk"
    >
      Skip to results
    </button>
  );
}
