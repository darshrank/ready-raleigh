import type { Map as MaplibreMap } from "maplibre-gl";

/** Paint values for the night and day looks of the basemap. Only colours change, so the deck overlay stays attached. */
const NIGHT = {
  background: "#0c1424",
  wood: "#0b1a1c",
  grass: "#0a1619",
  park: "#0c1d1e",
  residential: "#0e172a",
  water: "#040d1b",
  waterway: "#1d5f8f",
  boundary: "#3b5a80",
  boundaryState: "#2a4466",
  roadMinor: "#16213a",
  roadSecondary: "#22314f",
  roadPrimary: "#2c4166",
  roadMotorway: "#36507c",
  rail: "#1f2b44",
  building: ["#121b30", "#1b2a48", "#26406a"],
  roadLabel: "#7f90ad",
  waterLabel: "#4fa3d9",
  neighbourhood: "#5d6f8e",
  city: "#8ea2c3",
  state: "#3e5476",
  country: "#4a6386",
  halo: "#070c18",
  sky: "#06101f",
  horizon: "#12304f",
  fog: "#050a14",
  light: "#cfe3ff",
};

const DAY: typeof NIGHT = {
  background: "#e6eaef",
  wood: "#cddfc6",
  grass: "#d9e7d0",
  park: "#c9e1c0",
  residential: "#dfe3ea",
  water: "#9ccbe8",
  waterway: "#5fa8dc",
  boundary: "#8a98ab",
  boundaryState: "#a6b2c2",
  roadMinor: "#ffffff",
  roadSecondary: "#fbfbf8",
  roadPrimary: "#fde3a7",
  roadMotorway: "#f6c26b",
  rail: "#b4bcc8",
  building: ["#d9dee6", "#c9d0da", "#b5bfcc"],
  roadLabel: "#56657c",
  waterLabel: "#2f78ad",
  neighbourhood: "#66758b",
  city: "#26344a",
  state: "#7c8aa0",
  country: "#55647a",
  halo: "#ffffff",
  sky: "#7fbdf0",
  horizon: "#d7eaf9",
  fog: "#e9eff5",
  light: "#ffffff",
};

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** 0 = night, 1 = full daylight, from hour of day (sunrise around 6:30, sunset around 19:30). */
export function daylightAt(hourOfDay: number): number {
  const h = ((hourOfDay % 24) + 24) % 24;
  if (h < 6) return 0;
  if (h < 7.5) return (h - 6) / 1.5;
  if (h < 19) return 1;
  if (h < 20.5) return 1 - (h - 19) / 1.5;
  return 0;
}

let latest = 1;
let waiting = false;

/**
 * Paint the basemap for a daylight level. isStyleLoaded() is also false while tiles stream in, so it
 * would drop updates mid-flight; setting paint only needs the style itself, which throws until ready.
 */
export function applyDaylight(map: MaplibreMap, d: number) {
  latest = d;
  try {
    paintDaylight(map, d);
  } catch {
    if (waiting) return;
    waiting = true;
    map.once("styledata", () => {
      waiting = false;
      applyDaylight(map, latest);
    });
  }
}

function paintDaylight(map: MaplibreMap, d: number) {
  const c = Object.fromEntries(
    Object.entries(NIGHT).map(([k, v]) => [k, Array.isArray(v) ? v.map((x, i) => lerpHex(x, (DAY[k as keyof typeof DAY] as string[])[i], d)) : lerpHex(v, DAY[k as keyof typeof DAY] as string, d)]),
  ) as typeof NIGHT;
  const paint = (layer: string, prop: string, value: unknown) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
  };
  paint("background", "background-color", c.background);
  paint("landcover-wood", "fill-color", c.wood);
  paint("landcover-grass", "fill-color", c.grass);
  paint("park", "fill-color", c.park);
  paint("landuse-residential", "fill-color", c.residential);
  paint("water", "fill-color", c.water);
  paint("waterway", "line-color", c.waterway);
  paint("boundary-country", "line-color", c.boundary);
  paint("boundary-state", "line-color", c.boundaryState);
  paint("road-minor", "line-color", c.roadMinor);
  paint("road-secondary", "line-color", c.roadSecondary);
  paint("road-primary", "line-color", c.roadPrimary);
  paint("road-motorway", "line-color", c.roadMotorway);
  paint("rail", "line-color", c.rail);
  paint("building-3d", "fill-extrusion-color", ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 6], 0, c.building[0], 40, c.building[1], 120, c.building[2]]);
  paint("building-3d", "fill-extrusion-opacity", 0.86 + 0.08 * d);
  for (const [layer, color] of [
    ["road-label", c.roadLabel],
    ["water-label", c.waterLabel],
    ["place-neighbourhood", c.neighbourhood],
    ["place-city", c.city],
    ["place-state", c.state],
    ["place-country", c.country],
  ] as const) {
    paint(layer, "text-color", color);
    paint(layer, "text-halo-color", c.halo);
  }
  map.setSky({
    "sky-color": c.sky,
    "horizon-color": c.horizon,
    "fog-color": c.fog,
    "fog-ground-blend": 0.6,
    "horizon-fog-blend": 0.4,
    "sky-horizon-blend": 0.7,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
  });
  map.setLight({ anchor: "viewport", color: c.light, intensity: 0.32 + 0.2 * d, position: [1.2, 210, 35] });
}
