"use client";

import { create } from "zustand";
import { api, wsBase, type RoomResult, type RoomState } from "@/lib/api";

const PID_KEY = "faultline:pid";
const NAME_KEY = "faultline:name";

/** Stable per-device player id. crypto.randomUUID needs a secure context, which a LAN http page is not. */
export function playerId() {
  let id = localStorage.getItem(PID_KEY);
  if (!id) {
    id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(PID_KEY, id);
  }
  return id;
}

export const savedName = () => (typeof window === "undefined" ? "" : (localStorage.getItem(NAME_KEY) ?? ""));

type Msg =
  | { type: "configure"; cityId: string; planningSeconds: number }
  | { type: "start" }
  | { type: "status"; status: "planning" | "locked"; spent: number; placed: number }
  | { type: "result"; round: number; result: RoomResult }
  | { type: "reset" }
  | { type: "kick"; pid: string };

interface RoomStore {
  code: string | null;
  name: string;
  status: "idle" | "connecting" | "open" | "closed" | "error";
  error: string | null;
  room: RoomState | null;
  host: () => Promise<string | null>;
  join: (code: string, name: string) => void;
  send: (msg: Msg) => void;
  leave: () => void;
}

let ws: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let ping: ReturnType<typeof setInterval> | null = null;
let attempts = 0;
let wanted = false;

export const useRoom = create<RoomStore>((set, get) => {
  const connect = () => {
    const { code, name } = get();
    if (!code) return;
    ws?.close();
    set({ status: "connecting", error: null });
    const sock = new WebSocket(`${wsBase()}/ws/rooms/${encodeURIComponent(code)}?pid=${encodeURIComponent(playerId())}&name=${encodeURIComponent(name)}`);
    ws = sock;
    sock.onopen = () => {
      attempts = 0;
      set({ status: "open" });
      if (ping) clearInterval(ping);
      ping = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify({ type: "ping" })), 20_000);
    };
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "room") set({ room: msg.room as RoomState });
        else if (msg.type === "error") {
          wanted = false;
          set({ status: "error", error: msg.message ?? "Room error" });
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      if (ping) clearInterval(ping);
      if (!wanted) {
        if (get().status !== "error") set({ status: "closed" });
        return;
      }
      set({ status: "connecting" });
      attempts++;
      retry = setTimeout(connect, Math.min(8000, 800 * attempts));
    };
  };

  return {
    code: null,
    name: savedName(),
    status: "idle",
    error: null,
    room: null,
    host: async () => {
      const name = savedName() || "Host";
      try {
        const { code } = await api.createRoom(playerId(), name);
        wanted = true;
        set({ code, name, room: null });
        connect();
        return code;
      } catch (e) {
        set({ status: "error", error: (e as Error).message || "Could not reach the game server" });
        return null;
      }
    },
    join: (code, name) => {
      const clean = name.trim().slice(0, 20) || "Player";
      localStorage.setItem(NAME_KEY, clean);
      wanted = true;
      set({ code: code.trim().toUpperCase(), name: clean, room: null });
      connect();
    },
    send: (msg) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    leave: () => {
      wanted = false;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      ws?.close();
      ws = null;
      set({ code: null, room: null, status: "idle", error: null });
    },
  };
});

export const isRoomHost = (room: RoomState | null) => !!room && room.hostId === playerId();
