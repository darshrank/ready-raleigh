// Solo flood game (DESIGN.md "Layouts"): the full-bleed map with floating plates in every phase.
// title (Raleigh orbiting, the briefing) -> intro (the camera flies down) -> planning (day HUD and
// tray) -> storm (night, weather, the news helicopter) -> results (day again, the card slides up).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
import type { FloodRoad, Placement } from '@shared/types';
import { useMapData } from '../data';
import { floodViewOf } from '../map/flood';
import { riskFocusPoints } from '../map/frame';
import { MapView } from '../map/MapView';
import { HOSPITAL_LABEL_ZOOM, busStopsLayer, existingSheltersLayers, hospitalLayers } from '../map/layers';
import { stormNight, useMapMood } from '../map/mood';
import { useFloodMap } from '../map/useFloodMap';
import { AimChip, LandingFx } from '../plan/Juice';
import {
  busAreaLayer,
  COVERAGE_RIM_ZOOM,
  coverageLayer,
  cursorLayer,
  floodRoadsLayer,
  linkLayers,
  ghostLayer,
  piecesLayer,
  previewLayer,
  protectedRoadsLayers,
  targetLayers,
} from '../plan/layers';
import { busStops, usefulRoads } from '../plan/targets';
import { lastLandingAt, usePlan } from '../plan/store';
import { useWeakSpot, WeakSpotPanel, WeakSpotPower, weakSpotLayers } from '../plan/WeakSpot';
import { floodAtRisk, soloPlan, usePlanScore } from '../plan/usePlanScore';
import { focusMap, usePlanning } from '../plan/usePlanning';
import { Link } from '../router';
import { useMapUi } from '../store';
import { directStorm, resetWater } from '../storm/director';
import { stormRenderer, stormWarmLayers } from '../storm/layers';
import { CLEAR_MS, RESULTS_AFTER_MS, STORM_MS, buildStorm, type StormEvent } from '../storm/sim';
import { Broadcast, Counters, SkipStorm } from '../storm/StormOverlay';
import { NewsDesk, preloadAnchors, useStormFx } from '../storm/NewsDesk';
import { newsFacts, type Mayor } from '../storm/newsFacts';
import { StormTimeline } from '../storm/Timeline';
import { Heat, Lightning, Quake, Rain, Wipe } from '../storm/Weather';
import { MapControls, MapLookButtons, PLATE, SoundButton, Status, TopHud, Tray } from '../ui/Hud';
import { NeighborhoodCard } from '../ui/MapRail';
import { playAlert } from '../ui/sound';
import { Title, useBriefingTour, useTitleOrbit } from '../ui/Title';
import { useBoard } from '../storm/Leaderboard';
import { ResultsPanel } from '../storm/Results';
import { cityById } from '../cities';
import { currentStory, type Hazard } from '../story';
import { useTheme } from '../theme';
import { score } from '@shared/engine';
import { useVoice } from '../ui/voice';
import { MenuButton } from '../ui/Exit';

/** Phones open on the highest-risk area at street level instead of the whole city. */
const PHONE = '(max-width: 639px)';
const HAZARD_NAME: Record<Hazard, string> = { flood: 'Flood', quake: 'Earthquake', heat: 'Heat wave' };
/** Below this width the HUD plates go compact. */
const COMPACT = '(max-width: 1023px)';

function useMedia(query: string) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setOn(m.matches);
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [query]);
  return on;
}

/**
 * Multiplayer (P9): the same game for one mayoral candidate. No title; planning ends at the room's
 * clock; "Start the storm" (or 0:00) sends the plan and waits; the storm starts on every phone at
 * once when the room says everyone is ready (`stormGo`).
 */
export interface RoomMode {
  code: string;
  /** Planning deadline on this device's clock (server time corrected). */
  endsAt: number;
  onLock: (placements: Placement[]) => void;
  /** Every candidate is ready (or out of time): start the storm now. */
  stormGo: boolean;
  /** Shown while this candidate waits for the others. */
  waiting: ReactNode;
  /** The election's results, on the results' leaderboard page above the city's all-time board. */
  standings: ReactNode;
  /** What comes next, on the results' last page instead of "Play again" (the host's Next election). */
  actions: ReactNode;
  /** This round's stored play and this player's id, for the public record and cards (P16). */
  playId: string | null;
  owner: string | null;
  /** This candidate's name and the other candidates' plans, for the news desk. */
  mayor: string;
  rivals: Mayor[];
}

