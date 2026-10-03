"use client";

import { useEffect } from "react";
import { useGame } from "@/stores/game";
import { playStamp } from "./sound";

/** A stamp sound each time a piece lands on the board (from the visual-overhaul branch). */
export function PlacementSound() {
  useEffect(
    () =>
      useGame.subscribe((s, prev) => {
        if (s.phase === "planning" && s.placements.length > prev.placements.length) playStamp();
      }),
    [],
  );
  return null;
}
