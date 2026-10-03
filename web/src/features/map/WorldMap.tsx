"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef } from "react";
import Map, { Marker, useControl, type MapRef } from "react-map-gl/maplibre";
import { BASEMAP_ATTRIBUTION, CITY_ORDER, CITY_PACKS } from "@/cities";
import { CITY_SCENARIOS } from "@/config/game";
import { mapBus } from "@/lib/map-bus";
import { useGame } from "@/stores/game";
import type { Phase } from "@/types";
import { CityMarker } from "./CityMarker";
import { applyDaylight, daylightAt } from "./daylight";
import { useDeckLayers, handleDeckClick, handleDeckHover, deckTooltip } from "./layers";
import { buildMapStyle } from "./style";

function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const GLOBE_PHASES: Phase[] = ["landing", "select"];
const GAME_PHASES: Phase[] = ["briefing", "planning", "locking", "simulating", "results"];
const GLOBE_HOME = { center: [-88, 30] as [number, number], zoom: 2.05, pitch: 0, bearing: 0 };

/** 0 night ... 1 day, from the theme setting or the scenario clock. */
function daylightFor(s: ReturnType<typeof useGame.getState>): number {
  if (s.theme === "day") return 1;
  if (s.theme === "night") return 0;
  if (!s.cityId || GLOBE_PHASES.includes(s.phase)) return 0;
  const cfg = CITY_SCENARIOS[s.cityId];
  const hour = s.phase === "simulating" || s.phase === "results" || s.phase === "locking" ? s.simHour : 0;
  return Math.round(daylightAt(cfg.startClock + hour) * 20) / 20;
}

function DeckLayers() {
  const layers = useDeckLayers();
  return (
    <DeckOverlay
      interleaved
      layers={layers}
      onClick={handleDeckClick}
      onHover={handleDeckHover}
      getTooltip={deckTooltip}
      pickingRadius={6}
    />
  );
}

