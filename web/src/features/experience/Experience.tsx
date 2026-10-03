"use client";

import { AnimatePresence } from "motion/react";
import { useEffect } from "react";
import { CITY_PACKS } from "@/cities";
import { WorldMap } from "@/features/map/WorldMap";
import { Landing } from "@/features/landing/Landing";
import { CitySelect } from "@/features/landing/CitySelect";
import { HostLobby } from "@/features/room/HostLobby";
import { JoinRoom } from "@/features/room/JoinRoom";
import { RoomBridge } from "@/features/room/RoomBridge";
import { LoadingScreen } from "@/features/landing/LoadingScreen";
import { Briefing } from "@/features/briefing/Briefing";
import { PlanningHud } from "@/features/planning/PlanningHud";
import { LockOverlay } from "@/features/simulation/LockOverlay";
import { SimulationHud } from "@/features/simulation/SimulationHud";
import { Results } from "@/features/results/Results";
import { FxDirector } from "@/features/fx/Director";
import { useFx } from "@/features/fx/fx-store";
import { FxOverlays } from "@/features/fx/Overlays";
import { useBackend } from "@/lib/api";
import { sfx } from "@/lib/audio/sfx";
import { engine } from "@/lib/engine/client";
import { mapBus } from "@/lib/map-bus";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import { CityDataBridge } from "./CityDataBridge";
import { GameLoop } from "./GameLoop";
import { SimulationController } from "./SimulationController";

export function Experience() {
  const phase = useGame((s) => s.phase);
  const cityId = useGame((s) => s.cityId);
  const hoverCity = useGame((s) => s.hoverCity);
  const reducedMotion = useGame((s) => s.reducedMotion);
  const highContrast = useGame((s) => s.highContrast);
  const setPref = useGame((s) => s.setPref);

  const sound = useGame((s) => s.sound);
  const hasSim = useGame((s) => !!s.sim);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPref("reducedMotion", true);
    if (localStorage.getItem("faultline:sound") === "off") setPref("sound", false);
    if (process.env.NODE_ENV !== "production") {
      Object.assign(window as object, { __game: useGame, __map: mapBus, __fx: useFx, __engine: engine });
    }
    // browsers keep audio locked until the first gesture
    const unlock = () => sfx.unlock();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    void useBackend.getState().check();
    const health = setInterval(() => void useBackend.getState().check(), 30_000);
    if (new URLSearchParams(window.location.search).get("room")) useGame.getState().setPhase("join");
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      clearInterval(health);
    };
  }, [setPref]);

  useEffect(() => {
    sfx.setMuted(!sound);
    localStorage.setItem("faultline:sound", sound ? "on" : "off");
  }, [sound]);

  const accentCity = CITY_PACKS[hoverCity ?? cityId ?? "raleigh"];

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden", reducedMotion && "reduce-motion", highContrast && "high-contrast")}
      style={{ ["--city" as string]: accentCity.accent, ["--city-2" as string]: accentCity.accent2 }}
    >
      <WorldMap />
      <FxOverlays />
      <FxDirector />
      <CityDataBridge />
      <GameLoop />
      <SimulationController />
      <RoomBridge />
      <AnimatePresence>
        {phase === "landing" && <Landing key="landing" />}
        {phase === "join" && <JoinRoom key="join" />}
        {phase === "select" && <CitySelect key="select" />}
        {phase === "mode" && <HostLobby key="mode" />}
        {phase === "loading" && <LoadingScreen key="loading" />}
        {phase === "briefing" && <Briefing key="briefing" />}
        {phase === "planning" && <PlanningHud key="planning" />}
        {phase === "locking" && <LockOverlay key="locking" />}
        {phase === "simulating" && hasSim && <SimulationHud key="simulating" />}
        {phase === "results" && <Results key="results" />}
      </AnimatePresence>
    </div>
  );
}
