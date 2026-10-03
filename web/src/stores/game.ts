"use client";

import { create } from "zustand";
import { CITY_SCENARIOS, ROOM, ROUND, specFor, type InterventionKind, type ScenarioParams } from "@/config/game";
import type { CityData } from "@/lib/data/city-data";
import type { AchillesScan } from "@/lib/engine/achilles";
import { createCoverageContext, evaluatePlan, type CoverageContext, type StaticEval } from "@/lib/engine/coverage";
import { resolveEvents, type ResolvedEvents } from "@/lib/engine/events";
import { EMPTY_PLAN, toEnginePlan } from "@/lib/engine/plan";
import { dailySeed } from "@/lib/engine/rng";
import type { SimResult } from "@/lib/engine/simulate";
import type { BotResult, ReferenceResult } from "@/lib/engine/worker-types";
import type { CameraMode, CityId, Phase, PlacedIntervention, SelectedEntity } from "@/types";

export type GameMode = "solo" | "multiplayer" | "planner" | "daily" | "ai";
export type Theme = "auto" | "day" | "night";
export type LayerKey = "flood" | "zones" | "atRisk" | "roads" | "facilities" | "buildings";
export type IntelKey = "demographic" | "fragility" | "health" | "floodDetail";

export const INTEL: Record<IntelKey, { label: string; description: string }> = {
  demographic: { label: "Demographic Scan", description: "Reveal where households without a car and older adults live." },
  fragility: { label: "Road Fragility Scan", description: "Reveal every flood-prone crossing and when it is expected to close." },
  health: { label: "Health Access Scan", description: "Reveal hospitals and 30-minute hospital access." },
  floodDetail: { label: "Hazard Detail", description: "Split the hazard layer into its classes and sources." },
};

/** Intel descriptions that depend on the hazard. */
export function intelLabel(k: IntelKey, type: string): { label: string; description: string } {
  if (k === "fragility" && type === "heat") return { label: "Grid Fragility Scan", description: "Reveal which cooling sites sit in the densest, most strained blocks." };
  if (k === "fragility" && type === "quake") return { label: "Road Damage Scan", description: "Reveal roads through liquefaction zones that are expected to fail." };
  if (k === "floodDetail" && type === "heat") return { label: "Heat Detail", description: "Show block-by-block heat instead of the smoothed map." };
  if (k === "floodDetail" && type === "quake") return { label: "Liquefaction Detail", description: "Split ground failure into high and moderate hazard." };
  if (k === "floodDetail" && type === "coastal") return { label: "Surge vs. Rain Detail", description: "Separate storm surge, rain ponding and canal flooding." };
  return INTEL[k];
}

interface GameState {
  phase: Phase;
  cityId: CityId | null;
  hoverCity: CityId | null;
  mode: GameMode;
  seed: number;
  roomCode: string;

  data: CityData | null;
  coverage: CoverageContext | null;
  events: ResolvedEvents | null;
  baseline: StaticEval | null;
  estimate: StaticEval | null;

  placements: PlacedIntervention[];
  past: PlacedIntervention[][];
  future: PlacedIntervention[][];
  activeTool: InterventionKind | null;
  hover: { kind: InterventionKind; target: number } | null;
  selected: SelectedEntity;

  timeLeft: number;
  timerRunning: boolean;
  freezeLeft: number;
  timeFreezeUsed: boolean;
  intelTokens: number;
  intel: Record<IntelKey, boolean>;
  layers: Record<LayerKey, boolean>;
  cameraMode: CameraMode;
  achilles: AchillesScan | null;
  achillesState: "idle" | "scanning" | "done";
  feed: { id: number; text: string; level: "info" | "warning" | "success" | "critical" }[];

  sim: SimResult | null;
  simError: string | null;
  simHour: number;
  playing: boolean;
  speed: 1 | 2 | 4;

  reference: ReferenceResult | null;
  bots: BotResult[] | null;
  resultsStep: number;

  reducedMotion: boolean;
  highContrast: boolean;
  radio: boolean;
  theme: Theme;
  /** Judge demo: auto-plays a seeded round end to end. */
  demo: boolean;
  planningSeconds: number;

