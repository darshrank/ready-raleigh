"use client";

import { AnimatePresence } from "motion/react";
import { useEffect } from "react";
import { CITY_PACKS } from "@/cities";
import { WorldMap } from "@/features/map/WorldMap";
import { Landing } from "@/features/landing/Landing";
import { CitySelect } from "@/features/landing/CitySelect";
import { ModeSelect } from "@/features/landing/ModeSelect";
import { CityPreview } from "@/features/landing/CityPreview";
import { LoadingScreen } from "@/features/landing/LoadingScreen";
import { Briefing } from "@/features/briefing/Briefing";
import { PlanningHud } from "@/features/planning/PlanningHud";
import { LockOverlay } from "@/features/simulation/LockOverlay";
import { SimulationHud } from "@/features/simulation/SimulationHud";
import { Results } from "@/features/results/Results";
import { mapBus } from "@/lib/map-bus";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import { CityDataBridge } from "./CityDataBridge";
import { GameLoop } from "./GameLoop";
import { PlacementSound } from "@/features/storm/PlacementSound";
import { Storm } from "@/features/storm/Storm";
import { RoomBridge } from "./RoomBridge";
import { SimulationController } from "./SimulationController";

export function Experience() {
  const phase = useGame((s) => s.phase);
  const cityId = useGame((s) => s.cityId);
  const hoverCity = useGame((s) => s.hoverCity);
  const reducedMotion = useGame((s) => s.reducedMotion);
  const highContrast = useGame((s) => s.highContrast);
  const setPref = useGame((s) => s.setPref);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPref("reducedMotion", true);
    if (process.env.NODE_ENV !== "production") {
      Object.assign(window as object, { __game: useGame, __map: mapBus });
    }
  }, [setPref]);

  const accentCity = CITY_PACKS[hoverCity ?? cityId ?? "raleigh"];

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden", reducedMotion && "reduce-motion", highContrast && "high-contrast")}
      style={{ ["--city" as string]: accentCity.accent, ["--city-2" as string]: accentCity.accent2 }}
    >
      <WorldMap />
      <CityDataBridge />
      <GameLoop />
      <SimulationController />
      <RoomBridge />
      <PlacementSound />
      <Storm />
      <AnimatePresence>
        {phase === "landing" && <Landing key="landing" />}
        {phase === "select" && <CitySelect key="select" />}
        {phase === "mode" && <ModeSelect key="mode" />}
        {phase === "preview" && <CityPreview key="preview" />}
        {phase === "loading" && <LoadingScreen key="loading" />}
        {phase === "briefing" && <Briefing key="briefing" />}
        {phase === "planning" && <PlanningHud key="planning" />}
        {phase === "locking" && <LockOverlay key="locking" />}
        {phase === "simulating" && <SimulationHud key="simulating" />}
        {phase === "results" && <Results key="results" />}
      </AnimatePresence>
    </div>
  );
}
