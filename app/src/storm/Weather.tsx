// The storm's weather over the map (DESIGN.md "Motion", storm): the wipe into the night, rain, and
// lightning. All three are off under prefers-reduced-motion and never take pointer input.
import { useEffect, useRef } from 'react';
import { rgba, tint, tokens } from '../tokens';
import { FINAL_FLOOD_STEP } from '@shared/config';
import { buzz, playPowerDown, playRumble, playThunder, startRain, stopRain } from '../ui/sound';
import { CLEAR_MS, STORM_MS, WIPE_MS, stepStart } from './sim';

/** A fast ink wipe across the screen; the storm's light lands under it (map/mood.ts). */
export function Wipe() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = el.animate(
      [{ transform: 'translateX(-115%) skewX(-12deg)' }, { transform: 'translateX(115%) skewX(-12deg)' }],
      { duration: WIPE_MS, easing: 'cubic-bezier(.6,0,.4,1)', fill: 'forwards' },
    );
    return () => anim.cancel();
  }, []);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        ref={ref}
        className="absolute inset-y-0 -left-[10%] flex w-[120%]"
        style={{ transform: 'translateX(-115%) skewX(-12deg)' }}
      >
        <div className="w-6 bg-signal" />
        <div className="flex-1 bg-ink" />
        <div className="w-6 bg-signal" />
      </div>
    </div>
  );
}

/**
 * Rain streaks: one canvas path per frame at device pixel ratio 1, so it costs almost nothing.
 * Pale on the night map, ink on the day map (`night` says which, at storm time t).
 */
