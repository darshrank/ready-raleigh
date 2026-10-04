// "Find the weak spot" (a special power, once per round): the engine tests every flood-prone road
// against the plan so far, the camera flies to the one that would keep the most residents in reach
// of safety, and one tap protects it.
import { useEffect } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PathLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import { COSTS } from '@shared/config';
import { currentStory } from '../story';
import { weakSpots, type WeakSpot } from '@shared/engine';
import type { FloodRoad } from '@shared/types';
import { create } from 'zustand';
import type { MapData } from '../data';
import { cameraForPoints, type Pad } from '../map/frame';
import { tokens } from '../tokens';
import { money } from '../ui/format';
import { PLATE } from '../ui/Hud';
import { playAlert, playScan, playStamp } from '../ui/sound';
import { budgetLeft, usePlan } from './store';
import { roadLabel } from './targets';
import { soloPlan } from './usePlanScore';

type State = 'idle' | 'scanning' | 'found' | 'used';

export const useWeakSpot = create<{ state: State; spot: WeakSpot | null; line: number; reset: () => void }>((set) => ({
  state: 'idle',
  spot: null,
  /** How many of the scan's lines are on screen. */
  line: 0,
  reset: () => set({ state: 'idle', spot: null, line: 0 }),
}));

// A fresh board (first planning, or Play again) gets the power back.
usePlan.subscribe((s, prev) => {
  if (s.phase === 'planning' && prev.phase !== 'planning' && prev.phase !== 'waiting') useWeakSpot.getState().reset();
});

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const lines = (roads: number) => [
  `Testing all ${roads} ${currentStory().roadKind} roads`,
  'Following who loses the way to safety',
  'Weighing who has no car',
];
const SCAN_MS = 2200;
/** The card's height under the clock: the camera keeps the road below it. */
const CARD_ROOM = 230;

function belowCard(pad: Pad): Pad {
  const p = typeof pad === 'number' ? { top: pad, right: pad, bottom: pad, left: pad } : pad;
  return { ...p, top: p.top + CARD_ROOM };
}

/** The road, highlighted on the map while the card is up: ink rim, alarm stripes. */
export function weakSpotLayers(road: FloodRoad | null) {
  if (!road) return [];
  const { rgb } = tokens();
  const common = { data: [road], getPath: (r: FloodRoad) => r.coords, widthUnits: 'pixels' as const, capRounded: true, jointRounded: true, parameters: { depthCompare: 'always' as const } };
  return [
    new PathLayer<FloodRoad>({ id: 'weak-spot-rim', ...common, getColor: [...rgb.ink, 255], getWidth: 15 }),
    new PathLayer<FloodRoad>({ id: 'weak-spot-face', ...common, getColor: [...rgb.signal, 255], getWidth: 9 }),
    new PathLayer<FloodRoad>({
      id: 'weak-spot-stripes',
      ...common,
      getColor: [...rgb.alarm, 255],
      getWidth: 9,
      getDashArray: [2, 2],
      dashJustified: true,
      extensions: [new PathStyleExtension({ dash: true })],
    } as never),
  ];
}

