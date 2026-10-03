import type { CityId, CityPack } from "@/types";
import { raleigh } from "./raleigh";
import { miami } from "./miami";
import { newYork } from "./new-york";
import { sanFrancisco } from "./san-francisco";

export const CITY_PACKS: Record<CityId, CityPack> = {
  raleigh,
  miami,
  "new-york": newYork,
  "san-francisco": sanFrancisco,
};

export const CITY_ORDER: CityId[] = ["raleigh", "miami", "new-york", "san-francisco"];

export const BASEMAP_ATTRIBUTION = [
  { label: "OpenFreeMap", url: "https://openfreemap.org" },
  { label: "© OpenMapTiles", url: "https://www.openmaptiles.org/" },
  { label: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
];
