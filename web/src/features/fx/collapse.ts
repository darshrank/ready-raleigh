"use client";

import { latLngToCell } from "h3-js";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { CityData } from "@/lib/data/city-data";
import type { Collapse } from "./fx-store";

/** Share of buildings that come down: by liquefaction class (1 High, 2 Moderate), else on violent shaking. Game numbers. */
const collapseShare = (cls: number, mmi: number) => (cls === 1 ? 0.4 : cls === 2 ? 0.18 : mmi >= 8 ? 0.03 : 0);
const MAX_COLLAPSES = 260;
/** Hours over which the collapses are spread after the mainshock. */
const SPREAD_H = 0.28;

const unit = (id: number) => {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

function outerRing(g: GeoJSON.Geometry): number[][] | null {
  if (g.type === "Polygon") return g.coordinates[0] as number[][];
  if (g.type === "MultiPolygon") {
    let best: number[][] | null = null;
    for (const p of g.coordinates) if (!best || p[0].length > best.length) best = p[0] as number[][];
    return best;
  }
  return null;
}

/**
 * Real buildings from the loaded basemap tiles that stand on liquefiable ground,
 * picked with a deterministic hash of their id so replays match.
 */
export function pickCollapses(map: MaplibreMap, data: CityData, mainshock: number, known: Set<number>): Collapse[] {
  const out: Collapse[] = [];
  const res = data.meta.h3Res;
  for (const f of map.querySourceFeatures("omt", { sourceLayer: "building" })) {
    const id = Number(f.id);
    if (!Number.isFinite(id) || known.has(id)) continue;
    known.add(id);
    const height = Number(f.properties?.render_height ?? 0);
    if (height < 5) continue;
    const ring = outerRing(f.geometry);
    if (!ring || ring.length < 4) continue;
    let lon = 0;
    let lat = 0;
    for (const [x, y] of ring) {
      lon += x;
      lat += y;
    }
    lon /= ring.length;
    lat /= ring.length;
    const cell = data.cells.index.get(latLngToCell(lat, lon, res));
    if (cell === undefined) continue;
    const share = collapseShare(data.cells.cls[cell], data.cells.v[cell] / 100);
    const u = unit(id);
    if (u >= share) continue;
    out.push({ id, polygon: ring, height, lon, lat, start: mainshock + (u / share) * SPREAD_H });
    if (out.length >= MAX_COLLAPSES) break;
  }
  return out;
}

/** Hide collapsing buildings from the basemap so the animated copies can fall in their place. */
export function hideBuildings(map: MaplibreMap, ids: number[]) {
  if (!map.getLayer("building-3d")) return;
  map.setFilter("building-3d", ids.length ? ["!", ["in", ["id"], ["literal", ids]]] : null);
}

/** 1 standing ... 0.06 rubble, accelerating as it falls. */
export function standing(t: number, start: number) {
  const k = Math.max(0, Math.min(1, (t - start) / 0.09));
  return 1 - 0.94 * k * k;
}
