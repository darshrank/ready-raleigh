"use client";

import { motion } from "motion/react";
import { CITY_PACKS } from "@/cities";
import { Button } from "@/components/ui/button";
import { useCityDataStatus } from "@/features/experience/CityDataBridge";
import { useGame } from "@/stores/game";

const STEPS = [
  "Road network graph (OpenStreetMap)",
  "FEMA flood hazard zones",
  "Census tracts and vulnerability (ACS)",
  "Shelter sites, hospitals, bus stops",
  "Flood-prone crossings",
];

export function LoadingScreen() {
  const cityId = useGame((s) => s.cityId)!;
  const setPhase = useGame((s) => s.setPhase);
  const status = useCityDataStatus();
  const city = CITY_PACKS[cityId];

  return (
    <motion.div className="absolute inset-0 z-20 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-[#050810]/70" />
      <div className="hud-panel relative w-[360px] rounded-xl p-6">
        <div className="hud-label">Loading city pack</div>
        <div className="mt-1 font-display text-3xl font-black uppercase tracking-[0.14em] text-white">{city.name}</div>
        <ul className="mt-4 flex flex-col gap-2">
          {STEPS.map((s, i) => (
            <motion.li
              key={s}
              className="flex items-center gap-2 text-sm text-white/80"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.12 }}
            >
              <span className="size-1.5 animate-pulse rounded-full bg-[var(--city)]" />
              {s}
            </motion.li>
          ))}
        </ul>
        {status.isError && (
          <div className="mt-4 rounded-md border border-rose-400/30 bg-rose-400/10 p-3 text-xs text-rose-100">
            Could not load the city data: {status.error?.message}
            <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setPhase("select")}>
              Back
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
