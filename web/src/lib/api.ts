"use client";

import { create } from "zustand";

const API_PORT = 8000;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);

/** Backend origin. A phone on the LAN can't reach the laptop's "localhost", so swap in the page's host. */
export function apiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return env ?? `http://localhost:${API_PORT}`;
  const host = window.location.hostname;
  if (env) {
    try {
      const u = new URL(env);
      if (LOCAL.has(u.hostname) && !LOCAL.has(host)) u.hostname = host;
      return u.origin;
    } catch {
      /* fall through to the page host */
    }
  }
  return `${window.location.protocol}//${host}:${API_PORT}`;
}

export const wsBase = () => apiBase().replace(/^http/, "ws");

export interface Services {
  gemini: boolean;
  elevenlabs: boolean;
  database: boolean;
  solana: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  host: boolean;
  connected: boolean;
  status: "lobby" | "planning" | "locked" | "done";
  spent: number;
  placed: number;
  result: RoomResult | null;
}

export interface RoomResult {
  score: number;
  reached: number;
  atRisk: number;
  vulnerableShare: number;
  spent: number;
  plan: import("@/lib/engine/plan").EnginePlan;
}

export interface RoomState {
  code: string;
  hostId: string;
  phase: "lobby" | "playing";
  cityId: string | null;
  planningSeconds: number;
  seed: number | null;
  round: number;
  startedAt: number | null;
  deadline: number | null;
  players: PlayerState[];
}

export interface CommanderReply {
  answer: string;
  candidateId: string | null;
  evidence: string[];
  tradeoff: string;
  limitations: string;
}

export interface ProofReply {
  hash: string;
  signature?: string;
  explorerUrl?: string;
  error?: string;
}

async function req<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${apiBase()}${path}`, { ...init, signal: ctrl.signal });
    if (!r.ok) {
      let msg = `${r.status}`;
      try {
        const j = await r.json();
        msg = j.detail ?? j.error ?? j.message ?? msg;
      } catch {
        /* not json */
      }
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  health: () => req<{ ok: boolean; services: Services }>("/api/health", undefined, 3000),
  createRoom: (hostId: string, hostName: string) => req<{ code: string }>("/api/rooms", post({ hostId, hostName })),
  getRoom: (code: string) => req<RoomState>(`/api/rooms/${encodeURIComponent(code)}`, undefined, 5000),
  commander: (cityId: string, question: string, context: unknown) => req<CommanderReply>("/api/ai/commander", post({ cityId, question, context }), 30_000),
  debrief: (cityId: string, context: unknown) => req<{ text: string }>("/api/ai/debrief", post({ cityId, context }), 30_000),
  saveRound: (body: unknown) => req<{ ok: boolean }>("/api/rounds", post(body), 8000),
  saveActions: (body: unknown) => req<{ ok: boolean }>("/api/actions", post(body), 8000),
  leaderboard: (cityId: string) => req<{ entries: { playerName: string; score: number; time: string; roomCode: string | null }[] }>(`/api/leaderboard?cityId=${cityId}&limit=8`, undefined, 6000),
  stats: (cityId: string) => req<{ plays: number; avgScore: number | null; best: number | null }>(`/api/stats?cityId=${cityId}`, undefined, 6000),
  proof: (body: unknown) => req<ProofReply>("/api/proof", post(body), 45_000),
  async tts(text: string): Promise<ArrayBuffer> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const r = await fetch(`${apiBase()}/api/voice/tts`, { ...post({ text, voiceId: null }), signal: ctrl.signal });
      if (!r.ok) throw new Error(`tts ${r.status}`);
      return await r.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
  },
};

interface BackendState {
  status: "unknown" | "online" | "offline";
  services: Services;
  check: () => Promise<void>;
}

const NONE: Services = { gemini: false, elevenlabs: false, database: false, solana: false };

/** Which backend services are reachable. Everything degrades to the offline game when they are not. */
export const useBackend = create<BackendState>((set) => ({
  status: "unknown",
  services: NONE,
  check: async () => {
    try {
      const h = await api.health();
      set({ status: h.ok ? "online" : "offline", services: { ...NONE, ...h.services } });
    } catch {
      set({ status: "offline", services: NONE });
    }
  },
}));
