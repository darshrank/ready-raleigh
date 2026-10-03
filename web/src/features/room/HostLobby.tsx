"use client";

import { ArrowLeft, Crown, Loader2, Play, RefreshCw, Users, Wifi, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { CITY_PACKS } from "@/cities";
import { Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { sfx } from "@/lib/audio/sfx";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import { useRoom } from "./room-store";

const TIMES = [60, 120, 180];

/** Share link for phones: swap localhost for the LAN address so the QR code works on the same Wi-Fi. */
const onLocalhost = () => typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);

function useShareOrigin() {
  const [origin, setOrigin] = useState(() => (typeof window === "undefined" || onLocalhost() ? "" : window.location.origin));
  useEffect(() => {
    if (!onLocalhost()) return;
    const here = window.location;
    fetch("/api/lan")
      .then((r) => r.json())
      .then((j: { ip: string | null }) => setOrigin(j.ip ? `${here.protocol}//${j.ip}:${here.port || 80}` : here.origin))
      .catch(() => setOrigin(here.origin));
  }, []);
  return origin;
}

export function HostLobby() {
  const cityId = useGame((s) => s.cityId)!;
  const setPhase = useGame((s) => s.setPhase);
  const planningSeconds = useGame((s) => s.planningSeconds);
  const setPlanningSeconds = useGame((s) => s.setPlanningSeconds);
  const code = useRoom((s) => s.code);
  const room = useRoom((s) => s.room);
  const status = useRoom((s) => s.status);
  const error = useRoom((s) => s.error);
  const origin = useShareOrigin();
  const city = CITY_PACKS[cityId];
  const seconds = TIMES.includes(planningSeconds) ? planningSeconds : 120;

  useEffect(() => {
    const r = useRoom.getState();
    if (!r.code || r.status === "error" || r.status === "idle") void r.host();
  }, []);

  useEffect(() => {
    if (status === "open") useRoom.getState().send({ type: "configure", cityId, planningSeconds: seconds });
  }, [status, cityId, seconds]);

  const players = room?.players ?? [];
  const url = code && origin ? `${origin}/?room=${code}` : "";

  const start = () => {
    sfx.lock();
    const r = useRoom.getState();
    r.send({ type: "configure", cityId, planningSeconds: seconds });
    r.send({ type: "start" });
  };

  return (
    <motion.div className="absolute inset-0 z-10 flex flex-col gap-4 overflow-y-auto p-4 sm:flex-row sm:items-end sm:justify-between sm:p-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-r from-[#050810]/95 via-[#050810]/70 to-[#050810]/30" />
      <div className="relative max-w-lg">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            useRoom.getState().leave();
            useGame.getState().setMode("solo");
            setPhase("select");
          }}
          className="mb-3 text-dim hover:text-white"
        >
          <ArrowLeft /> Cities
        </Button>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: city.accent }}>
          Room lobby · {city.name}
        </div>
        <h2 className="mt-1 font-display text-4xl font-black uppercase tracking-[0.1em] text-white sm:text-6xl">{city.scenarioTitle}</h2>
        <p className="mt-2 text-sm text-dim">Everyone gets the same city, the same seeded disaster and the same clock. Best plan wins.</p>

        <div className="mt-5 hud-label">Planning time</div>
        <div className="mt-2 flex gap-2">
          {TIMES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPlanningSeconds(s)}
              className={cn("flex-1 rounded-lg border px-3 py-2 font-mono text-sm transition", seconds === s ? "border-[var(--city)] bg-[var(--city)]/10 text-white" : "border-white/10 text-dim hover:text-white")}
            >
              {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
            </button>
          ))}
        </div>
        <Button
          size="lg"
          disabled={status !== "open"}
          onClick={start}
          className="mt-5 h-14 w-full rounded-xl bg-[var(--city)] font-display text-xl font-bold uppercase tracking-[0.2em] text-[#03140d] shadow-[0_0_30px_-6px_var(--city)] hover:bg-[var(--city)] hover:brightness-110"
        >
          <Play className="size-5" /> Start · {players.length} {players.length === 1 ? "player" : "players"}
        </Button>
        {status === "error" && (
          <div className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
            Could not open a room: {error}. Start the backend (see CLAUDE.md), then retry.
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" className="border-white/15" onClick={() => void useRoom.getState().host()}>
                <RefreshCw /> Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  useGame.getState().setMode("solo");
                  setPhase("loading");
                }}
              >
                Play solo instead
              </Button>
            </div>
          </div>
        )}
      </div>

      <Panel className="relative w-full p-5 sm:w-[400px]">
        <div className="flex items-center justify-between">
          <div className="hud-label">Scan to join</div>
          <span className={cn("flex items-center gap-1 font-mono text-[10px]", status === "open" ? "text-emerald-300" : "text-amber-300")}>
            {status === "open" ? <Wifi className="size-3" /> : <WifiOff className="size-3" />} {status === "open" ? "LIVE" : status.toUpperCase()}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <div className="rounded-xl bg-white p-2.5">{url ? <QRCodeSVG value={url} size={132} bgColor="#ffffff" fgColor="#050810" /> : <div className="flex size-[132px] items-center justify-center"><Loader2 className="size-6 animate-spin text-slate-500" /></div>}</div>
          <div className="min-w-0">
            <div className="text-xs text-dim">Room code</div>
            <div className="font-mono text-5xl font-bold tracking-[0.18em] text-white">{code ?? "·····"}</div>
            <div className="mt-1 break-all font-mono text-[10px] text-dim">{url.replace(/^https?:\/\//, "")}</div>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2 hud-label">
          <Users className="size-3" /> Players
        </div>
        <ul className="mt-2 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          <AnimatePresence initial={false}>
            {players.map((p) => (
              <motion.li key={p.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 text-white">
                  {p.host && <Crown className="size-3.5 text-amber-300" />}
                  {p.name}
                </span>
                <span className={cn("size-2 rounded-full", p.connected ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-slate-600")} />
              </motion.li>
            ))}
          </AnimatePresence>
          {players.length <= 1 && <li className="px-1 text-xs text-dim">Phones on the same Wi-Fi: scan the code, enter a name, done.</li>}
        </ul>
      </Panel>
    </motion.div>
  );
}
