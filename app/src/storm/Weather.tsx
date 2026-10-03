// The storm's weather over the map (DESIGN.md "Motion", storm): the wipe into the night, rain, and
// lightning. All three are off under prefers-reduced-motion and never take pointer input.
import { useEffect, useRef } from 'react';
import { tokens, rgba } from '../tokens';
import { playThunder, startRain, stopRain } from '../ui/sound';
import { CLEAR_MS, STORM_MS, WIPE_MS } from './sim';

/** A fast ink wipe across the screen; the map turns to night under it (storm/director.ts). */
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

/** Rain streaks: one canvas path per frame at device pixel ratio 1, so it costs almost nothing. */
export function Rain({ stormAt }: { stormAt: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
    g.strokeStyle = rgba(tokens().rgb['storm-label'], 0.38);
    g.lineWidth = 1;
    let prev = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const t = now - stormAt;
      // Fades in over a second; stops as the storm clears.
      const alpha = Math.min(1, t / 1000) * Math.max(0, 1 - (t - STORM_MS) / CLEAR_MS);
      g.clearRect(0, 0, w, h);
      if (alpha <= 0 && t > STORM_MS) return;
      g.strokeStyle = rgba(tokens().rgb['storm-label'], 0.38 * alpha);
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
      playThunder(0.35 + Math.random() * 0.8);
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
