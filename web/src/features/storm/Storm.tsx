"use client";

/**
 * Storm effects over the simulation, ported from the sakhi/visual-overhaul branch:
 *  - an ink wipe into the night as the storm starts (the night palette swaps under it),
 *  - rain streaks and lightning with thunder,
 *  - the "news helicopter": the camera flies to the storm's key events, circles each one under a
 *    LIVE caption, then pulls back over the city.
 * Sakhi's version ran on a fixed storm clock; here everything follows the simulation clock, so pause,
 * speed and scrubbing keep working. Reduced motion keeps only the caption. Rain and lightning only
 * play for rain-driven hazards (flood, coastal).
 */
import { Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SimEvent } from "@/lib/engine/simulate";
import { mapBus } from "@/lib/map-bus";
import { cfgOf, useGame } from "@/stores/game";
import { playAlert, playThunder, startRain, stopRain, unlockAudio, useSound } from "./sound";

const WIPE_MS = 900;
/** Real-time pacing of one helicopter stop. */
const FLY_MS = 1800;
const ORBIT_MS = 3200;
const BACK_MS = 1600;
const STORM_PITCH = 55;
const MAX_STOPS = 6;

export const isStormy = (type: string | undefined) => type === "flood" || type === "coastal";

export function Storm() {
  const phase = useGame((s) => s.phase);
  const type = useGame((s) => s.data?.cfg.hazard.type);
  const reduce = useGame((s) => s.reducedMotion);
  const active = phase === "simulating";
  const stormy = isStormy(type);
  const [caption, setCaption] = useState<SimEvent | null>(null);

  useEffect(() => {
    if (active && stormy) playAlert();
  }, [active, stormy]);

  if (!active) return null;
  return (
    <>
      {stormy && !reduce && <Wipe />}
      {stormy && !reduce && <Rain />}
      {stormy && !reduce && <Lightning />}
      <Director reduce={reduce} onCaption={setCaption} />
      <LiveCaption event={caption} />
      <SoundToggle />
    </>
  );
}

// ------------------------------------------------------------------ weather

function Wipe() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const anim = ref.current?.animate([{ transform: "translateX(-115%) skewX(-12deg)" }, { transform: "translateX(115%) skewX(-12deg)" }], {
      duration: WIPE_MS,
      easing: "cubic-bezier(.6,0,.4,1)",
      fill: "forwards",
    });
    return () => anim?.cancel();
  }, []);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div ref={ref} className="absolute inset-y-0 -left-[10%] flex w-[120%]" style={{ transform: "translateX(-115%) skewX(-12deg)" }}>
        <div className="w-6 bg-[var(--city)]" />
        <div className="flex-1 bg-[#050810]" />
        <div className="w-6 bg-[var(--city)]" />
      </div>
    </div>
  );
}

/** Rain fades out as the storm passes (last 15% of the scenario). */
function rainTarget() {
  const s = useGame.getState();
  const dur = cfgOf(s).durationHours;
  return s.phase === "simulating" && s.simHour < dur * 0.85 ? 1 : 0;
}

/** Rain streaks: one canvas path per frame at device pixel ratio 1, so it costs almost nothing. */
function Rain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    let w = 0;
    let h = 0;
    let drops: { x: number; y: number; len: number; v: number }[] = [];
    const SLANT = 0.22;
    const resize = () => {
      w = canvas.width = canvas.clientWidth;
      h = canvas.height = canvas.clientHeight;
      const n = Math.min(520, Math.round((w * h) / 3600));
      drops = Array.from({ length: n }, () => ({ x: Math.random() * (w + h * SLANT), y: Math.random() * h, len: 10 + Math.random() * 14, v: 900 + Math.random() * 500 }));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    g.lineWidth = 1;
    let alpha = 0;
    let raining = false;
    let prev = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const target = rainTarget();
      alpha += (target - alpha) * Math.min(1, dt * 1.5);
      if (target && !raining) {
        startRain();
        raining = true;
      } else if (!target && raining) {
        stopRain(1500);
        raining = false;
      }
      g.clearRect(0, 0, w, h);
      if (alpha > 0.01) {
        g.strokeStyle = `rgba(200,215,240,${0.38 * alpha})`;
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
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      stopRain(300);
    };
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-[5] h-full w-full" />;
}

/** Two quick flashes per strike, 3.5 to 7 s apart while the storm plays, never full white. Thunder follows. */
function Lightning() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer = 0;
    let anim: Animation | undefined;
    const strike = () => {
      const s = useGame.getState();
      if (s.playing && rainTarget()) {
        anim = ref.current?.animate(
          [
            { opacity: 0, offset: 0 },
            { opacity: 0.45, offset: 0.08 },
            { opacity: 0.08, offset: 0.25 },
            { opacity: 0.3, offset: 0.4 },
            { opacity: 0, offset: 1 },
          ],
          { duration: 520, easing: "linear" },
        );
        playThunder(0.35 + Math.random() * 0.8);
      }
      timer = window.setTimeout(strike, 3500 + Math.random() * 3500);
    };
    timer = window.setTimeout(strike, 2600);
    return () => {
      clearTimeout(timer);
      anim?.cancel();
    };
  }, []);
  return <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-[6] bg-[#dfe8ff] opacity-0 mix-blend-screen" />;
}