  setPhase: (p: Phase) => void;
  setDemo: (v: boolean) => void;
  setPlanningSeconds: (s: number) => void;
  setHoverCity: (c: CityId | null) => void;
  chooseCity: (c: CityId) => void;
  setMode: (m: GameMode) => void;
  setData: (d: CityData) => void;
  setTool: (k: InterventionKind | null) => void;
  setHover: (h: GameState["hover"]) => void;
  select: (s: SelectedEntity) => void;
  place: (p: Omit<PlacedIntervention, "id">) => boolean;
  remove: (id: string) => void;
  move: (id: string, target: number, lon: number, lat: number, label: string) => void;
  undo: () => void;
  redo: () => void;
  tick: (dt: number) => void;
  useTimeFreeze: () => void;
  unlockIntel: (k: IntelKey) => void;
  toggleLayer: (k: LayerKey) => void;
  setCameraMode: (m: CameraMode) => void;
  setAchilles: (a: AchillesScan | null, state: GameState["achillesState"]) => void;
  pushFeed: (text: string, level?: GameState["feed"][number]["level"]) => void;
  setSim: (s: SimResult | null, err?: string | null) => void;
  setSimHour: (h: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: 1 | 2 | 4) => void;
  setReference: (r: ReferenceResult | null) => void;
  setBots: (b: BotResult[] | null) => void;
  setResultsStep: (n: number) => void;
  setPref: (k: "reducedMotion" | "highContrast" | "radio", v: boolean) => void;
  setTheme: (t: Theme) => void;
  newRound: () => void;
  backToLanding: () => void;
}

let feedId = 0;
const randomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: ROOM.codeLength }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

export const spent = (placements: PlacedIntervention[], cfg: ScenarioParams | null | undefined) =>
  cfg ? placements.reduce((s, p) => s + specFor(cfg, p.kind).cost, 0) : 0;

export const cfgOf = (s: { cityId: CityId | null; data: CityData | null }): ScenarioParams => s.data?.cfg ?? CITY_SCENARIOS[s.cityId ?? "raleigh"];

function recompute(state: GameState, placements: PlacedIntervention[]) {
  if (!state.coverage) return {};
  return { estimate: evaluatePlan(state.coverage, toEnginePlan(placements, state.coverage.data.cfg)) };
}

