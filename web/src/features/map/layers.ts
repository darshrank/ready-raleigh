"use client";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { DataFilterExtension } from "@deck.gl/extensions";
import { H3HexagonLayer, TripsLayer } from "@deck.gl/geo-layers";
import { ArcLayer, GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { useMemo } from "react";
import { specFor, type InterventionKind, type InterventionSpec, type SnapTarget } from "@/config/game";
import type { CityData, ZoneProps } from "@/lib/data/city-data";
import { busReach, crossingDependents, shelterReach } from "@/lib/engine/coverage";
import { crowdAnalysis } from "@/lib/engine/crowd";
import { toEnginePlan, type EnginePlan } from "@/lib/engine/plan";
import { KIND, TRIP_DELAYED, TRIP_REROUTED, type AgentRecord, type SimResult, type Trip } from "@/lib/engine/simulate";
import { cfgOf, useGame } from "@/stores/game";
import type { PlacedIntervention } from "@/types";
import { AGENT, FLOOD, FLOOD_ZONE_FILL, QUADRANT_COLOR, riskRamp, type RGBA } from "./colors";
import { deckIcon } from "./icons";

const timeFilter = new DataFilterExtension({ filterSize: 1 });
const timeFilter2 = new DataFilterExtension({ filterSize: 2 });
/** Draw above 3D buildings instead of being clipped by them. */
const ON_TOP = { parameters: { depthCompare: "always" as const, depthWriteEnabled: false } };

const SNAP_LAYER: Record<SnapTarget, string> = {
  shelterSite: "cand-shelterSite",
  busStop: "cand-busStop",
  crossing: "crossings",
  fireStation: "cand-fireStation",
  shieldPoint: "cand-shieldPoint",
  zone: "cand-zone",
};

interface EdgeItem {
  e: number;
  path: Float64Array;
  v: number;
}
type ClosedItem = { e: number; path: Float64Array; t: number };
type ProtPt = { pos: [number, number]; t: number };
type StrandPt = { pos: [number, number]; t: number; rescue: number; w: number; zone: number };
type IsoPt = { pos: [number, number]; t: number; w: number; zone: number };
interface OriginWaiting {
  lon: number;
  lat: number;
  departs: number[];
  weights: number[];
}

/** Crossings worth offering for protection: they fail in the scenario, or are culverts. */
export function protectableCrossings(data: CityData, edgeClose: Float32Array) {
  return data.crossings.filter((c) => c.cls >= 2 && (c.kind === "culvert" || c.edges.some((e) => Number.isFinite(edgeClose[e]))));
}

/** Heat ramp from cool blue through amber to red (0..1). */
function heatRamp(h: number, alpha: number): RGBA {
  const stops: [number, number, number][] = [
    [56, 120, 190],
    [120, 160, 150],
    [250, 204, 21],
    [251, 146, 60],
    [239, 68, 68],
  ];
  const x = Math.max(0, Math.min(1, (h - 0.25) / 0.7)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, alpha];
}

const SOURCE_COLOR: Record<number, RGBA> = {
  0: [30, 144, 230, 175],
  1: [20, 200, 190, 200],
  2: [56, 140, 250, 170],
  3: [110, 90, 240, 180],
};

function reachEdges(data: CityData, dist: Float64Array, limit: number): EdgeItem[] {
  const out: EdgeItem[] = [];
  const g = data.graph;
  for (let e = 0; e < g.m; e++) {
    const a = dist[g.eu[e]];
    const b = dist[g.ev[e]];
    if (a <= limit && b <= limit) out.push({ e, path: g.geom[e], v: Math.max(a, b) });
  }
  return out;
}

export function useDeckLayers(): Layer[] {
  const data = useGame((s) => s.data);
  const phase = useGame((s) => s.phase);
  const layers = useGame((s) => s.layers);
  const intel = useGame((s) => s.intel);
  const placements = useGame((s) => s.placements);
  const activeTool = useGame((s) => s.activeTool);
  const hover = useGame((s) => s.hover);
  const selected = useGame((s) => s.selected);
  const coverage = useGame((s) => s.coverage);
  const estimate = useGame((s) => s.estimate);
  const baseline = useGame((s) => s.baseline);
  const achilles = useGame((s) => s.achilles);
  const sim = useGame((s) => s.sim);
  const simHour = useGame((s) => s.simHour);
  const cameraMode = useGame((s) => s.cameraMode);
  const resultsStep = useGame((s) => s.resultsStep);
  const reference = useGame((s) => s.reference);
  const bots = useGame((s) => s.bots);
  const flood = coverage?.flood;
  const cfg = data?.cfg;
  const type = cfg?.hazard.type;
  const activeSpec = cfg && activeTool ? specFor(cfg, activeTool) : null;

  const crossingEdges = useMemo(() => {
    if (!data || !flood) return [];
    return protectableCrossings(data, flood.edgeClose).flatMap((c) => c.edges.map((e) => ({ e, c: c.id, path: data.graph.geom[e], close: flood.edgeClose[e], kind: c.kind })));
  }, [data, flood]);
  const cellIdx = useMemo(() => (data ? Array.from({ length: data.cells.h3.length }, (_, i) => i) : []), [data]);
  const liqCells = useMemo(() => cellIdx.filter((i) => data!.cells.cls[i] > 0), [cellIdx, data]);
  const fireCells = useMemo(() => (sim?.cellFire ? cellIdx.filter((i) => sim.cellFire![i] < 1e5) : []), [cellIdx, sim]);
  const retrofitZones = useMemo(() => (data ? data.zones.filter((z) => z.floodShare > 0.05) : []), [data]);
  const zoneMax = useMemo(() => {
    if (!data) return { risk: 1, noveh: 1 };
    return { risk: Math.max(...data.zones.map((z) => z.atRisk / Math.max(0.3, z.areaKm2))), noveh: Math.max(...data.zoneShares.map((s) => s.snv)) };
  }, [data]);

  const plan = useMemo(() => (data ? toEnginePlan(placements, data.cfg) : null), [data, placements]);

  // coverage field for the hovered candidate or selected placement
  const focus = useMemo(() => {
    if (!data || !coverage || !plan) return null;
    let kind: InterventionKind | null = null;
    let target = -1;
    let lon = 0;
    let lat = 0;
    if (hover) {
      kind = hover.kind;
      target = hover.target;
    } else if (selected?.type === "intervention") {
      const p = placements.find((x) => x.id === selected.id);
      if (p) {
        kind = p.kind;
        target = p.target;
        lon = p.lon;
        lat = p.lat;
      }
    }
    if (!kind) return null;
    const spec = specFor(data.cfg, kind);
    if (spec.effect === "shelter") {
      const { tree, limit } = shelterReach(coverage, target, plan);
      return { spec, edges: reachEdges(data, tree.dist, limit), limit };
    }
    if (spec.effect === "pickup") {
      const { tree, limit } = busReach(coverage, target, plan);
      return { spec, edges: reachEdges(data, tree.dist, limit), limit };
    }
    if (spec.effect === "protectRoad") {
      const deps = crossingDependents(coverage, { ...plan, crossings: plan.crossings.filter((c) => c !== target) }, target);
      const c = data.crossings[target];
      return { spec, arcs: deps.map((o) => ({ from: [c.lon, c.lat], to: [o.lon, o.lat], pop: o.pop })) };
    }
    if (hover) {
      const pt = candidatePoint(data, spec, target);
      if (pt) {
        lon = pt.lon;
        lat = pt.lat;
      }
    }
    return { spec, ring: { lon, lat, r: spec.radiusM ?? 300 } };
  }, [data, coverage, hover, selected, placements, plan]);

  const simDerived = useMemo(() => (sim && data ? deriveSim(data, sim) : null), [sim, data]);
  const blackoutFC = useMemo(() => {
    const zones = new Set(sim?.blackout?.zones ?? []);
    if (!data || !zones.size) return null;
    return { ...data.zoneFC, features: data.zoneFC.features.filter((f) => zones.has(f.properties.id)) };
  }, [data, sim]);
  const crowd = useMemo(() => {
    if (!data || !bots || !baseline || phase !== "results" || !plan) return null;
    return crowdAnalysis(data, [...bots.map((b) => b.plan), plan], baseline);
  }, [data, bots, baseline, plan, phase]);

  if (!data || !flood || !cfg || !plan) return [];
  const out: Layer[] = [];
  const g = data.graph;
  const inSim = (phase === "simulating" || phase === "locking") && !!sim;
  const simMode = !!sim && (inSim || phase === "results");
  const t = phase === "results" ? cfg.durationHours : simHour;
  const shadow = cameraMode === "shadow" && !!simDerived;
  const blackout = sim?.blackout ?? null;
  const blackoutZones = new Set(blackout && t >= blackout.hour ? blackout.zones : []);

  // ---------- zones
  if (layers.zones) {
    const checkpoint = simDerived ? Math.min(sim!.zoneAccess.hours.length - 1, Math.floor(simHour / 2)) : -1;
    const quad = crowd && phase === "results" && resultsStep === 4 ? new Map(crowd.zones.map((z) => [z.zone, z.quadrant])) : null;
    out.push(
      new GeoJsonLayer({
        id: "zones",
        data: data.zoneFC,
        pickable: true,
        stroked: true,
        filled: true,
        getLineColor: (f: { properties: ZoneProps }) => (quad && crowd?.gapZone?.zone === f.properties.id ? [244, 63, 94, 255] : blackoutZones.has(f.properties.id) ? [168, 85, 247, 200] : [120, 140, 175, 70]),
        getLineWidth: (f: { properties: ZoneProps }) => (quad && crowd?.gapZone?.zone === f.properties.id ? 4 : blackoutZones.has(f.properties.id) ? 2 : 1),
        lineWidthUnits: "pixels",
        getFillColor: (f: { properties: ZoneProps }) => {
          const z = f.properties;
          if (quad) return QUADRANT_COLOR[quad.get(z.id) ?? "low"];
          if (blackoutZones.has(z.id)) return [20, 10, 40, 165];
          if (simDerived && checkpoint >= 0 && type !== "heat") {
            const share = sim!.zoneAccess.share[checkpoint][z.id];
            if (share < 0.5) return shadow ? [88, 28, 135, 200] : [168, 85, 247, 120];
            return shadow ? [2, 6, 14, 150] : [0, 0, 0, 0];
          }
          if (simMode) return [0, 0, 0, 0];
          if (intel.demographic) return riskRamp(data.zoneShares[z.id].snv / zoneMax.noveh, 110);
          return riskRamp(Math.sqrt(z.atRisk / Math.max(0.3, z.areaKm2) / zoneMax.risk), type === "heat" ? 30 : 46);
        },
        updateTriggers: {
          getFillColor: [checkpoint, intel.demographic, shadow, quad ? resultsStep : -1, blackoutZones.size, simMode],
          getLineColor: [crowd?.gapZone?.zone, resultsStep, blackoutZones.size],
          getLineWidth: [crowd?.gapZone?.zone, resultsStep, blackoutZones.size],
        },
      }),
    );
  }

  // ---------- hazard layers
  if (layers.flood && !simMode) {
    if (type === "heat") {
      out.push(
        new H3HexagonLayer<number>({
          id: "heat-static",
          data: cellIdx,
          getHexagon: (i: number) => data.cells.h3[i],
          getFillColor: (i: number) => heatRamp(data.cells.v[i] / 1000, intel.floodDetail ? 130 : 85),
          extruded: false,
          stroked: false,
          highPrecision: false,
          updateTriggers: { getFillColor: [intel.floodDetail] },
        }),
      );
    } else if (type === "coastal" && intel.floodDetail) {
      out.push(
        new H3HexagonLayer<number>({
          id: "source-static",
          data: cellIdx,
          getHexagon: (i: number) => data.cells.h3[i],
          getFillColor: (i: number) => SOURCE_COLOR[data.cells.src[i]] ?? SOURCE_COLOR[0],
          extruded: false,
          stroked: false,
          highPrecision: false,
        }),
      );
    } else if (type !== "flood") {
      // flood water is drawn natively by features/map/water.ts
      out.push(
        new GeoJsonLayer({
          id: "hazard-zones",
          data: data.hazardZones,
          pickable: false,
          stroked: false,
          getFillColor: (f: { properties: { cls: number; src: number } }) =>
            type === "quake"
              ? f.properties.cls === 1
                ? [245, 158, 11, intel.floodDetail ? 140 : 100]
                : [250, 204, 21, intel.floodDetail ? 70 : 100]
              : intel.floodDetail
                ? FLOOD_ZONE_FILL[f.properties.cls]
                : [56, 160, 240, 80],
          updateTriggers: { getFillColor: [intel.floodDetail] },
        }),
      );
    }
  }
  if (layers.flood && simMode) {
    const arrival = sim!.cellArrival;
    if (type === "heat") {
      out.push(
        new H3HexagonLayer<number>({
          id: "heat-base",
          data: cellIdx,
          getHexagon: (i: number) => data.cells.h3[i],
          getFillColor: (i: number) => heatRamp(data.cells.v[i] / 1000, 55),
          extruded: false,
          stroked: false,
          highPrecision: false,
        }),
        new H3HexagonLayer<number>({
          id: "heat-danger",
          data: cellIdx,
          getHexagon: (i: number) => data.cells.h3[i],
          getFillColor: (i: number) => (data.cells.v[i] > 700 ? [239, 68, 68, 175] : [251, 120, 40, 150]),
          extruded: false,
          stroked: false,
          highPrecision: false,
          getFilterValue: (i: number) => arrival[i],
          filterRange: [0, t],
          filterSoftRange: [0, Math.max(0, t - 1)],
          extensions: [timeFilter],
          updateTriggers: { getFilterValue: [sim] },
        } as never),
      );
      if (blackoutFC && blackoutZones.size) {
        out.push(
          new GeoJsonLayer({
            id: "blackout",
            data: blackoutFC,
            stroked: true,
            filled: true,
            getFillColor: [12, 6, 28, 190],
            getLineColor: [168, 85, 247, 235],
            getLineWidth: 2.5,
            lineWidthUnits: "pixels",
          }),
        );
      }
    } else if (type === "quake") {
      out.push(
        new H3HexagonLayer<number>({
          id: "liquefaction",
          data: liqCells,
          getHexagon: (i: number) => data.cells.h3[i],
          getFillColor: (i: number) => (data.cells.cls[i] === 1 ? [217, 119, 6, 170] : [202, 138, 4, 110]),
          extruded: false,
          stroked: false,
          highPrecision: false,
          getFilterValue: (i: number) => arrival[i],
          filterRange: [0, t],
          extensions: [timeFilter],
          updateTriggers: { getFilterValue: [sim] },
        } as never),
        new H3HexagonLayer<number>({
          id: "fire-glow",
          data: fireCells,
          getHexagon: (i: number) => data.cells.h3[i],
          getFillColor: [255, 72, 20, 210],
          extruded: true,
          getElevation: (i: number) => 20 + data.cells.b[i] * 1.6,
          elevationScale: 1,
          stroked: false,
          highPrecision: false,
          getFilterValue: (i: number) => sim!.cellFire![i],
          filterRange: [0, t],
          filterSoftRange: [0, Math.max(0, t - 0.6)],
          extensions: [timeFilter],
          updateTriggers: { getFilterValue: [sim] },
        } as never),
      );
      const q = cfg.hazard.quake!;
      if (t < 0.6) {
        out.push(
          new ScatterplotLayer({
            id: "seismic-wave",
            ...ON_TOP,
            data: [0, 0.2, 0.4],
            getPosition: () => q.epicenter,
            getRadius: (d: number) => Math.max(0, (t - d * 0.3) / 0.6) * 30000,
            radiusUnits: "meters",
            filled: false,
            stroked: true,
            getLineColor: (d: number) => [251, 191, 36, Math.max(0, 255 * (1 - (t - d * 0.3) / 0.6))],
            lineWidthMinPixels: 3,
            updateTriggers: { getRadius: [t], getLineColor: [t] },
          }),
        );
      }
    } else if (type !== "flood") {
      out.push(
        new H3HexagonLayer<number>({
          id: "flood-cells",
          data: cellIdx,
          getHexagon: (i: number) => data.cells.h3[i],
          getFillColor: (i: number) => (type === "coastal" ? SOURCE_COLOR[data.cells.src[i]] : FLOOD[data.cells.cls[i]]),
          extruded: false,
          stroked: false,
          highPrecision: false,
          getFilterValue: (i: number) => arrival[i],
          filterRange: [0, t],
          filterSoftRange: [0, Math.max(0, t - 0.8)],
          extensions: [timeFilter],
          updateTriggers: { getFilterValue: [sim] },
        } as never),
      );
    }
  }
  if (data.features.features.length && (type === "quake" || type === "coastal")) {
    out.push(
      new GeoJsonLayer({
        id: "features",
        data: data.features,
        stroked: true,
        filled: false,
        getLineColor: (f: { properties: { kind: string } }) => (f.properties.kind === "fault" ? [244, 63, 94, 220] : [99, 102, 241, 160]),
        getLineWidth: (f: { properties: { kind: string } }) => (f.properties.kind === "fault" ? 3 : 1.5),
        lineWidthUnits: "pixels",
      }),
    );
  }

  // ---------- roads: fragile crossings (planning) and closures (simulation)
  if (!simMode && phase === "planning" && (layers.roads || activeSpec?.snapsTo === "crossing")) {
    out.push(
      new PathLayer({
        id: "crossings",
        ...ON_TOP,
        data: crossingEdges,
        getPath: (d) => d.path,
        positionFormat: "XY",
        getColor: (d) => (d.kind === "culvert" ? [250, 204, 21, 210] : d.close < cfg.refHours[0] + 3 ? [244, 63, 94, 230] : d.close < cfg.refHours[1] + 4 ? [251, 146, 60, 220] : [250, 204, 21, 200]),
        getWidth: activeSpec?.snapsTo === "crossing" ? 7 : 4,
        widthUnits: "pixels",
        capRounded: true,
        pickable: true,
      }),
    );
  }
  if (simDerived && simMode && type !== "heat") {
    out.push(
      new PathLayer({
        id: "closed-glow",
        ...ON_TOP,
        data: simDerived.closed,
        getPath: (d: ClosedItem) => d.path,
        positionFormat: "XY",
        getColor: [244, 63, 94, 70],
        getWidth: 10,
        widthUnits: "pixels",
        getFilterValue: (d: ClosedItem) => d.t,
        filterRange: [0, t],
        extensions: [timeFilter],
      } as never),
      new PathLayer({
        id: "closed",
        ...ON_TOP,
        data: simDerived.closed,
        getPath: (d: ClosedItem) => d.path,
        positionFormat: "XY",
        getColor: [255, 92, 120, 255],
        getWidth: 3,
        widthUnits: "pixels",
        pickable: true,
        getFilterValue: (d: ClosedItem) => d.t,
        filterRange: [0, t],
        extensions: [timeFilter],
      } as never),
    );
  }

  // ---------- coverage of focused candidate or placement
  if (focus && phase === "planning") {
    if ("edges" in focus && focus.edges) {
      const warm = focus.spec.effect === "shelter";
      out.push(
        new PathLayer<EdgeItem>({
          id: `reach-${focus.spec.id}`,
          ...ON_TOP,
          data: focus.edges,
          getPath: (d) => d.path,
          positionFormat: "XY",
          getColor: (d) => {
            const f = d.v / focus.limit!;
            return warm ? (type === "heat" ? [103, 232, 249, 230 - 150 * f] : [52, 211, 153, 230 - 150 * f]) : [250, 204, 21, 230 - 150 * f];
          },
          getWidth: 2.5,
          widthUnits: "pixels",
        }),
      );
    }
    if ("arcs" in focus && focus.arcs) {
      out.push(
        new ArcLayer({
          id: "ripple-arcs",
          ...ON_TOP,
          data: focus.arcs,
          getSourcePosition: (d) => d.from as [number, number],
          getTargetPosition: (d) => d.to as [number, number],
          getSourceColor: [56, 189, 248, 230],
          getTargetColor: [52, 211, 153, 200],
          getWidth: (d) => 1 + Math.sqrt(d.pop) / 8,
          getHeight: 0.4,
        }),
      );
    }
    if ("ring" in focus && focus.ring) {
      out.push(
        new ScatterplotLayer({
          id: "focus-ring",
          ...ON_TOP,
          data: [focus.ring],
          getPosition: (d) => [d.lon, d.lat],
          getRadius: (d) => d.r,
          radiusUnits: "meters",
          getFillColor: [125, 211, 252, 40],
          getLineColor: [125, 211, 252, 230],
          lineWidthMinPixels: 2,
          stroked: true,
        }),
      );
    }
  }

  // ---------- at-risk clusters
  if (layers.atRisk && !simMode) {
    const share = estimate?.originShare;
    out.push(
      new ScatterplotLayer({
        id: "origins",
        ...ON_TOP,
        data: data.origins,
        getPosition: (o) => [o.lon, o.lat],
        getRadius: (o) => 1.5 + Math.sqrt(o.pop) / (data.origins.length > 400 ? 8 : 4.5),
        radiusUnits: "pixels",
        radiusMaxPixels: 8,
        opacity: 0.85,
        getFillColor: (o) => {
          const s = share ? share[o.id] : 0;
          return s > 0.75 ? [52, 211, 153, 190] : s > 0.4 ? [250, 204, 21, 190] : [251, 113, 60, 200];
        },
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 0.75,
        stroked: true,
        pickable: true,
        updateTriggers: { getFillColor: [estimate] },
      }),
    );
  }

  // ---------- hospitals
  if (layers.facilities && (intel.health || phase !== "planning")) {
    out.push(
      new IconLayer({
        id: "hospitals",
        ...ON_TOP,
        data: data.hospitals,
        getPosition: (h) => [h.lon, h.lat],
        getIcon: () => deckIcon("hospital"),
        getSize: 30,
        pickable: true,
      }),
    );
  }

  // ---------- candidates for the active tool
  if (phase === "planning" && activeSpec) {
    const taken = new Set(placements.filter((p) => p.kind === activeSpec.id).map((p) => p.target));
    const snap = activeSpec.snapsTo;
    if (snap === "shelterSite") {
      out.push(
        new ScatterplotLayer({
          id: "cand-shelterSite",
          ...ON_TOP,
          data: data.shelters,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: (s) => (hover?.target === s.id ? 11 : 7),
          radiusUnits: "pixels",
          getFillColor: (s) => (taken.has(s.id) ? [80, 90, 110, 160] : s.fcls && type !== "heat" ? [251, 146, 60, 230] : activeSpec.effect === "medical" ? [251, 113, 133, 230] : [52, 211, 153, 230]),
          getLineColor: [255, 255, 255, 200],
          lineWidthMinPixels: 1.5,
          stroked: true,
          pickable: true,
          updateTriggers: { getRadius: [hover?.target], getFillColor: [placements, activeSpec.id] },
        }),
      );
    } else if (snap === "busStop") {
      out.push(
        new ScatterplotLayer({
          id: "cand-busStop",
          ...ON_TOP,
          data: data.busStops,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: (s) => (hover?.target === s.id ? 9 : 4),
          radiusUnits: "pixels",
          getFillColor: (s) => (taken.has(s.id) ? [80, 90, 110, 160] : activeSpec.effect === "shield" ? [125, 211, 252, 220] : [250, 204, 21, 220]),
          pickable: true,
          updateTriggers: { getRadius: [hover?.target], getFillColor: [placements, activeSpec.id] },
        }),
      );
    } else if (snap === "fireStation") {
      out.push(
        new IconLayer({
          id: "cand-fireStation",
          ...ON_TOP,
          data: data.fire,
          getPosition: (f) => [f.lon, f.lat],
          getIcon: () => deckIcon("fire"),
          getSize: (f) => (hover?.target === f.id ? 38 : 28),
          pickable: true,
          updateTriggers: { getSize: [hover?.target] },
        }),
      );
    } else if (snap === "shieldPoint") {
      out.push(
        new ScatterplotLayer({
          id: "cand-shieldPoint",
          ...ON_TOP,
          data: data.shieldPoints.filter((p) => p.kind === activeSpec.shieldKind),
          getPosition: (p) => [p.lon, p.lat],
          getRadius: (p) => (hover?.target === p.id ? 11 : 7),
          radiusUnits: "pixels",
          getFillColor: (p) => (taken.has(p.id) ? [80, 90, 110, 160] : p.kind === "surge" ? [45, 212, 191, 230] : [96, 165, 250, 230]),
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 1.5,
          stroked: true,
          pickable: true,
          updateTriggers: { getRadius: [hover?.target], getFillColor: [placements] },
        }),
      );
    } else if (snap === "zone") {
      out.push(
        new ScatterplotLayer({
          id: "cand-zone",
          ...ON_TOP,
          data: retrofitZones,
          getPosition: (z) => [z.lon, z.lat],
          getRadius: (z) => (hover?.target === z.id ? 12 : 8),
          radiusUnits: "pixels",
          getFillColor: (z) => (taken.has(z.id) ? [80, 90, 110, 160] : [251, 191, 36, 230]),
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 1.5,
          stroked: true,
          pickable: true,
          updateTriggers: { getRadius: [hover?.target], getFillColor: [placements] },
        }),
      );
    }
  }

  // ---------- achilles highlight
  if (achilles && phase === "planning") {
    if (achilles.mode === "network" && achilles.findings.length) {
      const top = data.crossings[achilles.findings[0].crossing];
      out.push(
        new PathLayer({
          id: "achilles",
          ...ON_TOP,
          data: top.edges.map((e) => ({ path: g.geom[e] })),
          getPath: (d) => d.path,
          positionFormat: "XY",
          getColor: [244, 63, 94, 255],
          getWidth: 12,
          widthUnits: "pixels",
          capRounded: true,
        }),
        new ScatterplotLayer({ id: "achilles-ring", ...ON_TOP, data: [top], getPosition: (c) => [c.lon, c.lat], getRadius: 260, radiusUnits: "meters", stroked: true, filled: false, getLineColor: [244, 63, 94, 255], lineWidthMinPixels: 2 }),
      );
    } else if (achilles.mode === "cooling" && achilles.gaps.length) {
      const gz = data.zones[achilles.gaps[0].zone];
      out.push(new ScatterplotLayer({ id: "achilles-ring", ...ON_TOP, data: [gz], getPosition: (z) => [z.lon, z.lat], getRadius: 650, radiusUnits: "meters", stroked: true, filled: true, getFillColor: [244, 63, 94, 40], getLineColor: [244, 63, 94, 255], lineWidthMinPixels: 2 }));
    }
  }

  // ---------- simulation agents
  if (simDerived && inSim) {
    const tm = t * 60;
    if (type === "heat") {
      out.push(
        new ScatterplotLayer({
          id: "cooling-islands",
          ...ON_TOP,
          data: sim!.shelterStats,
          getPosition: (s) => [data.shelters[s.site].lon, data.shelters[s.site].lat],
          getRadius: cfg.coverage.walkToShelterMeters,
          radiusUnits: "meters",
          getFillColor: (s) => (s.floodedAt <= t ? [0, 0, 0, 0] : [34, 211, 238, 45]),
          getLineColor: (s) => (s.floodedAt <= t ? [244, 63, 94, 200] : [103, 232, 249, 220]),
          lineWidthMinPixels: 2,
          stroked: true,
          updateTriggers: { getFillColor: [Math.round(t * 4)], getLineColor: [Math.round(t * 4)] },
        }),
      );
    }
    out.push(
      new TripsLayer<Trip>({
        id: "trips",
        ...ON_TOP,
        data: sim!.trips,
        getPath: (d: Trip) => d.path as unknown as [number, number][],
        positionFormat: "XY",
        getTimestamps: (d: Trip) => d.timestamps,
        getColor: (d: Trip) => (d.kind === KIND.bus ? AGENT.bus : d.kind === KIND.rescue ? AGENT.rescue : d.flags & TRIP_REROUTED ? AGENT.rerouted : d.flags & TRIP_DELAYED ? AGENT.delayed : AGENT.evacuating),
        getWidth: (d: Trip) => (d.kind === KIND.bus || d.kind === KIND.rescue ? 6 : 3.5),
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        fadeTrail: true,
        trailLength: type === "heat" ? 30 : 14,
        currentTime: tm,
      }),
      new ScatterplotLayer<OriginWaiting>({
        id: "waiting",
        ...ON_TOP,
        data: simDerived.originWaiting,
        getPosition: (d: OriginWaiting) => [d.lon, d.lat],
        getRadius: (d: OriginWaiting) => {
          const w = waitingAt(d, t);
          return w > 0 ? 2 + Math.sqrt(w) / 3.5 : 0;
        },
        radiusUnits: "pixels",
        getFillColor: [250, 204, 21, 120],
        getLineColor: [250, 204, 21, 220],
        lineWidthMinPixels: 1,
        stroked: true,
        updateTriggers: { getRadius: [Math.round(t * 4)] },
      }),
      new ScatterplotLayer({ id: "protected", ...ON_TOP, data: simDerived.protectedPts, getPosition: (d: ProtPt) => d.pos, getRadius: 4, radiusUnits: "pixels", getFillColor: [...AGENT.protected, 220] as RGBA, getFilterValue: (d: ProtPt) => d.t, filterRange: [0, t], extensions: [timeFilter] } as never),
      new ScatterplotLayer({ id: "isolated", ...ON_TOP, data: simDerived.isolatedPts, getPosition: (d: IsoPt) => d.pos, getRadius: (d: IsoPt) => 2 + Math.sqrt(d.w) / 4, radiusUnits: "pixels", getFillColor: [...AGENT.isolated, 230] as RGBA, pickable: true, getFilterValue: (d: IsoPt) => d.t, filterRange: [0, t], extensions: [timeFilter] } as never),
      new ScatterplotLayer({
        id: "stranded",
        ...ON_TOP,
        data: simDerived.strandedPts,
        getPosition: (d: StrandPt) => d.pos,
        getRadius: (d: StrandPt) => 2 + Math.sqrt(d.w) / 4,
        radiusUnits: "pixels",
        getFillColor: [...AGENT.stranded, 240] as RGBA,
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 0.5,
        stroked: true,
        pickable: true,
        getFilterValue: (d: StrandPt) => [d.t, d.rescue],
        filterRange: [
          [0, t],
          [t, 1e6],
        ],
        extensions: [timeFilter2],
      } as never),
      new ScatterplotLayer({ id: "rescued", ...ON_TOP, data: simDerived.strandedPts.filter((d) => d.rescue < 1e6), getPosition: (d: StrandPt) => d.pos, getRadius: 7, radiusUnits: "pixels", getFillColor: [...AGENT.protected, 230] as RGBA, getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 2, stroked: true, getFilterValue: (d: StrandPt) => d.rescue, filterRange: [0, t], extensions: [timeFilter] } as never),
      new ScatterplotLayer({
        id: "event-pings",
        ...ON_TOP,
        data: sim!.events.filter((e) => e.lon !== undefined && t >= e.hour && t < e.hour + 1.5),
        getPosition: (e) => [e.lon!, e.lat!],
        getRadius: (e) => 120 + (t - e.hour) * 900,
        radiusUnits: "meters",
        filled: false,
        stroked: true,
        getLineColor: (e) => (e.level === "critical" ? [244, 63, 94, 255 * (1 - (t - e.hour) / 1.5)] : e.level === "success" ? [52, 211, 153, 220] : [251, 146, 60, 220]),
        lineWidthMinPixels: 2,
        updateTriggers: { getRadius: [t], getLineColor: [t] },
      }),
      new ScatterplotLayer({
        id: "shelter-occupancy",
        ...ON_TOP,
        data: sim!.shelterStats.map((s) => ({ ...s, occ: occupancyAt(s.arrivals, t) })),
        getPosition: (s) => [data.shelters[s.site].lon, data.shelters[s.site].lat],
        getRadius: (s) => 14 + 26 * Math.min(1, s.occ / s.capacity),
        radiusUnits: "pixels",
        getFillColor: (s) => (s.floodedAt <= t ? [244, 63, 94, 90] : [52, 211, 153, 70]),
        getLineColor: (s) => (s.occ >= s.capacity ? [250, 204, 21, 255] : [52, 211, 153, 255]),
        lineWidthMinPixels: 2,
        stroked: true,
        updateTriggers: { getRadius: [Math.round(t * 8)], getFillColor: [Math.round(t * 2)], getLineColor: [Math.round(t * 8)] },
      }),
    );
  }

  // ---------- results overlays
  if (phase === "results" && simDerived && (resultsStep <= 1 || resultsStep === 5)) {
    out.push(
      new ScatterplotLayer({ id: "final-stranded", ...ON_TOP, data: simDerived.strandedPts.filter((d) => d.rescue >= 1e6), getPosition: (d) => d.pos, getRadius: (d) => 2 + Math.sqrt(d.w) / 4, radiusUnits: "pixels", getFillColor: [...AGENT.stranded, 230] as RGBA, pickable: true }),
      new ScatterplotLayer({ id: "final-isolated", ...ON_TOP, data: simDerived.isolatedPts, getPosition: (d) => d.pos, getRadius: (d) => 2 + Math.sqrt(d.w) / 4, radiusUnits: "pixels", getFillColor: [...AGENT.isolated, 230] as RGBA }),
    );
  }
  if (phase === "results" && crowd && resultsStep === 3) {
    out.push(
      new HeatmapLayer({
        id: "crowd-heat",
        data: crowd.placements,
        getPosition: (p) => [p.lon, p.lat],
        getWeight: (p) => p.weight,
        radiusPixels: 95,
        intensity: 2.6,
        threshold: 0.03,
        colorRange: [
          [30, 58, 138],
          [56, 189, 248],
          [52, 211, 153],
          [250, 204, 21],
          [251, 146, 60],
          [244, 63, 94],
        ],
      }),
    );
  }

  // ---------- placements (player, and the optimizer's plan in results)
  const protectedPaths = placements
    .filter((p) => specFor(cfg, p.kind).effect === "protectRoad")
    .flatMap((p) => data.crossings[p.target].edges.map((e) => ({ path: g.geom[e] })));
  if (protectedPaths.length) {
    out.push(new PathLayer({ id: "protected-roads", ...ON_TOP, data: protectedPaths, getPath: (d) => d.path, positionFormat: "XY", getColor: [56, 189, 248, 255], getWidth: 8, widthUnits: "pixels", capRounded: true }));
  }
  const shieldRings = placements.filter((p) => specFor(cfg, p.kind).effect === "shield").map((p) => ({ lon: p.lon, lat: p.lat, r: specFor(cfg, p.kind).radiusM ?? 400, kind: p.kind }));
  if (shieldRings.length && phase !== "results") {
    out.push(
      new ScatterplotLayer({
        id: "shield-rings",
        ...ON_TOP,
        data: shieldRings,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => d.r,
        radiusUnits: "meters",
        getFillColor: [125, 211, 252, 25],
        getLineColor: [125, 211, 252, 180],
        lineWidthMinPixels: 1.5,
        stroked: true,
      }),
    );
  }
  if (bots && phase === "results" && resultsStep === 3) {
    const botItems = bots.flatMap((b) => planIcons(data, b.plan));
    out.push(new IconLayer({ id: "bot-placements", ...ON_TOP, data: botItems, getPosition: (d) => [d.lon, d.lat], getIcon: (d) => deckIcon(d.icon, "#94a3b8"), getSize: 22 }));
  }
  out.push(
    new IconLayer<PlacedIntervention>({
      id: "placements",
      ...ON_TOP,
      data: placements,
      getPosition: (p) => [p.lon, p.lat],
      getIcon: (p) => deckIcon(specFor(cfg, p.kind).icon),
      getSize: (p) => (selected?.type === "intervention" && selected.id === p.id ? 46 : 36),
      pickable: phase === "planning",
      updateTriggers: { getSize: [selected] },
    }),
  );
  if (phase === "results" && reference && resultsStep === 2) {
    const refItems = planIcons(data, reference.plan);
    out.push(
      new IconLayer({ id: "reference-placements", ...ON_TOP, data: refItems, getPosition: (p) => [p.lon, p.lat], getIcon: (p) => deckIcon(p.icon, "#c084fc"), getSize: 34, pickable: true }),
      new TextLayer({
        id: "reference-labels",
        ...ON_TOP,
        data: refItems,
        getPosition: (p) => [p.lon, p.lat],
        getText: () => "OPTIMIZER",
        getColor: [216, 180, 254, 255],
        getSize: 10,
        getPixelOffset: [0, -28],
        fontFamily: "monospace",
        fontWeight: 700,
        outlineColor: [5, 8, 16, 255],
        outlineWidth: 3,
        fontSettings: { sdf: true },
      }),
    );
  }
  return out;
}

/** Icons for every element of an engine plan (used for the optimizer and simulated players). */
function planIcons(data: CityData, plan: EnginePlan) {
  const cfg = data.cfg;
  const icon = (effect: InterventionSpec["effect"]) => cfg.interventions.find((i) => i.effect === effect)?.icon ?? "shelter";
  return [
    ...plan.shelters.map((t) => ({ icon: icon("shelter"), lon: data.shelters[t].lon, lat: data.shelters[t].lat, label: data.shelters[t].name })),
    ...plan.busStops.map((t) => ({ icon: icon("pickup"), lon: data.busStops[t].lon, lat: data.busStops[t].lat, label: data.busStops[t].name })),
    ...plan.crossings.map((t) => ({ icon: icon("protectRoad"), lon: data.crossings[t].lon, lat: data.crossings[t].lat, label: data.crossings[t].label })),
    ...plan.rescue.map((t) => ({ icon: icon("rescue"), lon: data.fire[t].lon, lat: data.fire[t].lat, label: data.fire[t].name })),
    ...plan.shields.map((s) => ({ icon: specFor(cfg, s.spec).icon, lon: s.lon, lat: s.lat, label: specFor(cfg, s.spec).label })),
    ...plan.protectedSites.map((t) => ({ icon: icon("protectSite"), lon: data.shelters[t].lon + 0.0004, lat: data.shelters[t].lat, label: data.shelters[t].name })),
    ...plan.medical.map((t) => ({ icon: icon("medical"), lon: data.shelters[t].lon, lat: data.shelters[t].lat, label: data.shelters[t].name })),
  ];
}

function waitingAt(o: OriginWaiting, t: number) {
  let w = 0;
  for (let i = 0; i < o.departs.length; i++) if (o.departs[i] > t) w += o.weights[i];
  return w;
}

function occupancyAt(arrivals: [number, number][], t: number) {
  let occ = 0;
  for (const [h, w] of arrivals) {
    if (h > t) break;
    occ += w;
  }
  return occ;
}

function deriveSim(data: CityData, sim: SimResult) {
  const g = data.graph;
  const closed: ClosedItem[] = [];
  for (let e = 0; e < g.m; e++) {
    const t = sim.edgeClose[e];
    if (Number.isFinite(t) && t <= data.cfg.durationHours) closed.push({ e, path: g.geom[e], t });
  }
  const byOrigin = new Map<number, OriginWaiting>();
  for (const a of sim.agents) {
    const o = data.origins[a.origin];
    let rec = byOrigin.get(a.origin);
    if (!rec) {
      rec = { lon: o.lon, lat: o.lat, departs: [], weights: [] };
      byOrigin.set(a.origin, rec);
    }
    const leaves = a.fate === "isolated" || a.fate === "sheltering" ? 1e6 : a.fate === "stranded" && a.endNode === o.n ? a.endHour : a.depart;
    rec.departs.push(leaves);
    rec.weights.push(a.weight);
  }
  const protectedPts: ProtPt[] = sim.agents.filter((a) => a.fate === "protected").map((a) => ({ pos: [a.endLon + jitter(a, 0), a.endLat + jitter(a, 1)], t: a.endHour }));
  const strandedPts: StrandPt[] = sim.agents
    .filter((a) => a.fate === "stranded" || a.fate === "rescued")
    .map((a) => ({ pos: [a.endLon + jitter(a, 2), a.endLat + jitter(a, 3)], t: Number.isFinite(a.endHour) ? a.endHour : data.cfg.durationHours, rescue: Number.isFinite(a.rescueHour) ? a.rescueHour : 1e6, w: a.weight, zone: a.zone }));
  const isolatedPts: IsoPt[] = sim.agents.filter((a) => a.fate === "isolated").map((a) => ({ pos: [a.endLon + jitter(a, 4), a.endLat + jitter(a, 5)], t: a.endHour, w: a.weight, zone: a.zone }));
  return { closed, originWaiting: [...byOrigin.values()], protectedPts, strandedPts, isolatedPts };
}

function jitter(a: AgentRecord, k: number) {
  const s = Math.sin((a.origin * 12.9898 + a.depart * 78.233 + k * 37.719) * 43758.5453);
  return (s - Math.floor(s) - 0.5) * 0.0012;
}

// ---------------------------------------------------------------- picking ---

/** Position and label of a candidate for a given intervention. */
export function candidatePoint(data: CityData, spec: InterventionSpec, target: number): { lon: number; lat: number; label: string } | null {
  switch (spec.snapsTo) {
    case "shelterSite": {
      const s = data.shelters[target];
      return s ? { lon: s.lon, lat: s.lat, label: s.name } : null;
    }
    case "busStop": {
      const s = data.busStops[target];
      return s ? { lon: s.lon, lat: s.lat, label: s.name || "Bus stop" } : null;
    }
    case "crossing": {
      const c = data.crossings[target];
      return c ? { lon: c.lon, lat: c.lat, label: c.label } : null;
    }
    case "fireStation": {
      const f = data.fire[target];
      return f ? { lon: f.lon, lat: f.lat, label: f.name } : null;
    }
    case "shieldPoint": {
      const p = data.shieldPoints.find((x) => x.id === target);
      return p ? { lon: p.lon, lat: p.lat, label: p.label } : null;
    }
    case "zone": {
      const z = data.zones[target];
      return z ? { lon: z.lon, lat: z.lat, label: z.name } : null;
    }
  }
}

function targetFromPick(layerId: string, obj: Record<string, unknown>): number {
  if (layerId === "crossings") return obj.c as number;
  return obj.id as number;
}

export function handleDeckClick(info: PickingInfo) {
  const s = useGame.getState();
  const id = info.layer?.id ?? "";
  const obj = info.object as Record<string, unknown> | undefined;
  const data = s.data;
  if (!data) return;
  if (s.phase === "planning" && s.activeTool && obj) {
    const spec = specFor(data.cfg, s.activeTool);
    if (id === SNAP_LAYER[spec.snapsTo]) {
      const target = targetFromPick(id, obj);
      const pt = candidatePoint(data, spec, target);
      if (pt) {
        placeOrMove(spec.id, target, pt.lon, pt.lat, pt.label);
        return;
      }
    }
  }
  if (!obj) {
    s.select(null);
    return;
  }
  if (id === "zones") s.select({ type: "zone", id: (obj as { properties: ZoneProps }).properties.id });
  else if (id === "placements") s.select({ type: "intervention", id: obj.id as string });
  else if (id === "hospitals") s.select({ type: "hospital", id: obj.id as number });
  else if (id === "crossings" || id === "closed") {
    const cid = id === "closed" ? data.edgeCrossing[obj.e as number] : (obj.c as number);
    if (cid >= 0) s.select({ type: "crossing", id: cid });
  } else if (id === "origins") s.select({ type: "zone", id: obj.z as number });
  else if (id === "stranded" || id === "isolated" || id === "final-stranded") s.select({ type: "zone", id: obj.zone as number });
}

export function placeOrMove(kind: InterventionKind, target: number, lon: number, lat: number, label: string) {
  const s = useGame.getState();
  const moving = s.selected?.type === "intervention" ? s.placements.find((p) => p.id === (s.selected as { id: string }).id) : null;
  if (moving && moving.kind === kind && movingFlag.id === moving.id) {
    s.move(moving.id, target, lon, lat, label);
    movingFlag.id = null;
    s.setTool(null);
    s.pushFeed(`Moved ${label}`, "info");
    return;
  }
  const ok = s.place({ kind, target, lon, lat, label });
  if (ok) s.pushFeed(`Placed: ${label}`, "success");
  else s.pushFeed("Not enough budget, or already placed there.", "warning");
}

/** Set by the inspector's Move button: the next valid click moves this placement. */
export const movingFlag: { id: string | null } = { id: null };

export function handleDeckHover(info: PickingInfo) {
  const s = useGame.getState();
  if (s.phase !== "planning" || !s.activeTool || !s.data) return;
  const spec = specFor(s.data.cfg, s.activeTool);
  const id = info.layer?.id ?? "";
  const obj = info.object as Record<string, unknown> | undefined;
  const target = obj && id === SNAP_LAYER[spec.snapsTo] ? targetFromPick(id, obj) : -1;
  const cur = s.hover;
  if (target < 0) {
    if (cur) s.setHover(null);
  } else if (!cur || cur.target !== target || cur.kind !== spec.id) {
    s.setHover({ kind: spec.id, target });
  }
}

export function deckTooltip(info: PickingInfo) {
  const s = useGame.getState();
  const obj = info.object as Record<string, unknown> | undefined;
  const id = info.layer?.id ?? "";
  const data = s.data;
  if (!obj || !data) return null;
  const cfg = cfgOf(s);
  const style = { background: "rgba(8,13,26,0.94)", color: "#e6edf7", border: "1px solid rgba(148,163,184,0.25)", borderRadius: "8px", fontSize: "12px", padding: "8px 10px", maxWidth: "260px" };
  const sub = (t: string) => `<br/><span style="color:#8796b0">${t}</span>`;
  if (id === "cand-shelterSite") {
    const risky = (obj.fcls as number) > 0 && cfg.hazard.type !== "heat";
    return { html: `<b>${obj.name}</b>${sub(`${obj.kind} · ${risky ? `⚠ inside the ${cfg.terms.hazardArea}` : `outside the ${cfg.terms.hazardArea}`}`)}`, style };
  }
  if (id === "cand-busStop") return { html: `<b>${obj.name || "Bus stop"}</b>${sub("Transit stop (OSM)")}`, style };
  if (id === "cand-fireStation") return { html: `<b>${obj.name}</b>${sub("Fire station")}`, style };
  if (id === "cand-shieldPoint") return { html: `<b>${obj.label}</b>${sub(obj.kind === "surge" ? "Surge-exposed shoreline" : "Rain and canal flooding pocket")}`, style };
  if (id === "cand-zone") return { html: `<b>${obj.name}</b>${sub(`${Math.round((obj.floodShare as number) * 100)}% of the area on liquefaction-prone ground`)}`, style };
  if (id === "crossings") {
    const c = data.crossings[obj.c as number];
    const close = s.coverage?.flood.edgeClose[obj.e as number] ?? Infinity;
    return { html: `<b>${c.label}</b>${sub(c.kind === "culvert" ? "Crossing outside the mapped hazard area" : Number.isFinite(close) ? `Expected to close around hour ${close.toFixed(1)}` : "Hazard-exposed")}`, style };
  }
  if (id === "zones") {
    const z = (obj as { properties: ZoneProps }).properties;
    return { html: `<b>${z.name}</b>${sub(`${z.atRisk.toLocaleString()} at-risk of ${z.pop.toLocaleString()} residents`)}`, style };
  }
  if (id === "origins") return { html: `<b>${Math.round(obj.pop as number).toLocaleString()} residents</b>${sub("At-risk household cluster")}`, style };
  if (id === "stranded" || id === "final-stranded") return { html: `<b>${Math.round(obj.w as number)} residents ${cfg.terms.strandedVerb}</b>`, style };
  if (id === "isolated") return { html: `<b>${Math.round(obj.w as number)} residents functionally isolated</b>`, style };
  if (id === "hospitals") return { html: `<b>${obj.name}</b>`, style };
  if (id === "closed") {
    const cid = data.edgeCrossing[obj.e as number];
    return { html: `<b>${cid >= 0 ? data.crossings[cid].label : data.graph.edgeName(obj.e as number)}</b><br/><span style="color:#fb7185">Closed at hour ${(obj.t as number).toFixed(1)}</span>`, style };
  }
  if (id === "placements" || id === "reference-placements") return { html: `<b>${obj.label}</b>`, style };
  return null;
}
