"use client";

/**
 * Browser side of multiplayer rooms: one WebSocket to the room's Durable
 * Object (/room/<CODE>), reconnecting on drops. Kept separate from the game
 * store; RoomBridge (features/experience) connects the two.
 */
import { create } from "zustand";
import type { ClientMsg, RoomState, ServerMsg } from "./logic";

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

function playerId() {
  let id = lsGet("faultline:player");
  if (!id) {
    id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
    lsSet("faultline:player", id);
  }
  return id;
}

/** ws(s)://host/room/CODE; NEXT_PUBLIC_ROOM_URL points dev at `wrangler dev`. */
function roomUrl(code: string) {
  const base = process.env.NEXT_PUBLIC_ROOM_URL || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  return `${base.replace(/\/$/, "")}/room/${code}`;
}

type Status = "idle" | "connecting" | "open" | "offline";

interface RoomStore {
  code: string;
  status: Status;
  state: RoomState | null;
  error: string | null;
  me: string;
  name: string;
  setName: (n: string) => void;
  connect: (code: string) => void;
  send: (msg: ClientMsg) => void;
  leave: () => void;
  isHost: () => boolean;
}

let ws: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;

export const useRoom = create<RoomStore>((set, get) => {
  const open = (code: string) => {
    ws?.close();
    set({ status: "connecting" });
    let sock: WebSocket;
    try {
      sock = new WebSocket(roomUrl(code));
    } catch {
      set({ status: "offline" });
      return;
    }
    ws = sock;
    sock.onopen = () => {
      attempts = 0;
      set({ status: "open", error: null });
      sock.send(JSON.stringify({ t: "join", playerId: get().me, name: get().name || "Player" } satisfies ClientMsg));
    };
    sock.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMsg;
      if (msg.t === "state") set({ state: msg.state });
      else set({ error: msg.message });
    };
    sock.onclose = () => {
      if (ws !== sock || get().code !== code) return;
      attempts += 1;
      // after a few failures, report offline (the lobby then falls back to simulated players)
      set({ status: attempts >= 3 && get().status !== "open" ? "offline" : "connecting" });
      retry = setTimeout(() => get().code === code && open(code), Math.min(8000, 500 * 2 ** attempts));
    };
  };

  return {
    code: "",
    status: "idle",
    state: null,
    error: null,
    me: typeof window === "undefined" ? "" : playerId(),
    name: (typeof window !== "undefined" && lsGet("faultline:name")) || "",
    setName: (name) => {
      set({ name });
      lsSet("faultline:name", name);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "join", playerId: get().me, name } satisfies ClientMsg));
    },
    connect: (code) => {
      code = code.toUpperCase();
      if (get().code === code && get().status !== "idle") return;
      if (retry) clearTimeout(retry);
      attempts = 0;
      set({ code, state: null, error: null });
      open(code);
    },
    send: (msg) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    leave: () => {
      if (retry) clearTimeout(retry);
      const s = ws;
      ws = null;
      s?.close();
      set({ code: "", status: "idle", state: null, error: null });
    },
    isHost: () => !!get().state && get().state!.hostId === get().me,
  };
});

/** True while this browser is in a live room. */
export const inLiveRoom = () => {
  const r = useRoom.getState();
  return r.status === "open" && !!r.state;
};
