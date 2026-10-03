// Planning phase state (P6). The engine stays the judge of coverage and score; this store only
// holds what the player did and refuses moves the rules forbid (over budget, two pieces on one site).
import { create } from 'zustand';
import { BUDGET, COSTS, PLANNING_SECONDS } from '@shared/config';
import { planCost } from '@shared/engine';
import type { Placement } from '@shared/types';
import type { FloodPiece } from './pieces';

/** Where a piece can go: shelters on a site, bus pickups on a cell, road protection on a flood road. */
export type Target =
  | { type: 'shelter'; siteId: string }
  | { type: 'bus_pickup'; cell: number }
  | { type: 'road_protection'; roadId: string };

/**
 * title (the orbiting city and the briefing) -> intro (the camera flies down) -> planning ->
 * storm (the flood simulation plays) -> results (the card). Play again goes back to planning.
 */
export type Phase = 'title' | 'intro' | 'planning' | 'storm' | 'results';

export const sameTarget = (a: Target | null, b: Target | null) =>
  a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

export function placementFor(id: string, t: Target): Placement {
  return { id, ...t };
}

export const targetOf = (p: Placement): Target | null =>
  p.type === 'shelter' && p.siteId !== undefined
    ? { type: 'shelter', siteId: p.siteId }
    : p.type === 'bus_pickup' && p.cell !== undefined
      ? { type: 'bus_pickup', cell: p.cell }
      : p.type === 'road_protection' && p.roadId !== undefined
        ? { type: 'road_protection', roadId: p.roadId }
        : null;

export const budgetLeft = (placements: Placement[]) => BUDGET - planCost(placements);

/** When a piece last landed (performance.now() ms): the tap that placed it must not also open a card. */
export let lastLandingAt = -Infinity;

/** Why `t` cannot take a piece (`movingId` is the piece being moved, which may stay where it is). */
export function targetProblem(placements: Placement[], t: Target, movingId: string | null = null): string | null {
  const others = placements.filter((p) => p.id !== movingId);
  if (t.type === 'shelter' && others.some((p) => p.type === 'shelter' && p.siteId === t.siteId))
    return 'This building already has a shelter.';
  if (t.type === 'road_protection' && others.some((p) => p.type === 'road_protection' && p.roadId === t.roadId))
    return 'This road is already protected.';
  if (movingId === null && COSTS[t.type] > budgetLeft(placements)) return 'Not enough budget left for this piece.';
  return null;
}

interface PlanStore {
  phase: Phase;
  placements: Placement[];
  /** The tray piece waiting to be placed. */
  armed: FloodPiece | null;
  selectedId: string | null;
  /** The target under the pointer or the keyboard cursor, for the armed piece or the moving one. */
  hover: Target | null;
  /** Piece the hover would move (drag or keyboard), or null when the hover is a new placement. */
  movingId: string | null;
  dragging: boolean;
  /** Keyboard cell cursor; null until the player first presses an arrow key. */
  cursor: number | null;
  /** Planning ends at this time (ms since epoch). */
  endsAt: number | null;
  /** Short message for the status line after a refused action. */
  notice: string | null;
  /** When the storm started (performance.now() ms), the simulation's clock. */
  stormAt: number | null;
  nextId: number;

  arm: (piece: FloodPiece | null) => void;
  select: (id: string | null) => void;
  setHover: (t: Target | null, movingId?: string | null) => void;
  setDragging: (on: boolean) => void;
  setCursor: (cell: number | null) => void;
  setNotice: (text: string | null) => void;
  place: (t: Target) => boolean;
  move: (id: string, t: Target) => boolean;
  remove: (id: string) => void;
  /** "Start planning" on the title: the camera flies down; startPlanning follows when it lands. */
  beginIntro: () => void;
  startPlanning: () => void;
  endPlanning: () => void;
  /** Move the storm clock to `endMs` (the storm's length): it clears and the results follow. */
  skipStorm: (endMs: number) => void;
  endStorm: () => void;
  /** Another round: straight back to planning with an empty board. */
  reset: () => void;
  /** Back to the title, as on a fresh page load. */
  restart: () => void;
}

const fresh = () => ({
  phase: 'title' as Phase,
  placements: [] as Placement[],
  armed: null,
  selectedId: null,
  hover: null,
  movingId: null,
  dragging: false,
  cursor: null,
  endsAt: null,
  notice: null,
  stormAt: null,
  nextId: 1,
});

export const usePlan = create<PlanStore>((set, get) => ({
  ...fresh(),

  arm: (armed) => {
    if (armed && COSTS[armed] > budgetLeft(get().placements)) {
      set({ notice: 'Not enough budget left for this piece. Remove one to free up money.' });
      return;
    }
    set({ armed, selectedId: null, hover: null, movingId: null, notice: null });
  },
  select: (selectedId) => set({ selectedId, armed: null, hover: null, movingId: null, notice: null }),
  setHover: (hover, movingId = null) => {
    const s = get();
    if (sameTarget(s.hover, hover) && s.movingId === movingId) return;
    set({ hover, movingId });
  },
  setDragging: (dragging) => set({ dragging }),
  setCursor: (cursor) => set({ cursor }),
  setNotice: (notice) => set({ notice }),

  place: (t) => {
    const s = get();
    if (s.phase !== 'planning') return false;
    const problem = targetProblem(s.placements, t);
    if (problem) {
      set({ notice: problem });
      return false;
    }
    const id = `${t.type}-${s.nextId}`;
    lastLandingAt = performance.now();
    set({
      placements: [...s.placements, placementFor(id, t)],
      nextId: s.nextId + 1,
      armed: null,
      hover: null,
      movingId: null,
      selectedId: id,
      notice: null,
    });
    return true;
  },

  move: (id, t) => {
    const s = get();
    const piece = s.placements.find((p) => p.id === id);
    if (s.phase !== 'planning' || !piece || piece.type !== t.type) return false;
    const problem = targetProblem(s.placements, t, id);
    if (problem) {
      set({ notice: problem });
      return false;
    }
    lastLandingAt = performance.now();
    set({
      placements: s.placements.map((p) => (p.id === id ? placementFor(id, t) : p)),
      hover: null,
      movingId: null,
      selectedId: id,
      notice: null,
    });
    return true;
  },

  remove: (id) => {
    const s = get();
    if (s.phase !== 'planning') return;
    set({
      placements: s.placements.filter((p) => p.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      hover: null,
      movingId: null,
      notice: null,
    });
  },

  beginIntro: () => {
    if (get().phase === 'title') set({ phase: 'intro' });
  },
  startPlanning: () =>
    set({ phase: 'planning', stormAt: null, endsAt: Date.now() + PLANNING_SECONDS * 1000, armed: null, hover: null, notice: null }),
  endPlanning: () => {
    if (get().phase !== 'planning') return;
    set({ phase: 'storm', stormAt: performance.now(), armed: null, selectedId: null, hover: null, movingId: null, dragging: false });
  },
  skipStorm: (endMs) => {
    const s = get();
    if (s.phase === 'storm' && s.stormAt !== null) set({ stormAt: Math.min(s.stormAt, performance.now() - endMs) });
  },
  endStorm: () => {
    if (get().phase === 'storm') set({ phase: 'results' });
  },
  reset: () => set({ ...fresh(), phase: 'planning', endsAt: Date.now() + PLANNING_SECONDS * 1000 }),
  restart: () => set(fresh()),
}));

// Dev only: lets screenshot scripts and the console read and drive the plan.
if (import.meta.env.DEV) (window as unknown as { __plan?: typeof usePlan }).__plan = usePlan;
