import type { SkylineShape } from "@/types";

function shapePath(s: SkylineShape): string {
  const base = 40;
  switch (s.t) {
    case "box":
      return `M${s.x} ${base} V${base - s.h} H${s.x + s.w} V${base} Z`;
    case "tower":
      return `M${s.x} ${base} V${base - s.h + 4} L${s.x + s.w / 2} ${base - s.h} L${s.x + s.w} ${base - s.h + 4} V${base} Z`;
    case "spire": {
      const top = base - s.h;
      const mid = s.x + s.w / 2;
      return `M${s.x} ${base} V${top + s.s} H${mid - 0.6} V${top} H${mid + 0.6} V${top + s.s} H${s.x + s.w} V${base} Z`;
    }
    case "dome": {
      const top = base - s.h;
      const r = s.w / 2;
      return `M${s.x} ${base} V${top + r} A${r} ${r} 0 0 1 ${s.x + s.w} ${top + r} V${base} Z M${s.x + r - 0.5} ${top + 1} V${top - 3} H${s.x + r + 0.5} V${top + 1} Z`;
    }
    case "pyramid":
      return `M${s.x} ${base} L${s.x + s.w / 2} ${base - s.h} L${s.x + s.w} ${base} Z`;
    case "palm": {
      const top = base - s.h;
      return `M${s.x} ${base} Q${s.x + 1} ${top + 4} ${s.x + 0.6} ${top} L${s.x + 1.2} ${top} Q${s.x + 2} ${top + 4} ${s.x + 1.6} ${base} Z M${s.x + 0.9} ${top} q-4 -1 -6 2 q3 -3 6 -1.4 q-3 -3 -5 -5 q4 2 5 4.6 q1 -4 4 -5 q-2 3 -3 5.2 q3 -1.6 6 1 q-4 -1.4 -7 -1.4 Z`;
    }
  }
}

export function Skyline({ shapes, color, className }: { shapes: SkylineShape[]; color: string; className?: string }) {
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="xMidYMax meet" className={className} aria-hidden>
      <defs>
        <linearGradient id={`sky-${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <path d={shapes.map(shapePath).join(" ")} fill={`url(#sky-${color.slice(1)})`} />
      <line x1="0" x2="100" y1="40" y2="40" stroke={color} strokeOpacity="0.5" strokeWidth="0.4" />
    </svg>
  );
}
