// The title and briefing (DESIGN.md "Layouts", title): the city slowly orbiting in 3D behind the
// name, then the scenario as a large type card with one button. The camera then flies down.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BUDGET, PLANNING_SECONDS } from '@shared/config';
import type { CameraStop } from '../cities';
import { currentStory, type BriefingLine, type Story } from '../story';
import { money } from './format';
import { PLATE, SoundButton } from './Hud';
import { audioRunning, unlockAudio } from './sound';
import { hush, prefetchSpeech, say } from './voice';

const ORBIT_PITCH = 60;
/** Degrees per second: one turn in four minutes. */
const ORBIT_SPEED = 1.5;

/**
 * Where the title orbit starts, around the part of the screen the title plates leave open (right
 * half, or the top on a phone). The landing globe flies here, so the hand-off is seamless.
 */
export function orbitCamera(w: number, h: number, phone: boolean, story: Story = currentStory()) {
  const padding = phone ? { top: 0, right: 0, left: 0, bottom: Math.round(h * 0.45) } : { top: 0, right: 0, bottom: 0, left: Math.round(Math.min(720, w * 0.46)) };
  // Downtown, close enough for 3D buildings (the tiles have them from zoom 13).
  return { center: story.orbit, zoom: phone ? 13.8 : 14.4, pitch: ORBIT_PITCH, bearing: -30, padding };
}

/** Orbit the camera around downtown while `active`. With reduced motion it holds still. */
export function useTitleOrbit(map: MapLibreMap | null, active: boolean, phone: boolean) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!map || !active) return;
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    map.jumpTo(orbitCamera(w, h, phone));
    // Leaving the title: drop the padding without moving the view, so the flight down starts smooth.
    const unpad = () => {
      const c = map.unproject([map.getContainer().clientWidth / 2, map.getContainer().clientHeight / 2]);
      map.jumpTo({ center: c, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
    };
    if (reduce) return unpad;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      // A flight (the briefing tour) owns the camera; setBearing would cut it short.
      if (!map.isMoving()) map.setBearing(map.getBearing() + ORBIT_SPEED * dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      unpad();
    };
  }, [map, active, phone, reduce]);
}

const minutes = Math.round(PLANNING_SECONDS / 60);

/**
 * The briefing tour: each line is spoken while the camera flies to its stop, then the camera
 * settles back into the orbit. Grabbing the map ends the flights (the voice goes on).
 * `onStop` names the stop on screen.
 */
export function useBriefingTour(
  map: MapLibreMap | null,
  active: boolean,
  phone: boolean,
  lines: BriefingLine[],
  onStop: (label: string | null) => void,
) {
  const reduce = useReducedMotion();
  const [started, setStarted] = useState(false);
  const start = useCallback(() => {
    unlockAudio();
    setStarted(true);
  }, []);
  // Coming from the globe, audio is already unlocked: start at once.
  useEffect(() => {
    if (active && audioRunning()) setStarted(true);
  }, [active]);

  useEffect(() => {
    if (!map || !active || !started) return;
    let cancelled = false;
    let grabbed = false;
    const onMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) grabbed = true;
    };
    map.on('movestart', onMove);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const home = orbitCamera(w, h, phone);
    let at: CameraStop | null = null;
    const fly = (s: CameraStop | null) => {
      onStop(s?.label ?? null);
      if (cancelled || grabbed || s === at) return;
      at = s;
      const cam = s ? { center: s.center, zoom: phone ? s.zoom - 0.6 : s.zoom, pitch: s.pitch, bearing: s.bearing, padding: home.padding } : home;
      if (reduce) map.jumpTo(cam);
      else map.flyTo({ ...cam, duration: 2800, curve: 1.3, essential: true });
    };
    void prefetchSpeech(lines.map((l) => l.text), 'narrator');
    void (async () => {
      for (const line of lines) {
        if (cancelled) return;
        fly(line.stop);
        await say(line.text, 'narrator');
      }
      if (!cancelled) fly(null);
    })();
    return () => {
      cancelled = true;
      map.off('movestart', onMove);
      hush();
      onStop(null);
    };
  }, [map, active, started, phone, lines, onStop, reduce]);

  return { started, start };
}

export function Title({
  ready,
  error,
  onStart,
  stop = null,
  listen,
}: {
  ready: boolean;
  error: string | null;
  onStart: () => void;
  /** The tour stop on screen, named on a sticker. */
  stop?: string | null;
  /** Start the narrated tour when audio was not unlocked yet (opened /solo directly). */
  listen?: { started: boolean; start: () => void };
}) {
  const reduce = useReducedMotion();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ready) button.current?.focus({ preventScroll: true });
  }, [ready]);
  const appear = (delay: number) =>
    reduce ? {} : { initial: { y: 40, opacity: 0 }, animate: { y: 0, opacity: 1 }, transition: { duration: 0.5, delay, ease: 'easeOut' as const } };
  const story = currentStory();

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-6 p-4 lg:p-10">
      <div className="flex items-start justify-between gap-3">
        <motion.h1 {...appear(0.1)} className={PLATE + ' px-4 py-3 font-display leading-[0.82] font-extrabold lg:px-6 lg:py-5'}>
          <span className="block text-72 lg:text-120">Ready</span>
          <span className="block text-72 lg:text-120">{story.name.replace(/ City$/, '')}</span>
        </motion.h1>
        <div className="pointer-events-auto">
          <SoundButton />
        </div>
      </div>

      <AnimatePresence>
        {stop && (
          <motion.p
            key={stop}
            initial={reduce ? false : { y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            className={PLATE + ' absolute top-[34%] right-4 bg-signal px-3 py-1.5 font-display text-24 leading-none font-extrabold lg:right-[12%] lg:text-32'}
          >
            {stop}
          </motion.p>
        )}
      </AnimatePresence>

      <motion.section
        {...appear(0.9)}
        aria-labelledby="briefing"
        className={PLATE + ' pointer-events-auto w-full max-w-xl p-5 lg:p-7'}
      >
        <h2 id="briefing" className="font-display text-48 leading-[1.02] font-extrabold">
          {story.title[0]}
          <br />
          {story.title[1]}
          <br />
          <span className="bg-signal px-1 box-decoration-clone">
            You have {money(BUDGET)} and {minutes} minutes.
          </span>
        </h2>
        <p className="mt-3 max-w-lg text-15 lg:text-18">{story.body}</p>
        {listen && !listen.started && ready && (
          <button
            type="button"
            onClick={listen.start}
            className="mt-3 inline-flex items-center gap-2 border-(length:--rule) border-ink bg-bond px-3 py-1.5 text-15 font-semibold shadow-piece hover:bg-chalk"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden className="fill-ink">
              <path d="M3 7h3l5-4v14l-5-4H3z" />
            </svg>
            Hear the briefing
          </button>
        )}
        {error ? (
          <p className="mt-5 text-15">Could not load the map data ({error}). Reload the page to try again.</p>
        ) : (
          <button
            ref={button}
            type="button"
            disabled={!ready}
            onClick={() => {
              unlockAudio();
              onStart();
            }}
            className="mt-5 w-full border-(length:--rule) border-ink bg-ink px-6 py-3 font-display text-32 leading-none font-extrabold text-signal shadow-piece hover:bg-signal hover:text-ink active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-60 sm:w-auto lg:py-4 lg:text-48"
          >
            {ready ? 'Start planning' : 'Loading the map'}
          </button>
        )}
      </motion.section>
    </div>
  );
}