export function Solo({ room }: { room?: RoomMode } = {}) {
  const roomRef = useRef(room);
  roomRef.current = room;
  // One city per page (?city=); rooms stay on Raleigh, the city their server scores.
  // Rooms too: the room page keeps ?city= on the room's city and remounts the game when it changes.
  const story = useMemo(() => currentStory(), [room]);
  const { data, error } = useMapData();
  const armed = usePlan((s) => s.armed);
  const selectedId = usePlan((s) => s.selectedId);
  const hover = usePlan((s) => s.hover);
  const movingId = usePlan((s) => s.movingId);
  const dragging = usePlan((s) => s.dragging);
  const cursor = usePlan((s) => s.cursor);
  const phase = usePlan((s) => s.phase);
  const stormAt = usePlan((s) => s.stormAt);
  const endStorm = usePlan((s) => s.endStorm);
  const storming = phase === 'storm' || phase === 'results';
  const reduce = !!useReducedMotion();
  // Decided once, at load: a phone that later rotates keeps its street-level opening.
  const [phone] = useState(() => window.matchMedia(PHONE).matches);
  const compact = useMedia(COMPACT);
  // Dev and scripts: /solo?skip opens straight on the planning board.
  const [skipTitle] = useState(() => !!room || new URLSearchParams(window.location.search).has('skip'));
  const [mapInst, setMapInst] = useState<MapLibreMap | null>(null);

  // Opening /solo always starts at the title (the store outlives the route).
  useEffect(() => {
    const s = usePlan.getState();
    s.restart();
    s.setHold(!!roomRef.current);
    if (skipTitle) s.beginIntro();
  }, [skipTitle]);
  // The news anchors' portraits load while the player plans, so the storm's desk opens on them.
  useEffect(() => preloadAnchors(), []);

  const theme = useTheme((s) => s.theme);
  const { placements, result, shares, preview, links, left } = usePlanScore(data);
  const moving = movingId ? placements.find((p) => p.id === movingId) : undefined;
  const fm = useFloodMap(data, { targetingSites: armed === 'shelter' || moving?.type === 'shelter', night: theme === 'dark' });
  const { onReady: planningReady, mapRef, selectFromList } = usePlanning(data);
  const onReady = useCallback(
    (m: MapLibreMap) => {
      setMapInst(m);
      const cleanup = planningReady(m);
      return () => {
        cleanup?.();
        setMapInst(null);
      };
    },
    [planningReady],
  );

  useTitleOrbit(mapInst, phase === 'title', phone);
  // Light or Dark on the board; in the storm, the city's clock (day, dusk, night, dawn).
  useMapMood(mapInst, phase, stormAt, reduce);
  // The narrated briefing tour over the creeks (ElevenLabs narrator, fail soft to a silent tour).
  const [tourStop, setTourStop] = useState<string | null>(null);
  const atRisk = useMemo(() => (data ? score(soloPlan([]), data).strandedPeople : 0), [data]);
  const script = useMemo(() => story.briefing(atRisk, cityById(story.id)!.tour), [atRisk, story]);
  useBriefingTour(mapInst, phase === 'title' && !!data, phone, script, setTourStop);

  // Room the floating plates take, so the framed city is not under them.
  const hudPad = useMemo(
    () => (compact ? { top: 96, right: 16, bottom: phone ? 250 : 190, left: 16 } : { top: 120, right: 40, bottom: 210, left: 40 }),
    [compact, phone],
  );
  const stormPad = useMemo(
    () => (compact ? { top: 110, right: 16, bottom: 130, left: 16 } : { top: 130, right: 40, bottom: 200, left: 40 }),
    [compact],
  );
  // The results panel sits at the bottom left on a wide screen (storm/Results.tsx, max-w-lg).
  const resultsPad = useMemo(
    () => (compact ? { top: 110, right: 16, bottom: phone ? 420 : 380, left: 16 } : { top: 110, right: 40, bottom: 40, left: 580 }),
    [compact, phone],
  );
  const cityFrame = useMemo(() => (data && phone ? riskFocusPoints(data) : fm.frame), [data, phone, fm.frame]);
  // The title leaves the camera to the orbit; the intro flies down to the frame.
  const frame = phase === 'title' ? null : cityFrame;
  const onFramed = useCallback(() => {
    const s = usePlan.getState();
    if (s.phase === 'intro') s.startPlanning(roomRef.current?.endsAt);
  }, []);

  // Rooms: the platform goes to the server the moment planning ends here.
  const lockedPhase = useRef(phase);
  useEffect(() => {
    const was = lockedPhase.current;
    lockedPhase.current = phase;
    if (was === 'planning' && phase === 'waiting') roomRef.current?.onLock(usePlan.getState().placements);
  }, [phase]);
  // Rooms: everyone is ready, so the storm starts here and on every other phone together.
  const stormGo = room?.stormGo ?? false;
  useEffect(() => {
    if (!stormGo) return;
    const s = usePlan.getState();
    if (s.phase === 'planning') s.endPlanning(); // the room closed while this phone was still planning
    usePlan.getState().startStorm();
  }, [stormGo, phase]);

  const rim = useMapUi((s) => s.zoom >= COVERAGE_RIM_ZOOM);
  const coverage = useMemo(() => (data ? coverageLayer(data, floodAtRisk(data), shares, rim) : null), [data, shares, rim]);
  const protectedIds = useMemo(
    () => new Set(placements.filter((p) => p.type === 'road_protection').map((p) => p.roadId!)),
    [placements],
  );
  const roads = useMemo(
    () => (data ? floodRoadsLayer(usefulRoads(data), protectedIds, armed === 'road_protection' || moving?.type === 'road_protection') : null),
    [data, protectedIds, armed, moving],
  );
  const protectedRoads = useMemo(
    () => (data ? protectedRoadsLayers(data.floodRoads.filter((r: FloodRoad) => protectedIds.has(r.id))) : []),
    [data, protectedIds],
  );
  // Bus pickups: while one is being placed, where it helps and the existing stops there.
  const placingBus = armed === 'bus_pickup' || moving?.type === 'bus_pickup';
  const busArea = useMemo(() => (data ? busAreaLayer(data, placingBus) : null), [data, placingBus]);
  const stops = useMemo(() => (data ? busStopsLayer(busStops(data), placingBus) : null), [data, placingBus]);
  // Bus -> shelter lines: the preview's while aiming, else the plan's.
  const shownLinks = preview && !preview.problem && (preview.piece.type === 'bus_pickup' || preview.piece.type === 'shelter') ? preview.links : links;
  const linkLayer = useMemo(() => linkLayers(shownLinks), [shownLinks]);
  // While a piece is dragged to a valid spot, it lifts off its old place and shows at the new one.
  const hiddenId = dragging && preview && !preview.problem ? movingId : null;
  const pieces = useMemo(
    () => (data ? piecesLayer(data, placements, selectedId, hiddenId) : null),
    [data, placements, selectedId, hiddenId],
  );

  const weakSpot = useWeakSpot((s) => (s.state === 'found' ? s.spot : null));
  const weakRoad = useMemo(() => (data && weakSpot ? (data.floodRoads.find((r) => r.id === weakSpot.roadId) ?? null) : null), [data, weakSpot]);
  const layers = useMemo((): Layer[] => {
    if (!data || !coverage || !roads || !pieces) return [];
    if (phase === 'title' || phase === 'intro') return [...fm.base, ...stormWarmLayers()].map((l) => l.clone({}));
    const target = targetLayers(data, hover);
    const roadTarget = hover?.type === 'road_protection';
    return [
      ...fm.base,
      ...(busArea ? [busArea] : []),
      coverage,
      previewLayer(data, preview?.cells ?? []),
      ...(roadTarget ? target : []),
      roads,
      ...protectedRoads,
      ...(phase === 'planning' ? weakSpotLayers(weakRoad) : []),
      ...fm.hospitals,
      ...linkLayer,
      ...fm.existing,
      ...(stops ? [stops] : []),
      fm.sites,
      ...cursorLayer(data, cursor),
      ...(roadTarget ? [] : target),
      pieces,
      ghostLayer(data, preview && !preview.problem ? preview.piece : null, !!movingId),
      ...stormWarmLayers(),
      // deck.gl cannot take back a layer instance it dropped (the storm drops the planning-only
      // ones), so hand it clones. The props are unchanged, so deck.gl updates nothing.
    ].map((l) => l.clone({}));
    // `storming` is a dependency on purpose: coming back from the storm needs fresh clones.
  }, [data, phase, fm.base, fm.hospitals, fm.existing, fm.sites, busArea, stops, linkLayer, coverage, roads, protectedRoads, pieces, preview, hover, cursor, movingId, storming, weakRoad]);

  // The storm: built once when planning ends (the plan is locked), animated by MapView's frame loop.
  const storm = useMemo(() => (data && storming ? buildStorm(data, placements) : null), [data, storming, placements]);
  // What the news desk reports on: the storm's moments and the plans in it (Gemini writes the lines).
  // Play builds the rivals array on every render, so the memo keys on its content.
  const rivalsKey = JSON.stringify(room?.rivals ?? []);
  const facts = useMemo(
    () => (data && storm ? newsFacts(storm, data, story, placements, roomRef.current?.mayor ?? null, JSON.parse(rivalsKey) as Mayor[]) : null),
    [data, storm, story, placements, rivalsKey],
  );
  const frameLayers = useMemo(() => {
    if (!data || !storm || stormAt === null || !pieces) return null;
    const renderer = stormRenderer(storm, reduce);
    // Shelter sites are planning targets; the storm shows only the plan's pieces, the existing
    // shelters (people head there too) and the hospitals, named in the night label colors while the
    // map is dark (map/mood.ts).
    const night: LayersList = [...hospitalLayers(data.hospitals, true, HOSPITAL_LABEL_ZOOM, true),
      ...existingSheltersLayers(data.existingShelters, 0, true), pieces];
    const day: LayersList = [...hospitalLayers(data.hospitals, true, HOSPITAL_LABEL_ZOOM), ...existingSheltersLayers(data.existingShelters, 0), pieces];
    let done = false;
    return (now: number) => {
      if (done) return null;
      const t = now - stormAt;
      done = renderer.settled(t);
      return [...fm.under, ...renderer.layers(t), ...(stormNight(t, theme) ? night : day)];
    };
  }, [data, storm, stormAt, reduce, pieces, fm.under, theme]);

  // The siren at the outbreak, rushing water and a buzz as each flood step prints.
  useStormFx(phase === 'storm' ? storm : null, stormAt);

  // The storm on the map: night, water, submerged streets, the helicopter, then the clear.
  const [live, setLive] = useState<StormEvent | null>(null);
  useEffect(() => {
    if (!mapInst || !storm || stormAt === null || !cityFrame) return;
    return directStorm(mapInst, floodViewOf(mapInst), storm, stormAt, {
      frame: cityFrame,
      stormPad,
      dayPad: resultsPad,
      reduce,
      onEvent: setLive,
    });
    // cityFrame is fixed for the page; the storm restarts only with a new clock (start or skip).
  }, [mapInst, storm, stormAt, reduce]);

  // The wipe and the alert chime play once, when the storm starts (not again on a skip).
  const [stormStart, setStormStart] = useState<number | null>(null);
  const lastPhase = useRef(phase);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = phase;
    if (phase === 'storm' && was === 'planning') {
      setStormStart(usePlan.getState().stormAt);
      playAlert();
    }
    // A room's next round mounts a new game, so the last round's board is cleared here, not on Play again.
    if (phase === 'storm' && was !== 'storm') useBoard.getState().reset();
    // A finished game goes on its city's leaderboard. Solo plays are saved here (they also feed the
    // planners' reports and the public record); a room's were saved by the server, so its board
    // only loads, with this candidate's row marked.
    if (phase === 'results' && was === 'storm') {
      const r = roomRef.current;
      if (r) useBoard.getState().watch(story.id, r.owner ?? '');
      else useBoard.getState().submit(usePlan.getState().placements, story.id);
    }
    // Another round: back to the calm board.
    if (phase === 'planning' && (was === 'results' || was === 'storm')) {
      useBoard.getState().reset();
      if (mapInst) resetWater(floodViewOf(mapInst));
    }
  }, [phase, mapInst, story]);

  useEffect(() => {
    if (phase !== 'storm' || stormAt === null) return;
    const id = setTimeout(endStorm, Math.max(0, stormAt + STORM_MS + RESULTS_AFTER_MS - performance.now()));
    return () => clearTimeout(id);
  }, [phase, stormAt, endStorm]);

  // The broadcast belongs to the storm: it leaves when the sky clears, except that the anchor may
  // finish the last report during the clear-up (the desk stays until the line ends).
  const anchorTalking = useVoice((s) => s.line !== null);
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    if (stormAt === null) return setCleared(false);
    const wait = stormAt + STORM_MS - performance.now();
    setCleared(wait <= 0);
    if (wait <= 0) return;
    const id = setTimeout(() => setCleared(true), wait);
    return () => clearTimeout(id);
  }, [stormAt]);

  // A plain map click (nothing armed) deselects the piece and opens the neighborhood card.
  const baseClick = fm.onClick;
  const onClick = useCallback(
    (info: PickingInfo) => {
      const s = usePlan.getState();
      // deck.gl reports the tap that placed a piece as a click too (touch); that one is not for the card.
      if (s.armed || s.phase !== 'planning' || performance.now() - lastLandingAt < 600) return;
      if (s.selectedId) s.select(null);
      baseClick(info);
    },
    [baseClick],
  );

  const onArmed = useCallback((byKeyboard: boolean) => byKeyboard && focusMap(mapRef.current), [mapRef]);
  const enter = (from: 'top' | 'bottom', delay = 0) =>
    reduce
      ? {}
      : {
          initial: { y: from === 'top' ? -90 : 160, opacity: 0 },
          animate: { y: 0, opacity: 1 },
          transition: { type: 'spring' as const, stiffness: 300, damping: 26, delay },
        };

  return (
    <div className={'relative h-full overflow-hidden ' + (theme === 'dark' ? 'bg-storm-land' : 'bg-chalk')}>
      <MapView
        layers={layers}
        frameLayers={frameLayers}
        frame={frame}
        flyToFrame={!skipTitle}
        framePad={hudPad}
        onFramed={onFramed}
        tiltControl={false}
        onClick={onClick}
        onReady={onReady}
        keyboard={false}
        cursor={dragging ? 'grabbing' : armed ? 'crosshair' : null}
        label={`Map of ${story.name}. Arrow keys move the cursor, Enter places the piece, Delete removes it.`}
      />

      {data && mapInst && phase === 'planning' && (
        <>
          <AimChip map={mapInst} data={data} preview={preview} />
          <LandingFx map={mapInst} data={data} />
        </>
      )}

      {phase === 'storm' && stormAt !== null && story.hazard === 'flood' && !reduce && (
        <>
          <Rain stormAt={stormAt} night={(t) => stormNight(t, theme)} />
          <Lightning stormAt={stormAt} />
        </>
      )}
      {phase === 'storm' && stormAt !== null && story.hazard === 'quake' && <Quake stormAt={stormAt} reduce={reduce} />}
      {phase === 'storm' && stormAt !== null && story.hazard === 'heat' && <Heat stormAt={stormAt} reduce={reduce} />}
      {stormStart !== null && phase === 'storm' && !reduce && <Wipe key={stormStart} />}

      {(phase === 'title' || phase === 'intro') && (
        <motion.div
          className="absolute inset-0"
          animate={{ opacity: phase === 'title' ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.35 }}
          style={{ pointerEvents: phase === 'title' ? 'auto' : 'none' }}
        >
          <Title ready={!!data} error={error} onStart={() => usePlan.getState().beginIntro()} stop={tourStop} />
        </motion.div>
      )}

      {phase === 'planning' && data && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3 lg:p-5">
          {/* A second row holds the weak spot's panel under the clock; the controls span both rows. */}
          <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:grid-rows-[auto_1fr] lg:items-start">
            <motion.p {...enter('top')} className={PLATE + ' pointer-events-auto hidden justify-self-start px-3 py-2 lg:block'}>
              <Link to="/" className="font-display text-24 leading-none font-extrabold">
                Mayday Mayor
              </Link>
              <span className="block text-13">
                {story.name} · {room ? `Flood, room ${room.code}` : `${HAZARD_NAME[story.hazard]}, solo`}
              </span>
            </motion.p>
            <motion.div {...enter('top', 0.05)} className="flex justify-center">
              <TopHud left={left} result={result} compact={compact} />
            </motion.div>
            <motion.div {...enter('top', 0.1)} className="flex flex-col items-end gap-2 justify-self-end lg:row-span-2">
              <div className="flex items-start gap-2">
                <MenuButton />
                <MapControls phase="planning" />
              </div>
              {!phone && (
                <div className={PLATE + ' pointer-events-auto empty:hidden w-80 max-w-full p-4'}>
                  <NeighborhoodCard cells={data.cells} hideEmpty />
                </div>
              )}
            </motion.div>
            {data.floodRoads.length > 0 && (
              <div className="flex justify-center empty:hidden lg:col-start-2">
                <WeakSpotPanel data={data} />
              </div>
            )}
          </div>
          <motion.div {...enter('bottom', 0.1)} className="flex flex-col items-center gap-2">
            {phone && (
              <div className={PLATE + ' pointer-events-auto empty:hidden w-full p-3'}>
                <NeighborhoodCard cells={data.cells} hideEmpty compact />
              </div>
            )}
            <div className="flex flex-wrap items-end justify-center gap-2">
              {data.floodRoads.length > 0 && <WeakSpotPower data={data} map={mapInst} pad={hudPad} />}
              <Status data={data} preview={preview} />
            </div>
            <Tray data={data} left={left} compact={compact} onArmed={onArmed} onSelect={selectFromList} />
          </motion.div>
        </div>
      )}

      {phase === 'waiting' && room && (
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-3 pb-6 lg:items-center">
          <div className={PLATE + ' pointer-events-auto w-full max-w-md p-4 lg:p-6'} role="status">
            {room.waiting}
          </div>
        </div>
      )}

      {storm && stormAt !== null && (
        // Rows, so nothing overprints: the band (with the controls under its right end), the news
        // desk in whatever room is left, then the timeline and the counters (or the results card).
        <div className="pointer-events-none absolute inset-0 flex flex-col overflow-hidden">
          <div className="relative z-10 shrink-0">
            <AnimatePresence>
              {!cleared && (
                <motion.div key="band" exit={reduce ? undefined : { y: '-110%' }} transition={{ duration: 0.4, ease: 'easeIn' }}>
                  <Broadcast storm={storm} stormAt={stormAt} live={live} />
                </motion.div>
              )}
            </AnimatePresence>
            <div className={(cleared ? 'top-3 lg:top-5 ' : 'top-full mt-2 ') + 'absolute right-3 lg:right-5'}>
              {phase === 'results' ? (
                <MapControls phase="results" />
              ) : (
                <div className="flex gap-2">
                  <MenuButton />
                  <SkipStorm />
                  <MapLookButtons />
                  <SoundButton />
                </div>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-stretch px-3 pt-14 pb-2 lg:items-start lg:px-6 lg:pt-1">
            {phase === 'storm' && (!cleared || anchorTalking) && <NewsDesk storm={storm} stormAt={stormAt} facts={facts} />}
          </div>
          {phase === 'results' ? (
            data && (
              <div className="flex shrink-0 justify-center px-3 pb-4 lg:justify-start lg:px-8 lg:pb-8">
                <ResultsPanel
                  storm={storm}
                  result={result}
                  data={data}
                  placements={placements}
                  story={story}
                  room={room ? { standings: room.standings, actions: room.actions, playId: room.playId, owner: room.owner, mayor: room.mayor } : undefined}
                />
              </div>
            )
          ) : (
            <div className="flex shrink-0 flex-col items-center">
              <StormTimeline storm={storm} stormAt={stormAt} />
              <div className="w-full">
                <Counters storm={storm} stormAt={stormAt} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