export function WorldMap() {
  const mapRef = useRef<MapRef>(null);
  const phase = useGame((s) => s.phase);
  const cityId = useGame((s) => s.cityId);
  const hoverCity = useGame((s) => s.hoverCity);
  const dataReady = useGame((s) => !!s.data);
  const reducedMotion = useGame((s) => s.reducedMotion);
  const showBuildings = useGame((s) => s.layers.buildings);
  const cameraMode = useGame((s) => s.cameraMode);
  const style = useMemo(() => buildMapStyle(), []);
  const daylight = useGame(daylightFor);
  const interacting = useRef(false);

  const map = useCallback(() => mapRef.current?.getMap() as MaplibreMap | undefined, []);

  const onLoad = useCallback(() => {
    const m = map();
    if (!m) return;
    mapBus.set(m);
    applyDaylight(m, daylightFor(useGame.getState()));
    m.on("dragstart", () => (interacting.current = true));
    m.on("dragend", () => setTimeout(() => (interacting.current = false), 2500));
  }, [map]);

  useEffect(() => () => mapBus.set(null), []);

  useEffect(() => {
    const m = map();
    if (m) applyDaylight(m, daylight);
  }, [daylight, map]);

  // globe spin on the landing page
  useEffect(() => {
    if (phase !== "landing" || reducedMotion) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const m = map();
      const dt = (now - last) / 1000;
      last = now;
      if (m && !interacting.current && !m.isMoving()) {
        const c = m.getCenter();
        m.jumpTo({ center: [c.lng + dt * 3.2, c.lat] });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, map, reducedMotion]);

  // projection: globe for the world view, mercator in the city
  useEffect(() => {
    const m = map();
    if (!m || !m.isStyleLoaded()) return;
    if (GLOBE_PHASES.includes(phase)) m.setProjection({ type: "globe" });
  }, [phase, map]);

  // camera director
  useEffect(() => {
    const m = map();
    if (!m) return;
    const duration = reducedMotion ? 0 : undefined;
    const noPad = { left: 0, right: 0, top: 0, bottom: 0 };
    if (phase === "landing") {
      const left = Math.min(window.innerWidth * 0.4, 560);
      m.flyTo({ ...GLOBE_HOME, zoom: GLOBE_HOME.zoom + 0.25, padding: { ...noPad, left }, duration: duration ?? 2200, essential: true });
      return;
    }
    if (phase === "select") {
      if (hoverCity) {
        const c = CITY_PACKS[hoverCity];
        m.flyTo({ center: c.center, zoom: 10.6, pitch: 50, bearing: c.initialBearing, padding: { ...noPad, bottom: window.innerHeight * 0.35 }, duration: duration ?? 2600, curve: 1.5, essential: true });
      } else {
        m.flyTo({ center: [-95, 38], zoom: 3.1, pitch: 12, bearing: 0, padding: { ...noPad, bottom: window.innerHeight * 0.3 }, duration: duration ?? 2000, essential: true });
      }
      return;
    }
    if (!cityId) return;
    const c = CITY_PACKS[cityId];
    if (GAME_PHASES.includes(phase) && phase !== "briefing" && m.getZoom() < 9) {
      const b = c.cameraBookmarks.find((x) => x.id === "overview") ?? c.cameraBookmarks[0];
      m.setProjection({ type: "mercator" });
      m.flyTo({ center: b.center, zoom: b.zoom + 0.3, pitch: 48, bearing: b.bearing, padding: noPad, duration: duration ?? 2000, essential: true });
      return;
    }
    if (phase === "mode" || phase === "preview" || phase === "loading") {
      m.flyTo({ center: c.center, zoom: c.initialZoom, pitch: c.initialPitch, bearing: c.initialBearing, padding: noPad, duration: duration ?? 4200, curve: 1.6, essential: true });
      const setMerc = () => m.setProjection({ type: "mercator" });
      if (duration === 0) setMerc();
      else m.once("moveend", setMerc);
    }
  }, [phase, hoverCity, cityId, map, reducedMotion]);

  // camera modes in the city
  useEffect(() => {
    const m = map();
    if (!m || !GAME_PHASES.includes(phase) || phase === "briefing") return;
    const pitch = cameraMode === "analysis" ? 0 : cameraMode === "tactical" ? 35 : 55;
    const ease = () => m.easeTo({ pitch, duration: reducedMotion ? 0 : 900 });
    // easing now would cancel a camera flight that is still on its way into the city
    if (!m.isMoving()) {
      ease();
      return;
    }
    m.once("moveend", ease);
    return () => {
      m.off("moveend", ease);
    };
  }, [cameraMode, phase, map, reducedMotion]);

  useEffect(() => {
    const m = map();
    if (!m || !m.isStyleLoaded() || !m.getLayer("building-3d")) return;
    m.setLayoutProperty("building-3d", "visibility", showBuildings ? "visible" : "none");
  }, [showBuildings, map]);

  const showMarkers = GLOBE_PHASES.includes(phase);
  const showDeck = dataReady && GAME_PHASES.includes(phase);

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: GLOBE_HOME.center[0], latitude: GLOBE_HOME.center[1], zoom: 1.6, pitch: 0, bearing: 0 }}
      mapStyle={style}
      onLoad={onLoad}
      maxPitch={78}
      attributionControl={{ compact: true, customAttribution: BASEMAP_ATTRIBUTION.map((a) => `<a href="${a.url}" target="_blank" rel="noreferrer">${a.label}</a>`).join(" ") }}
      style={{ position: "absolute", inset: 0 }}
      reuseMaps
    >
      {showMarkers &&
        CITY_ORDER.map((id) => (
          <Marker key={id} longitude={CITY_PACKS[id].center[0]} latitude={CITY_PACKS[id].center[1]} anchor="center">
            <CityMarker id={id} />
          </Marker>
        ))}
      {showDeck && <DeckLayers />}
    </Map>
  );
}
