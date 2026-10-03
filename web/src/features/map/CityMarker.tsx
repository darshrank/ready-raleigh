"use client";

import { CITY_PACKS } from "@/cities";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import type { CityId } from "@/types";

/** Glowing city beacon on the globe. Hover previews the city's signature hazard. */
export function CityMarker({ id }: { id: CityId }) {
  const city = CITY_PACKS[id];
  const hoverCity = useGame((s) => s.hoverCity);
  const phase = useGame((s) => s.phase);
  const setHoverCity = useGame((s) => s.setHoverCity);
  const setPhase = useGame((s) => s.setPhase);
  const active = hoverCity === id;

  return (
    <button
      type="button"
      aria-label={`${city.name}: ${city.scenarioTitle}`}
      onMouseEnter={() => phase === "select" && setHoverCity(id)}
      onMouseLeave={() => phase === "select" && setHoverCity(null)}
      onClick={() => {
        if (phase === "landing") setPhase("select");
        setHoverCity(id);
      }}
      className="group relative flex size-16 items-center justify-center"
      style={{ ["--c" as string]: city.accent }}
    >
      <span className="absolute size-3 rounded-full" style={{ background: city.accent, boxShadow: `0 0 18px 6px ${city.accent}` }} />
      <span className="absolute size-3 rounded-full animate-pulse-ring" style={{ background: city.accent }} />
      <HazardPreview kind={city.hoverEffect} color={city.accent} visible={active} />
      <span
        className={cn(
          "pointer-events-none absolute top-full mt-1 whitespace-nowrap font-display text-sm font-semibold uppercase tracking-[0.2em] transition-opacity",
          active ? "opacity-100" : "opacity-70 group-hover:opacity-100",
        )}
        style={{ color: city.accent, textShadow: "0 0 12px rgba(0,0,0,0.9)" }}
      >
        {city.name}
      </span>
    </button>
  );
}

function HazardPreview({ kind, color, visible }: { kind: string; color: string; visible: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-[-28px] rounded-full transition-opacity duration-500",
        visible ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    >
      {kind === "rain" && (
        <span className="absolute inset-0 overflow-hidden rounded-full">
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="absolute h-3 w-px animate-rain"
              style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 80}%`, background: color, animationDelay: `${(i % 7) * 0.1}s` }}
            />
          ))}
        </span>
      )}
      {kind === "surge" &&
        [0, 0.6, 1.2].map((d) => (
          <span key={d} className="absolute inset-4 rounded-full border-2 animate-pulse-ring" style={{ borderColor: color, animationDelay: `${d}s` }} />
        ))}
      {kind === "thermal" && (
        <span
          className="absolute inset-2 rounded-full animate-pulse"
          style={{ background: `radial-gradient(circle, ${color}cc 0%, ${color}55 35%, transparent 70%)` }}
        />
      )}
      {kind === "seismic" &&
        [0, 0.35, 0.7, 1.05].map((d) => (
          <span key={d} className="absolute inset-6 rounded-full border animate-pulse-ring" style={{ borderColor: color, animationDelay: `${d}s`, animationDuration: "1.4s" }} />
        ))}
    </span>
  );
}