/** The power's button: runs the scan, then flies to the road it finds. */
export function WeakSpotPower({ data, map, pad }: { data: MapData; map: MapLibreMap | null; pad: Pad }) {
  const reduce = useReducedMotion();
  const state = useWeakSpot((s) => s.state);

  const run = () => {
    if (state !== 'idle') return;
    useWeakSpot.setState({ state: 'scanning', spot: null, line: 0 });
    playScan();
  };

  useEffect(() => {
    if (state !== 'scanning') return;
    const count = lines(0).length;
    const step = reduce ? 0 : SCAN_MS / count;
    const timers = Array.from({ length: count }, (_, k) => window.setTimeout(() => useWeakSpot.setState({ line: k }), k * step));
    timers.push(
      window.setTimeout(() => {
        const found = weakSpots(soloPlan(usePlan.getState().placements), data, 1)[0] ?? null;
        useWeakSpot.setState({ state: 'found', spot: found });
        playAlert();
        const road = found ? data.floodRoads.find((r) => r.id === found.roadId) : null;
        if (road && map && !map.isMoving()) {
          const cam = cameraForPoints(map, road.coords, 45, belowCard(pad));
          if (cam) map.flyTo({ ...cam, zoom: Math.min(cam.zoom, 15.2), duration: reduce ? 0 : 2200, essential: true });
        }
      }, reduce ? 0 : SCAN_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [state, data, map, pad, reduce]);

  return (
    <button
      type="button"
      onClick={run}
      disabled={state !== 'idle'}
      className="pointer-events-auto inline-flex items-center gap-2 border-(length:--rule) border-ink bg-bond px-3 py-2 text-15 font-semibold shadow-piece hover:bg-signal disabled:bg-chalk disabled:text-ink/50 disabled:shadow-none"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="fill-none stroke-current" strokeWidth="2">
        <circle cx="9" cy="9" r="6.5" />
        <circle cx="9" cy="9" r="2.2" />
        <path d="M9 0v4M9 14v4M0 9h4M14 9h4" />
      </svg>
      {state === 'idle' ? 'Find the weak spot' : state === 'scanning' ? 'Scanning' : 'Weak spot found'}
    </button>
  );
}

/** The scan, then the card naming the road: in the page's flow under the clock, so nothing overprints. */
export function WeakSpotPanel({ data }: { data: MapData }) {
  const reduce = useReducedMotion();
  const state = useWeakSpot((s) => s.state);
  const spot = useWeakSpot((s) => s.spot);
  const line = useWeakSpot((s) => s.line);
  const placements = usePlan((s) => s.placements);

  const road = spot ? data.floodRoads.find((r) => r.id === spot.roadId) ?? null : null;
  const story = currentStory();
  const isProtected = !!road && placements.some((p) => p.type === 'road_protection' && p.roadId === road.id);
  const canAfford = budgetLeft(placements) >= COSTS.road_protection;

  return (
    <AnimatePresence>
      {state === 'scanning' && (
        <motion.div
          key="scan"
          initial={reduce ? false : { y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ opacity: 0 }}
          className={PLATE + ' pointer-events-none w-[min(420px,calc(100vw-1.5rem))] p-4'}
          role="status"
        >
          <p className="font-display text-32 leading-none font-extrabold">Finding the weak spot</p>
          <ul className="mt-3 grid gap-1 text-15">
            {lines(data.floodRoads.length)
              .slice(0, line + 1)
              .map((l) => (
                <motion.li key={l} initial={reduce ? false : { x: -8, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
                  {l}…
                </motion.li>
              ))}
          </ul>
          <div className="mt-3 h-2 border-(length:--rule) border-ink bg-chalk">
            <motion.div className="h-full bg-alarm" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: reduce ? 0 : SCAN_MS / 1000, ease: 'linear' }} />
          </div>
        </motion.div>
      )}
      {state === 'found' && (
        <motion.section
          key="found"
          initial={reduce ? false : { y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ opacity: 0, y: 20 }}
          aria-labelledby="weak-spot-title"
          className={PLATE + ' pointer-events-auto w-[min(460px,calc(100vw-1.5rem))] border-l-8 border-l-alarm p-4'}
        >
          {road && spot ? (
            <>
              <p id="weak-spot-title" className="text-15 font-semibold">
                The weak spot in your plan
              </p>
              <h3 className="mt-1 font-display text-32 leading-none font-extrabold">{roadLabel(data, road)}</h3>
              <p className="mt-2 text-15">
                It {story.verb} at step {road.floodStep} ({story.steps[road.floodStep]?.toLowerCase()}). Keep it open and{' '}
                <strong>{fmt(spot.people)} more residents</strong> keep their way to safety. Protecting it costs {money(COSTS.road_protection)}.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={isProtected || !canAfford}
                  onClick={() => {
                    if (usePlan.getState().place({ type: 'road_protection', roadId: road.id })) playStamp();
                    useWeakSpot.setState({ state: 'used' });
                  }}
                  className="border-(length:--rule) border-ink bg-ink px-4 py-2 font-display text-24 leading-none font-extrabold text-signal hover:bg-signal hover:text-ink disabled:bg-chalk disabled:text-ink/50"
                >
                  {isProtected ? 'Protected' : canAfford ? 'Protect it' : 'Not enough budget'}
                </button>
                <button type="button" onClick={() => useWeakSpot.setState({ state: 'used' })} className="border-(length:--rule) border-ink bg-bond px-3 py-2 text-15 font-semibold hover:bg-chalk">
                  Not now
                </button>
              </div>
            </>
          ) : (
            <>
              <p id="weak-spot-title" className="font-display text-24 font-extrabold">
                No weak spot left
              </p>
              <p className="mt-1 text-15">Every {story.roadKind} road that matters is already covered by your plan.</p>
              <button type="button" onClick={() => useWeakSpot.setState({ state: 'used' })} className="mt-3 border-(length:--rule) border-ink bg-bond px-3 py-2 text-15 font-semibold hover:bg-chalk">
                Close
              </button>
            </>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
