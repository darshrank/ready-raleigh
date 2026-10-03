"use client";

import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import { useFx, type BannerTone } from "./fx-store";

const TONE: Record<BannerTone, { text: string; glow: string; kicker: string }> = {
  quake: { text: "text-amber-200", glow: "rgba(245,158,11,0.75)", kicker: "SEISMIC EVENT" },
  storm: { text: "text-sky-200", glow: "rgba(56,189,248,0.75)", kicker: "SEVERE WEATHER" },
  heat: { text: "text-orange-200", glow: "rgba(251,146,60,0.75)", kicker: "EXTREME HEAT" },
  danger: { text: "text-rose-200", glow: "rgba(244,63,94,0.8)", kicker: "CRITICAL" },
  success: { text: "text-emerald-200", glow: "rgba(52,211,153,0.75)", kicker: "GOOD NEWS" },
  info: { text: "text-white", glow: "rgba(148,163,184,0.6)", kicker: "UPDATE" },
};

/** Full-screen weather and event effects drawn above the map and below the HUD. */
export function FxOverlays() {
  return (
    <>
      <HeatHaze />
      <RainCanvas />
      <Flash />
      <Flicker />
      <EventBanner />
      <GainToasts />
    </>
  );
}

function RainCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useGame((s) => s.reducedMotion);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let raf = 0;
    let drops: { x: number; y: number; l: number; v: number }[] = [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      cv.width = window.innerWidth * dpr;
      cv.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);
    const frame = () => {
      const level = useFx.getState().rain;
      const w = cv.width;
      const h = cv.height;
      ctx.clearRect(0, 0, w, h);
      if (level > 0.02 && !reduced) {
        const target = Math.floor((level * (w * h)) / (1100 * dpr * dpr));
        while (drops.length < target) drops.push({ x: Math.random() * w * 1.2, y: Math.random() * h, l: (10 + Math.random() * 18) * dpr, v: (14 + Math.random() * 12) * dpr });
        if (drops.length > target) drops.length = target;
        const wind = 0.28;
        ctx.strokeStyle = `rgba(186, 220, 255, ${0.18 + level * 0.25})`;
        ctx.lineWidth = dpr;
        ctx.beginPath();
        for (const d of drops) {
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.l * wind, d.y + d.l);
          d.y += d.v;
          d.x -= d.v * wind;
          if (d.y > h) {
            d.y = -d.l;
            d.x = Math.random() * w * 1.2;
          }
        }
        ctx.stroke();
      } else drops = [];
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reduced]);
  const rain = useFx((s) => s.rain);
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-[6] transition-colors duration-1000" style={{ background: `rgba(10, 18, 34, ${rain * 0.36})` }} />
      <canvas ref={ref} className="pointer-events-none absolute inset-0 z-[6] h-full w-full" />
    </>
  );
}

function Flash() {
  const strike = useFx((s) => s.strike);
  const reduced = useGame((s) => s.reducedMotion);
  const controls = useAnimationControls();
  useEffect(() => {
    if (!strike || reduced) return;
    void controls.start({ opacity: [0, 0.5, 0.08, 0.38, 0], transition: { duration: 0.55, times: [0, 0.1, 0.3, 0.45, 1] } });
  }, [strike, reduced, controls]);
  return <motion.div animate={controls} initial={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-[7] bg-[#e8f1ff]" />;
}

function Flicker() {
  const flicker = useFx((s) => s.flicker);
  const reduced = useGame((s) => s.reducedMotion);
  const controls = useAnimationControls();
  useEffect(() => {
    if (!flicker) return;
    void controls.start(
      reduced
        ? { opacity: [0, 0.6, 0], transition: { duration: 1.2 } }
        : { opacity: [0, 0.85, 0.15, 0.9, 0.3, 0.75, 0], transition: { duration: 1.5, times: [0, 0.08, 0.2, 0.32, 0.5, 0.62, 1] } },
    );
  }, [flicker, reduced, controls]);
  return <motion.div animate={controls} initial={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-[7] bg-[#02030a]" />;
}

function HeatHaze() {
  const heat = useFx((s) => s.heat);
  if (heat <= 0.01) return null;
  return (
    <div
      className="heat-haze pointer-events-none absolute inset-0 z-[5]"
      style={{ opacity: heat * 0.85, background: "radial-gradient(ellipse at 50% 55%, transparent 35%, rgba(251,120,40,0.28) 75%, rgba(220,60,20,0.45) 100%)" }}
    />
  );
}

function EventBanner() {
  const banner = useFx((s) => s.banner);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[18%] z-[24] flex justify-center px-4">
      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner.id}
            initial={{ opacity: 0, scale: 1.35, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0, x: banner.tone === "quake" ? [0, -6, 6, -4, 4, 0] : 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -14 }}
            transition={{ duration: 0.45, x: { duration: 0.5, repeat: 2 } }}
            className="text-center"
          >
            <div className={cn("font-mono text-[11px] font-bold tracking-[0.4em] sm:text-xs", TONE[banner.tone].text)}>{TONE[banner.tone].kicker}</div>
            <div
              className={cn("mt-1 font-display text-5xl font-black uppercase leading-none tracking-[0.08em] sm:text-7xl", TONE[banner.tone].text)}
              style={{ textShadow: `0 0 28px ${TONE[banner.tone].glow}, 0 2px 0 rgba(0,0,0,0.6)` }}
            >
              {banner.title}
            </div>
            {banner.subtitle && <div className="mx-auto mt-2 max-w-xl text-sm text-white/85 drop-shadow sm:text-base">{banner.subtitle}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GainToasts() {
  const toasts = useFx((s) => s.toasts);
  return (
    <div className="pointer-events-none absolute right-4 top-20 z-[26] flex flex-col items-end gap-1 sm:right-6 sm:top-24">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 14, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -24 }}
            className={cn("rounded-full px-3 py-1 font-display text-lg font-bold uppercase tracking-wide shadow-lg", t.good ? "bg-emerald-400 text-[#03140d]" : "bg-rose-500 text-white")}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
