"use client";

import { create } from "zustand";

export type BannerTone = "quake" | "storm" | "heat" | "danger" | "success" | "info";

export interface Banner {
  id: number;
  title: string;
  subtitle?: string;
  tone: BannerTone;
}

export interface GainToast {
  id: number;
  text: string;
  good: boolean;
}

/** A real map building that the quake brings down. Times are simulation hours. */
export interface Collapse {
  id: number;
  polygon: number[][];
  height: number;
  lon: number;
  lat: number;
  start: number;
}

interface FxState {
  /** 0 dry ... 1 downpour */
  rain: number;
  /** 0 ... 1 heat haze */
  heat: number;
  /** Bumped once per lightning strike or blackout flicker; overlays animate on change. */
  strike: number;
  flicker: number;
  banner: Banner | null;
  toasts: GainToast[];
  collapses: Collapse[];
  set: (p: Partial<Pick<FxState, "rain" | "heat" | "collapses">>) => void;
  lightning: () => void;
  blackout: () => void;
  showBanner: (b: Omit<Banner, "id">) => void;
  toast: (text: string, good?: boolean) => void;
  reset: () => void;
}

let nextId = 1;

export const useFx = create<FxState>((set) => ({
  rain: 0,
  heat: 0,
  strike: 0,
  flicker: 0,
  banner: null,
  toasts: [],
  collapses: [],
  set: (p) => set(p),
  lightning: () => set((s) => ({ strike: s.strike + 1 })),
  blackout: () => set((s) => ({ flicker: s.flicker + 1 })),
  showBanner: (b) => {
    const id = nextId++;
    set({ banner: { ...b, id } });
    setTimeout(() => set((s) => (s.banner?.id === id ? { banner: null } : {})), 3200);
  },
  toast: (text, good = true) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, good }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2200);
  },
  reset: () => set({ rain: 0, heat: 0, banner: null, collapses: [] }),
}));
