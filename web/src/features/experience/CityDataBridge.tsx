"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { CITY_PACKS } from "@/cities";
import { loadCityData } from "@/lib/data/city-data";
import { useGame } from "@/stores/game";

/** Loads the selected city's preprocessed data once and hands it to the game store. */
export function CityDataBridge() {
  const cityId = useGame((s) => s.cityId);
  const phase = useGame((s) => s.phase);
  const data = useGame((s) => s.data);
  const setData = useGame((s) => s.setData);
  const setPhase = useGame((s) => s.setPhase);
  const playable = !!cityId && CITY_PACKS[cityId].status === "playable";

  const query = useQuery({
    queryKey: ["city-data", cityId],
    queryFn: () => loadCityData(cityId!),
    enabled: playable && phase !== "landing" && phase !== "select",
  });

  useEffect(() => {
    if (query.data && (!data || data.cityId !== query.data.cityId)) setData(query.data);
  }, [query.data, data, setData]);

  useEffect(() => {
    if (phase === "loading" && data) setPhase("briefing");
  }, [phase, data, setPhase]);

  return null;
}

export function useCityDataStatus() {
  const cityId = useGame((s) => s.cityId);
  const query = useQuery({ queryKey: ["city-data", cityId], queryFn: () => loadCityData(cityId!), enabled: false });
  return { isError: query.isError, error: query.error as Error | null, isLoading: query.isLoading };
}