export const useGame = create<GameState>((set, get) => ({
  phase: "landing",
  cityId: null,
  hoverCity: null,
  mode: "solo",
  seed: 20261003,
  roomCode: "",

  data: null,
  coverage: null,
  events: null,
  baseline: null,
  estimate: null,

  placements: [],
  past: [],
  future: [],
  activeTool: null,
  hover: null,
  selected: null,

  timeLeft: ROUND.planningSeconds,
  timerRunning: false,
  freezeLeft: 0,
  timeFreezeUsed: false,
  intelTokens: ROUND.intelTokens,
  intel: { demographic: false, fragility: false, health: false, floodDetail: false },
  // Decluttered by default (team feedback): water, at-risk points and facilities; neighbourhood fills are opt-in.
  layers: { flood: true, zones: false, atRisk: true, roads: false, facilities: true, buildings: true },
  cameraMode: "city",
  achilles: null,
  achillesState: "idle",
  feed: [],

  sim: null,
  simError: null,
  simHour: 0,
  playing: false,
  speed: 1,

  reference: null,
  bots: null,
  resultsStep: 0,

  reducedMotion: false,
  highContrast: false,
  radio: false,
  theme: "auto",
  demo: false,
  planningSeconds: ROUND.planningSeconds,

  setPhase: (phase) => set({ phase }),
  setDemo: (demo) => set({ demo }),
  setPlanningSeconds: (planningSeconds) => set({ planningSeconds, timeLeft: planningSeconds }),
  setHoverCity: (hoverCity) => set({ hoverCity }),
  chooseCity: (cityId) =>
    set((s) =>
      s.cityId === cityId
        ? { hoverCity: null }
        : { cityId, hoverCity: null, data: null, coverage: null, events: null, baseline: null, estimate: null, placements: [], past: [], future: [] },
    ),
  setMode: (mode) =>
    set({
      mode,
      seed: mode === "daily" ? dailySeed() : mode === "solo" ? 20261003 : Math.floor(Math.random() * 1e9),
      roomCode: mode === "multiplayer" ? randomCode() : "",
    }),
  setData: (data) => {
    const coverage = createCoverageContext(data);
    const events = resolveEvents(data, get().seed);
    const baseline = evaluatePlan(coverage, EMPTY_PLAN);
    set({ data, coverage, events, baseline, estimate: baseline });
  },
  setTool: (activeTool) => set({ activeTool, hover: null }),
  setHover: (hover) => set({ hover }),
  select: (selected) => set({ selected }),
  place: (p) => {
    const s = get();
    const cfg = cfgOf(s);
    if (spent(s.placements, cfg) + specFor(cfg, p.kind).cost > ROUND.budget) return false;
    if (s.placements.some((x) => x.kind === p.kind && x.target === p.target)) return false;
    const placements = [...s.placements, { ...p, id: `${p.kind}-${p.target}-${Date.now()}` }];
    set({ placements, past: [...s.past, s.placements], future: [], ...recompute(s, placements) });
    return true;
  },
  remove: (id) => {
    const s = get();
    const placements = s.placements.filter((p) => p.id !== id);
    set({
      placements,
      past: [...s.past, s.placements],
      future: [],
      selected: s.selected?.type === "intervention" && s.selected.id === id ? null : s.selected,
      ...recompute(s, placements),
    });
  },
  move: (id, target, lon, lat, label) => {
    const s = get();
    const placements = s.placements.map((p) => (p.id === id ? { ...p, target, lon, lat, label } : p));
    set({ placements, past: [...s.past, s.placements], future: [], ...recompute(s, placements) });
  },
  undo: () => {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({ placements: prev, past: s.past.slice(0, -1), future: [s.placements, ...s.future], ...recompute(s, prev) });
  },
  redo: () => {
    const s = get();
    if (!s.future.length) return;
    const next = s.future[0];
    set({ placements: next, past: [...s.past, s.placements], future: s.future.slice(1), ...recompute(s, next) });
  },
  tick: (dt) => {
    const s = get();
    if (!s.timerRunning) return;
    if (s.freezeLeft > 0) {
      set({ freezeLeft: Math.max(0, s.freezeLeft - dt) });
      return;
    }
    set({ timeLeft: Math.max(0, s.timeLeft - dt) });
  },
  useTimeFreeze: () => {
    const s = get();
    if (s.timeFreezeUsed) return;
    set({ freezeLeft: ROUND.timeFreezeSeconds, timeFreezeUsed: true });
  },
  unlockIntel: (k) => {
    const s = get();
    if (s.intel[k] || s.intelTokens <= 0) return;
    const layers = { ...s.layers };
    if (k === "fragility") layers.roads = true;
    set({ intel: { ...s.intel, [k]: true }, intelTokens: s.intelTokens - 1, layers });
  },
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setAchilles: (achilles, achillesState) => set({ achilles, achillesState }),
  pushFeed: (text, level = "info") => set((s) => ({ feed: [{ id: ++feedId, text, level }, ...s.feed].slice(0, 30) })),
  setSim: (sim, err = null) => set({ sim, simError: err, simHour: 0 }),
  setSimHour: (simHour) => set({ simHour }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setReference: (reference) => set({ reference }),
  setBots: (bots) => set({ bots }),
  setResultsStep: (resultsStep) => set({ resultsStep }),
  setPref: (k, v) => set({ [k]: v } as Partial<GameState>),
  setTheme: (theme) => set({ theme }),
  newRound: () => {
    const s = get();
    set({
      placements: [],
      past: [],
      future: [],
      activeTool: null,
      hover: null,
      selected: null,
      timeLeft: s.planningSeconds,
      timerRunning: false,
      freezeLeft: 0,
      timeFreezeUsed: false,
      intelTokens: ROUND.intelTokens,
      intel: { demographic: false, fragility: false, health: false, floodDetail: false },
      achilles: null,
      achillesState: "idle",
      feed: [],
      cameraMode: "city",
      sim: null,
      simError: null,
      simHour: 0,
      playing: false,
      reference: null,
      bots: null,
      resultsStep: 0,
      estimate: s.baseline,
      layers: { flood: true, zones: false, atRisk: true, roads: false, facilities: true, buildings: true },
    });
  },
  backToLanding: () => {
    get().newRound();
    set({ phase: "landing", cityId: null, hoverCity: null, demo: false });
  },
}));