// ------------------------------------------------------------------ helicopter camera

/** The storm's key moments: located critical/warning events, spaced through the scenario. */
function pickStops(events: SimEvent[], duration: number): SimEvent[] {
  const located = events.filter((e) => e.lon !== undefined && e.lat !== undefined && e.level !== "info" && e.hour > 0);
  const ranked = [...located].sort((a, b) => (a.level === "critical" ? 0 : 1) - (b.level === "critical" ? 0 : 1) || a.hour - b.hour);
  // space stops across the stretch of the storm where things actually happen
  const hours = located.map((e) => e.hour);
  const span = hours.length ? Math.max(...hours) - Math.min(...hours) : duration;
  const gap = Math.max(1, span / (MAX_STOPS + 1));
  const out: SimEvent[] = [];
  for (const e of ranked) {
    if (out.length >= MAX_STOPS) break;
    if (out.every((o) => Math.abs(o.hour - e.hour) >= gap)) out.push(e);
  }
  return out.sort((a, b) => a.hour - b.hour);
}

function Director({ reduce, onCaption }: { reduce: boolean; onCaption: (e: SimEvent | null) => void }) {
  const sim = useGame((s) => s.sim);
  const duration = useGame((s) => cfgOf(s).durationHours);
  const stops = useMemo(() => (sim ? pickStops(sim.events, duration) : []), [sim, duration]);

  useEffect(() => {
    const map = mapBus.get();
    if (!map || !stops.length) return;
    const visited = new Set<number>();
    const timers: number[] = [];
    let busy = false;
    let userTookOver = false;
    let overview: { center: [number, number]; zoom: number; pitch: number; bearing: number } | null = null;
    let lastHour = useGame.getState().simHour;

    const onMoveStart = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userTookOver = true;
    };
    map.on("movestart", onMoveStart);
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

    const visit = (i: number) => {
      const e = stops[i];
      busy = true;
      onCaption(e);
      if (reduce || userTookOver) {
        later(ORBIT_MS + FLY_MS, () => {
          onCaption(null);
          busy = false;
        });
        return;
      }
      if (!overview) {
        const c = map.getCenter();
        overview = { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      }
      const bearing = -14 + (i % 2 ? 24 : -24);
      map.flyTo({ center: [e.lon!, e.lat!], zoom: Math.min(15.2, Math.max(map.getZoom() + 1.5, 14)), pitch: STORM_PITCH, bearing, duration: FLY_MS, curve: 1.2, essential: true });
      later(FLY_MS, () => !userTookOver && map.easeTo({ bearing: bearing + 14, duration: ORBIT_MS, easing: (x) => x, essential: true }));
      later(FLY_MS + ORBIT_MS, () => {
        onCaption(null);
        if (!userTookOver && overview) map.easeTo({ ...overview, duration: BACK_MS, essential: true });
      });
      later(FLY_MS + ORBIT_MS + BACK_MS, () => (busy = false));
    };

    const unsub = useGame.subscribe((s) => {
      const h = s.simHour;
      // scrubbed backwards: those stops can play again
      if (h < lastHour - 0.01) for (const i of [...visited]) if (stops[i].hour > h) visited.delete(i);
      lastHour = h;
      if (busy || !s.playing) return;
      const i = stops.findIndex((e, k) => !visited.has(k) && e.hour <= h);
      if (i < 0) return;
      visited.add(i);
      // skipped far past it (fast-forward or scrub): don't fly to old news
      if (h - stops[i].hour > 1.5) return;
      visit(i);
    });

    return () => {
      unsub();
      timers.forEach(clearTimeout);
      map.off("movestart", onMoveStart);
      onCaption(null);
    };
  }, [stops, reduce, onCaption]);

  return null;
}

function LiveCaption({ event }: { event: SimEvent | null }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-36 z-20 flex justify-center px-4" aria-live="polite">
      <AnimatePresence>
        {event && (
          <motion.div
            key={`${event.hour}-${event.title}`}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            className="flex max-w-xl items-start gap-3 rounded-lg border border-white/10 bg-[#050810]/90 px-4 py-3 shadow-2xl"
          >
            <span className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded bg-rose-600 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em] text-white">
              <span className="size-1.5 animate-pulse rounded-full bg-white" /> LIVE
            </span>
            <div className="min-w-0">
              <div className="font-display text-base font-bold uppercase tracking-[0.08em] text-white">{event.title}</div>
              {event.detail && <div className="mt-0.5 text-xs text-white/70">{event.detail}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SoundToggle() {
  const on = useSound((s) => s.on);
  const toggle = useSound((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={() => {
        unlockAudio();
        toggle();
      }}
      aria-pressed={on}
      aria-label={on ? "Turn storm sound off" : "Turn storm sound on"}
      className="absolute left-1/2 top-[92px] z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-white/10 bg-[#050810]/85 px-2.5 py-1.5 text-xs text-white/80 hover:text-white"
    >
      {on ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />} Storm sound
    </button>
  );
}
