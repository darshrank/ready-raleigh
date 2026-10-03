// Solo flood game: planning (P6), then the storm (P7) and a results card. Desktop: map left, rail
// right. Phone (390 px): budget and timer on top, the map, and the tray in a bottom sheet
// (DESIGN.md "Layouts"); the storm gives the phone the whole screen below the header.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
import type { FloodRoad } from '@shared/types';
import { useMapData } from '../data';
import { riskFocusPoints } from '../map/frame';
import { MapView } from '../map/MapView';
import { useFloodMap } from '../map/useFloodMap';
import {
  coverageLayer,
  cursorLayer,
  floodRoadsLayer,
  ghostLayer,
  piecesLayer,
  previewLayer,
  protectedRoadsLayers,
  targetLayers,
} from '../plan/layers';
import { usePlan } from '../plan/store';
import { floodAtRisk, usePlanScore } from '../plan/usePlanScore';
import { focusMap, usePlanning } from '../plan/usePlanning';
import { Link } from '../router';
import { stormRenderer, stormWarmLayers } from '../storm/layers';
import { STORM_MS, buildStorm } from '../storm/sim';
import { Broadcast, Counters, ResultsCard } from '../storm/StormOverlay';
import { FacilitiesControl, Legend, NeighborhoodCard, PeopleLayerControl } from '../ui/MapRail';
import { Budget, Covered, PlanList, StartStorm, Status, Timer, Tray } from '../ui/PlanPanel';

/** Phones open on the highest-risk area at street level instead of the whole city. */
const PHONE = '(max-width: 639px)';

