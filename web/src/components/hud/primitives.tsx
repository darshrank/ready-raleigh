"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { StatusLevel } from "@/types";

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("hud-panel rounded-xl", className)} {...rest}>
      {children}
    </div>
  );
}

export function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("hud-label", className)}>{children}</div>;
}

const STATUS: Record<StatusLevel, { color: string; glyph: string }> = {
  STABLE: { color: "var(--color-stable)", glyph: "●" },
  WATCH: { color: "var(--color-watch)", glyph: "◐" },
  ELEVATED: { color: "var(--color-elevated)", glyph: "▲" },
  CRITICAL: { color: "var(--color-critical)", glyph: "✕" },
  ISOLATED: { color: "var(--color-isolated)", glyph: "⊘" },
};

/** Status chip with a glyph so meaning never depends on colour alone. */
export function StatusChip({ level, className }: { level: StatusLevel; className?: string }) {
  const s = STATUS[level];
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider", className)}
      style={{ color: s.color, borderColor: `color-mix(in oklab, ${s.color} 45%, transparent)`, background: `color-mix(in oklab, ${s.color} 12%, transparent)` }}
    >
      <span aria-hidden>{s.glyph}</span>
      {level}
    </span>
  );
}

export function useAnimatedNumber(value: number, ms = 700) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  const displayRef = useRef(value);
  useEffect(() => {
    from.current = displayRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const v = from.current + (value - from.current) * e;
      displayRef.current = v;
      setDisplay(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return display;
}

export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const v = useAnimatedNumber(value);
  return <span className={cn("tabular font-mono", className)}>{format(v)}</span>;
}

export function DataBadge({ kind }: { kind: "SCENARIO DATA" | "DEMO DATA" | "LIVE DATA" | "SIMULATED PLAYERS" }) {
  const color = kind === "LIVE DATA" ? "#34d399" : kind === "SCENARIO DATA" ? "#38bdf8" : "#facc15";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.14em]"
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {kind}
    </span>
  );
}

export function Meter({ value, color = "var(--city)", className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/8", className)}>
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export { int, money, pct } from "@/lib/format";
