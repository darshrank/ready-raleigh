// The title and briefing (DESIGN.md "Layouts", title): the city slowly orbiting in 3D behind the
// name, then the scenario as a large type card with one button. The camera then flies down.
import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BUDGET, PLANNING_SECONDS } from '@shared/config';
import type { CameraStop } from '../cities';
import { currentStory, type BriefingLine, type Story } from '../story';
import { money } from './format';
import { PLATE, SatelliteButton, SoundButton } from './Hud';
import { audioRunning, unlockAudio } from './sound';
import { hush, prefetchSpeech, say } from './voice';
import { MenuButton } from './Exit';

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
  // Coming from the globe, audio is already unlocked: start at once. Opened directly, the first
  // tap or key on the title unlocks the audio (browsers need a gesture) and starts it.
  useEffect(() => {
    if (!active || started) return;
    if (audioRunning()) return setStarted(true);
    const go = () => {
      unlockAudio();
      setStarted(true);
    };
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
    return () => {
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
  }, [active, started]);

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
}

export function Title({
  ready,
  error,
  onStart,
  stop = null,
}: {
  ready: boolean;
  error: string | null;
  onStart: () => void;
  /** The tour stop on screen, named on a sticker. */
  stop?: string | null;
}) {
  const reduce = useReducedMotion();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ready) button.current?.focus({ preventScroll: true });
  }, [ready]);
  const appear = (delay: number) =>
    reduce ? {} : { initial: { y: 40, opacity: 0 }, animate: { y: 0, opacity: 1 }, transition: { duration: 0.5, delay, ease: 'easeOut' as const } };
  const story = currentStory();

  // Sized by the window's height as well as its width, so the briefing card always fits on screen.
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-4 p-4 lg:gap-6 lg:p-8 lg:tall:p-10">
      <div className="flex items-start justify-between gap-3">
        <motion.h1 {...appear(0.1)} className={PLATE + ' px-4 py-3 font-display leading-[0.82] font-extrabold lg:px-6 lg:py-4'}>
          <span className="block text-72 short:text-48 lg:tall:text-120">Mayday</span>
          <span className="block text-72 short:text-48 lg:tall:text-120">Mayor</span>
          <span className="mt-2 block border-t-(length:--rule) border-ink pt-2 text-24 leading-none sm:text-32 lg:tall:text-48">{story.name}</span>
        </motion.h1>
        {/* Wraps under itself beside the big title on a phone. */}
        <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
          <MenuButton />
          <SatelliteButton />
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
        className={PLATE + ' pointer-events-auto w-full max-w-xl p-5 short:p-4 lg:max-w-2xl lg:p-7 lg:short:p-5'}
      >
        <h2 id="briefing" className="font-display text-32 leading-[1.02] font-extrabold sm:text-48 short:text-32">
          {story.title[0]}
          <br />
          {story.title[1]}
          <br />
          <span className="bg-signal px-1 box-decoration-clone">
            You have {money(BUDGET)} and {minutes} minutes.
          </span>
        </h2>
        <p className="mt-3 max-w-xl text-15 short:mt-2 lg:text-18 lg:short:text-15">{story.body}</p>
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
            className="mt-5 w-full border-(length:--rule) border-ink bg-ink px-6 py-3 font-display text-32 leading-none font-extrabold text-signal shadow-piece hover:bg-signal hover:text-ink active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-60 short:mt-3 sm:w-auto lg:tall:py-4 lg:tall:text-48"
          >
            {ready ? 'Start planning' : 'Loading the map'}
          </button>
        )}
      </motion.section>
    </div>
  );
}