export function Solo() {
  const { data, error } = useMapData();
  const armed = usePlan((s) => s.armed);
  const selectedId = usePlan((s) => s.selectedId);
  const hover = usePlan((s) => s.hover);
  const movingId = usePlan((s) => s.movingId);
  const dragging = usePlan((s) => s.dragging);
  const cursor = usePlan((s) => s.cursor);
  const endsAt = usePlan((s) => s.endsAt);
  const startPlanning = usePlan((s) => s.startPlanning);
  const phase = usePlan((s) => s.phase);
  const stormAt = usePlan((s) => s.stormAt);
  const endStorm = usePlan((s) => s.endStorm);
  const storming = phase !== 'planning';
  const reduce = !!useReducedMotion();
  // Decided once, at load: a phone that later rotates keeps its street-level opening.
  const [phone] = useState(() => window.matchMedia(PHONE).matches);

  const { placements, result, shares, preview, left } = usePlanScore(data);
  const moving = movingId ? placements.find((p) => p.id === movingId) : undefined;
  const map = useFloodMap(data, { targetingSites: armed === 'shelter' || moving?.type === 'shelter' });
  const { onReady, mapRef, selectFromList } = usePlanning(data);
  const frame = useMemo(() => (data && phone ? riskFocusPoints(data) : map.frame), [data, phone, map.frame]);

  // The clock starts when the board is on screen.
  useEffect(() => {
    if (data && endsAt === null) startPlanning();
  }, [data, endsAt, startPlanning]);

  const coverage = useMemo(() => (data ? coverageLayer(data, floodAtRisk(data), shares) : null), [data, shares]);
  const protectedIds = useMemo(
    () => new Set(placements.filter((p) => p.type === 'road_protection').map((p) => p.roadId!)),
    [placements],
  );
  const roads = useMemo(
    () => (data ? floodRoadsLayer(data.floodRoads, protectedIds, armed === 'road_protection' || moving?.type === 'road_protection') : null),
    [data, protectedIds, armed, moving],
  );
  const protectedRoads = useMemo(
    () => (data ? protectedRoadsLayers(data.floodRoads.filter((r: FloodRoad) => protectedIds.has(r.id))) : []),
    [data, protectedIds],
  );
  // While a piece is dragged to a valid spot, it lifts off its old place and shows at the new one.
  const hiddenId = dragging && preview && !preview.problem ? movingId : null;
  const pieces = useMemo(
    () => (data ? piecesLayer(data, placements, selectedId, hiddenId) : null),
    [data, placements, selectedId, hiddenId],
  );

  const layers = useMemo((): Layer[] => {
    if (!data || !coverage || !roads || !pieces) return [];
    const target = targetLayers(data, hover);
    const roadTarget = hover?.type === 'road_protection';
    return [
      ...map.base,
      coverage,
      previewLayer(data, preview?.cells ?? []),
      ...(roadTarget ? target : []),
      roads,
      ...protectedRoads,
      ...map.hospitals,
      map.sites,
      ...cursorLayer(data, cursor),
      ...(roadTarget ? [] : target),
      pieces,
      ghostLayer(data, preview && !preview.problem ? preview.piece : null, !!movingId),
      ...stormWarmLayers(),
      // deck.gl cannot take back a layer instance it dropped (the storm drops the planning-only
      // ones), so hand it clones. The props are unchanged, so deck.gl updates nothing.
    ].map((l) => l.clone({}));
    // `storming` is a dependency on purpose: coming back from the storm needs fresh clones.
  }, [data, map.base, map.hospitals, map.sites, coverage, roads, protectedRoads, pieces, preview, hover, cursor, movingId, storming]);

  // The storm: built once when planning ends (the plan is locked), animated by MapView's frame loop.
  const storm = useMemo(() => (data && storming ? buildStorm(data, placements) : null), [data, storming, placements]);
  const frameLayers = useMemo(() => {
    if (!data || !storm || stormAt === null || !pieces) return null;
    const renderer = stormRenderer(storm, data, reduce);
    const top: LayersList = [...map.hospitals, map.sites, pieces];
    let done = false;
    return (now: number) => {
      if (done) return null;
      const t = now - stormAt;
      done = renderer.settled(t);
      return [...map.under, ...renderer.water(t), ...renderer.residents(t), ...top];
    };
  }, [data, storm, stormAt, reduce, pieces, map.under, map.hospitals, map.sites]);

  useEffect(() => {
    if (phase !== 'storm' || stormAt === null) return;
    const id = setTimeout(endStorm, Math.max(0, stormAt + STORM_MS - performance.now()));
    return () => clearTimeout(id);
  }, [phase, stormAt, endStorm]);

  // A plain map click (nothing armed) deselects the piece and opens the neighborhood card.
  const baseClick = map.onClick;
  const onClick = useCallback(
    (info: PickingInfo) => {
      const s = usePlan.getState();
      if (s.armed) return;
      if (s.selectedId) s.select(null);
      baseClick(info);
    },
    [baseClick],
  );

  const onArmed = useCallback((byKeyboard: boolean) => byKeyboard && focusMap(mapRef.current), [mapRef]);

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Phone: budget and timer above the map. */}
      <header className="flex items-center justify-between gap-3 border-b-(length:--rule) border-ink bg-bond px-4 py-2 lg:hidden">
        <Budget left={left} compact />
        <Timer compact />
      </header>

      <div className="relative min-h-0 flex-1">
        <MapView
          layers={layers}
          frameLayers={frameLayers}
          frame={frame}
          tiltControl={!storming}
          onClick={onClick}
          onReady={onReady}
          keyboard={false}
          cursor={dragging ? 'grabbing' : armed ? 'crosshair' : null}
          label="Map of Raleigh. Arrow keys move the cursor, Enter places the piece, Delete removes it."
        />
        {storm && stormAt !== null && (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between overflow-hidden">
            <Broadcast storm={storm} stormAt={stormAt} />
            {phase === 'results' && (
              <div className="flex justify-center px-3 lg:justify-start lg:px-6">
                <ResultsCard storm={storm} result={result} />
              </div>
            )}
            <Counters storm={storm} stormAt={stormAt} />
          </div>
        )}
      </div>

      <aside
        className={
          (storming ? 'hidden lg:flex ' : 'flex ') +
          'max-h-[46svh] shrink-0 flex-col gap-4 overflow-y-auto border-t-(length:--rule) border-ink bg-bond px-4 py-3 lg:h-full lg:max-h-none lg:w-[30%] lg:max-w-[460px] lg:min-w-[360px] lg:gap-5 lg:border-t-0 lg:border-l-(length:--rule) lg:px-6 lg:py-6'
        }
      >
        <header className="hidden items-baseline justify-between gap-3 lg:flex">
          <h1 className="font-display text-32 font-extrabold">Flood, solo</h1>
          <Link to="/" className="text-13 underline">
            Ready Raleigh
          </Link>
        </header>
        <div className="hidden items-end justify-between gap-3 lg:flex">
          <Budget left={left} />
          <Timer />
        </div>

        {error ? (
          <p className="text-15">Could not load the map data ({error}). Reload the page to try again.</p>
        ) : !data ? (
          <p className="text-15">Loading the map.</p>
        ) : (
          <>
            <Covered result={result} preview={preview} />
            {!storming && <Tray left={left} onArmed={onArmed} />}
            <Status data={data} preview={preview} />
            <StartStorm />
            <PlanList data={data} onSelect={selectFromList} />
            <div className="grid gap-3 border-t-(length:--rule) border-ink pt-4">
              <FacilitiesControl />
              <PeopleLayerControl />
            </div>
            <NeighborhoodCard cells={data.cells} />
            <Legend planning={!storming} storm={storming} />
            <p className="text-13">
              Keys: 1, 2, 3 pick a piece. Arrows move the cursor, Enter places or moves, Delete removes, Esc
              cancels, + and − zoom.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
