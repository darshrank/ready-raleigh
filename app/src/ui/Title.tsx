// The title and briefing (DESIGN.md "Layouts", title): Raleigh slowly orbiting in 3D behind the
// name, then the scenario as a large type card with one button. The camera then flies down.
import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { motion, useReducedMotion } from 'motion/react';
import { BUDGET, PLANNING_SECONDS } from '@shared/config';
import { money } from './format';
import { PLATE, SoundButton } from './Hud';
import { unlockAudio } from './sound';

/** Downtown Raleigh, close enough for 3D buildings (the tiles have them from zoom 13). */
const ORBIT_CENTER: [number, number] = [-78.6405, 35.7775];
const ORBIT_PITCH = 60;
/** Degrees per second: one turn in four minutes. */
const ORBIT_SPEED = 1.5;

/** Orbit the camera around downtown while `active`. With reduced motion it holds still. */
export function useTitleOrbit(map: MapLibreMap | null, active: boolean, phone: boolean) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!map || !active) return;
    // Orbit around the part of the screen the title plates leave open: right half, or top on a phone.
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const padding = phone ? { top: 0, right: 0, left: 0, bottom: Math.round(h * 0.45) } : { top: 0, right: 0, bottom: 0, left: Math.round(Math.min(720, w * 0.46)) };
    map.jumpTo({ center: ORBIT_CENTER, zoom: phone ? 13.8 : 14.4, pitch: ORBIT_PITCH, bearing: -30, padding });
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
      map.setBearing(map.getBearing() + ORBIT_SPEED * dt);
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

export function Title({ ready, error, onStart }: { ready: boolean; error: string | null; onStart: () => void }) {
  const reduce = useReducedMotion();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ready) button.current?.focus({ preventScroll: true });
  }, [ready]);
  const appear = (delay: number) =>
    reduce ? {} : { initial: { y: 40, opacity: 0 }, animate: { y: 0, opacity: 1 }, transition: { duration: 0.5, delay, ease: 'easeOut' as const } };

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-6 p-4 lg:p-10">
      <div className="flex items-start justify-between gap-3">
        <motion.h1 {...appear(0.1)} className={PLATE + ' px-4 py-3 font-display leading-[0.82] font-extrabold lg:px-6 lg:py-5'}>
          <span className="block text-72 lg:text-120">Ready</span>
          <span className="block text-72 lg:text-120">Raleigh</span>
        </motion.h1>
        <div className="pointer-events-auto">
          <SoundButton />
        </div>
      </div>

      <motion.section
        {...appear(0.9)}
        aria-labelledby="briefing"
        className={PLATE + ' pointer-events-auto w-full max-w-xl p-5 lg:p-7'}
      >
        <h2 id="briefing" className="font-display text-48 leading-[1.02] font-extrabold">
          Hurricane approaching.
          <br />
          72 hours of rain.
          <br />
          <span className="bg-signal px-1 box-decoration-clone">
            You have {money(BUDGET)} and {minutes} minutes.
          </span>
        </h2>
        <p className="mt-3 max-w-lg text-15 lg:text-18">
          Open shelters, send buses and protect roads before the creeks leave their banks. Then watch the storm test
          your plan on real Raleigh data.
        </p>
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
