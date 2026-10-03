"use client";

import { ArrowLeft, Camera, Database, Play } from "lucide-react";
import { motion } from "motion/react";
import { CITY_PACKS } from "@/cities";
import { Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { mapBus } from "@/lib/map-bus";
import { useGame } from "@/stores/game";

export function CityPreview() {
  const cityId = useGame((s) => s.cityId)!;
  const setPhase = useGame((s) => s.setPhase);
  const chooseCity = useGame((s) => s.chooseCity);
  const city = CITY_PACKS[cityId];

  return (
    <motion.div className="absolute inset-0 z-10 flex items-end p-6 sm:p-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#050810]/95 via-[#050810]/40 to-transparent" />
      <Panel className="relative w-full max-w-md p-6">
        <Button variant="ghost" size="sm" onClick={() => setPhase("select")} className="-ml-2 mb-3 text-dim hover:text-white">
          <ArrowLeft /> Cities
        </Button>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: city.accent }}>
          {city.name}, {city.state}
        </div>
        <h2 className="mt-1 font-display text-4xl font-black uppercase tracking-[0.12em] text-white">{city.scenarioTitle}</h2>
        <div className="mt-1 text-sm text-white/80">{city.hazard}</div>
        <p className="mt-4 text-sm leading-relaxed text-dim">
          This city pack has its real map, camera and scenario design in place. Its data pack (hazard layers, road graph and
          demographics) is next in the build order after Raleigh.
        </p>
        <div className="mt-4 hud-label">Special mechanic</div>
        <div className="mt-1 font-display text-xl font-bold uppercase tracking-wider" style={{ color: city.accent }}>
          {city.specialMechanic}
        </div>
        <div className="mt-4 hud-label">Interventions</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {city.interventionNames.map((n) => (
            <span key={n} className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/80">
              {n}
            </span>
          ))}
        </div>
        <div className="mt-4 hud-label flex items-center gap-1.5">
          <Database className="size-3" /> Planned data sources
        </div>
        <ul className="mt-1 list-inside list-disc text-xs text-dim">
          {city.plannedSources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <div className="mt-4 hud-label flex items-center gap-1.5">
          <Camera className="size-3" /> Camera tour
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {city.cameraBookmarks.map((b) => (
            <Button
              key={b.id}
              variant="outline"
              size="sm"
              className="border-white/15 bg-white/5"
              onClick={() => mapBus.flyTo({ center: b.center, zoom: b.zoom, pitch: b.pitch, bearing: b.bearing, duration: 3000 })}
            >
              {b.label}
            </Button>
          ))}
        </div>
        <Button
          className="mt-6 w-full bg-[#34d399] font-display text-base font-bold uppercase tracking-[0.18em] text-[#03140d] hover:bg-[#34d399]"
          onClick={() => {
            chooseCity("raleigh");
            setPhase("mode");
          }}
        >
          <Play /> Play Raleigh: Hurricane Cascade
        </Button>
      </Panel>
    </motion.div>
  );
}
