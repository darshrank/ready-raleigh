"use client";

let raf = 0;

/** Shake the map (and everything drawn on it) with a decaying random jitter. */
export function shake(px: number, ms: number) {
  const el = typeof document !== "undefined" ? document.getElementById("map-shell") : null;
  if (!el || el.closest(".reduce-motion")) return;
  cancelAnimationFrame(raf);
  const start = performance.now();
  const frame = (now: number) => {
    const k = 1 - (now - start) / ms;
    if (k <= 0) {
      el.style.transform = "";
      return;
    }
    const a = px * k * k;
    el.style.transform = `translate3d(${(Math.random() * 2 - 1) * a}px, ${(Math.random() * 2 - 1) * a}px, 0) rotate(${(Math.random() * 2 - 1) * a * 0.02}deg)`;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
