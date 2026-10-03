"use client";

import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useEffect } from "react";
import { cfgOf, useGame } from "@/stores/game";
import { FloodWater, type WaterState, type WaterTiming } from "./water";

type GameState = ReturnType<typeof useGame.getState>;

/** What the native flood water should show for the current game state. */
function waterState(s: GameState, daylight: number): Partial<WaterState> {
  const t = (cfgOf(s).hazard.sources[0] ?? null) as WaterTiming | null;
  const visible = s.layers.flood;
  if (s.phase === "simulating" && s.sim) {
    const h = s.simHour;
    // streets show as under water once a class's first water has had time to spread
    const submerged = t ? [3, 2, 1].find((k) => h >= t.t0[k as 1 | 2 | 3] + 0.5) ?? 0 : 0;
    return { hour: h, level: "full", daylight, submerged, visible };
  }
  if (s.phase === "results") return { hour: null, level: "full", daylight, submerged: 3, visible };
  if (s.phase === "locking") return { hour: 0, level: "full", daylight, submerged: 0, visible };
  return { hour: null, level: "preview", daylight, submerged: 0, visible };
}

/**
 * Creates the native flood water (features/map/water.ts) for flood cities once the style and the
 * city data are loaded, and keeps it in step with the game: preview while planning, growing with
 * the simulation clock, full afterwards.
 */
export function useFloodWater(map: () => MaplibreMap | undefined, daylightFor: (s: GameState) => number) {
  const data = useGame((s) => s.data);
  const reduce = useGame((s) => s.reducedMotion);

  useEffect(() => {
    const m = map();
    if (!m || !data || data.cfg.hazard.type !== "flood") return;
    const timing = data.cfg.hazard.sources[0] as unknown as WaterTiming | undefined;
    if (!timing) return;
    let water: FloodWater | null = null;
    let unsub = () => {};
    let cancelled = false;
    // isStyleLoaded() also reads false while tiles stream in, so try, and retry on the next style event
    const start = () => {
      if (cancelled || water) return;
      try {
        water = new FloodWater(m, data.hazardZones as FeatureCollection<Polygon | MultiPolygon, { cls: number }>, timing, reduce);
      } catch {
        m.once("styledata", start);
        return;
      }
      water.set(waterState(useGame.getState(), daylightFor(useGame.getState())));
      unsub = useGame.subscribe((g) => water?.set(waterState(g, daylightFor(g))));
    };
    start();
    return () => {
      cancelled = true;
      m.off("styledata", start);
      unsub();
      water?.destroy();
    };
  }, [data, reduce, map, daylightFor]);
}
