import { BRAND } from "@/config/game";
import { cn } from "@/lib/utils";

/** Wordmark with a fault line cutting through it. */
export function Logo({ size = "lg", className }: { size?: "sm" | "lg" | "xl"; className?: string }) {
  const text = size === "xl" ? "text-7xl sm:text-8xl" : size === "lg" ? "text-4xl" : "text-xl";
  return (
    <div className={cn("relative inline-block select-none", className)}>
      <span className={cn("font-display font-black uppercase leading-none tracking-[0.14em] text-white", text)}>{BRAND.name}</span>
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 20" preserveAspectRatio="none">
        <path
          d="M-2 13 L18 11.5 L24 14 L37 9.5 L45 12 L58 8.5 L66 11 L79 7.5 L88 10 L102 6"
          fill="none"
          stroke="var(--city)"
          strokeWidth="0.9"
          vectorEffect="non-scaling-stroke"
          style={{ filter: "drop-shadow(0 0 6px var(--city))" }}
        />
      </svg>
    </div>
  );
}