export function Rain({ stormAt, night }: { stormAt: number; night: (t: number) => boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const nightRef = useRef(night);
  nightRef.current = night;
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    let w = 0;
    let h = 0;
    let drops: { x: number; y: number; len: number; v: number }[] = [];
    const SLANT = 0.22;
    const resize = () => {
      w = canvas.width = canvas.clientWidth;
      h = canvas.height = canvas.clientHeight;
      const n = Math.min(520, Math.round((w * h) / 3600));
      drops = Array.from({ length: n }, () => ({
        x: Math.random() * (w + h * SLANT),
        y: Math.random() * h,
        len: 10 + Math.random() * 14,
        v: 900 + Math.random() * 500,
      }));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const { rgb } = tokens();
    g.lineWidth = 1;
    let prev = performance.now();
    let raf = 0;
    /** 0 on the day map, 1 at night; eases across dusk and dawn with the map. */
    let dark = nightRef.current(performance.now() - stormAt) ? 1 : 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const t = now - stormAt;
      // Fades in over a second; stops as the storm clears.
      const alpha = Math.min(1, t / 1000) * Math.max(0, 1 - (t - STORM_MS) / CLEAR_MS);
      g.clearRect(0, 0, w, h);
      if (alpha <= 0 && t > STORM_MS) return;
      dark += ((nightRef.current(t) ? 1 : 0) - dark) * Math.min(1, dt * 2);
      g.strokeStyle = rgba(tint(rgb.ink, rgb['storm-label'], dark), (0.3 + 0.08 * dark) * alpha);
      g.beginPath();
      for (const d of drops) {
        d.y += d.v * dt;
        d.x -= d.v * SLANT * dt;
        if (d.y - d.len > h || d.x < -20) {
          d.y = -Math.random() * 40;
          d.x = Math.random() * (w + h * SLANT);
        }
        g.moveTo(d.x, d.y);
        g.lineTo(d.x + d.len * SLANT, d.y - d.len);
      }
      g.stroke();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    startRain();
    const stopAt = window.setTimeout(() => stopRain(CLEAR_MS), Math.max(0, stormAt + STORM_MS - performance.now()));
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearTimeout(stopAt);
      stopRain(300);
    };
  }, [stormAt]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/** Shake the map (not the HUD) with a decaying jitter: the earthquake and its aftershocks. */
function shakeMap(px: number, ms: number) {
  const el = document.querySelector<HTMLElement>('.maplibregl-map')?.parentElement;
  if (!el) return;
  const anim = el.animate(
    Array.from({ length: 24 }, (_, k) => {
      const a = px * (1 - k / 24) ** 1.5;
      return { transform: `translate(${(Math.random() * 2 - 1) * a}px, ${(Math.random() * 2 - 1) * a}px)` };
    }).concat([{ transform: 'translate(0, 0)' }]),
    { duration: ms, easing: 'linear' },
  );
  return () => anim.cancel();
}

/**
 * The earthquake (San Francisco): the main shock as the storm clock starts, an aftershock at each
 * step. The map shakes, the ground roars, phones buzz. Off under prefers-reduced-motion (sound stays).
 */
export function Quake({ stormAt, reduce }: { stormAt: number; reduce: boolean }) {
  useEffect(() => {
    const timers: number[] = [];
    const undo: (() => void)[] = [];
    const at = (ms: number, fn: () => void) => {
      const wait = stormAt + ms - performance.now();
      if (wait > -250) timers.push(window.setTimeout(fn, Math.max(0, wait)));
    };
    const quake = (px: number, ms: number, strength: number, pattern: number[]) => {
      playRumble(ms / 1000 + 1.2, strength);
      buzz(pattern);
      if (!reduce) {
        const stop = shakeMap(px, ms);
        if (stop) undo.push(stop);
      }
    };
    at(300, () => quake(16, 3200, 1, [600, 120, 400, 120, 800]));
    for (let k = 1; k <= FINAL_FLOOD_STEP; k++) at(stepStart(k) + 200, () => quake(5 + 2 * k, 1500, 0.45, [200, 80, 200]));
    return () => {
      timers.forEach(clearTimeout);
      undo.forEach((f) => f());
    };
  }, [stormAt, reduce]);
  return null;
}

/**
 * The heat wave (New York): a flat heat tint that breathes, and the blackout when the grid fails at
 * step 2 (the city flickers dark, the hum drops). Flat colour only, as DESIGN.md asks.
 */
export function Heat({ stormAt, reduce }: { stormAt: number; reduce: boolean }) {
  const tint = useRef<HTMLDivElement>(null);
  const dark = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const anims: Animation[] = [];
    if (tint.current && !reduce)
      anims.push(tint.current.animate([{ opacity: 0.06 }, { opacity: 0.16 }, { opacity: 0.06 }], { duration: 4200, iterations: Infinity, easing: 'ease-in-out' }));
    const wait = stormAt + stepStart(2) + 300 - performance.now();
    const timer = window.setTimeout(() => {
      playPowerDown();
      buzz([200, 100, 200]);
      if (dark.current)
        anims.push(
          dark.current.animate(
            reduce ? [{ opacity: 0 }, { opacity: 0.5 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 0.7 }, { opacity: 0.1 }, { opacity: 0.75 }, { opacity: 0.2 }, { opacity: 0.6 }, { opacity: 0 }],
            { duration: 1600, easing: 'linear' },
          ),
        );
    }, Math.max(0, wait));
    return () => {
      clearTimeout(timer);
      anims.forEach((a) => a.cancel());
    };
  }, [stormAt, reduce]);
  return (
    <>
      <div ref={tint} aria-hidden className="pointer-events-none absolute inset-0 bg-alarm opacity-0 mix-blend-multiply" />
      <div ref={dark} aria-hidden className="pointer-events-none absolute inset-0 bg-ink opacity-0" />
    </>
  );
}

/**
 * Occasional lightning that lights the whole map: two quick flashes per strike, strikes 3.5 to 7 s
 * apart, never full white (DESIGN.md "Accessibility floor"). Thunder follows.
 */
export function Lightning({ stormAt }: { stormAt: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    let anim: Animation | null = null;
    const strike = () => {
      const t = performance.now() - stormAt;
      if (t > STORM_MS - 1200) return;
      anim = el.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 0.5, offset: 0.08 },
          { opacity: 0.08, offset: 0.25 },
          { opacity: 0.32, offset: 0.4 },
          { opacity: 0, offset: 1 },
        ],
        { duration: 520, easing: 'linear' },
      );
      const delay = 0.35 + Math.random() * 0.8;
      playThunder(delay);
      window.setTimeout(() => buzz([60, 40, 140]), delay * 1000);
      timer = window.setTimeout(strike, 3500 + Math.random() * 3500);
    };
    timer = window.setTimeout(strike, Math.max(0, stormAt + 2600 - performance.now()));
    return () => {
      clearTimeout(timer);
      anim?.cancel();
    };
  }, [stormAt]);
  return <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 bg-bond opacity-0 mix-blend-screen" />;
}
