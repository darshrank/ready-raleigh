"use client";

import { ArrowLeft, Crown, Loader2, LogIn } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { CITY_PACKS } from "@/cities";
import { Logo } from "@/components/brand/Logo";
import { Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sfx } from "@/lib/audio/sfx";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import type { CityId } from "@/types";
import { savedName, useRoom } from "./room-store";

const codeFromUrl = () => (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("room") ?? "").toUpperCase().slice(0, 6));

export function JoinRoom() {
  const setPhase = useGame((s) => s.setPhase);
  const room = useRoom((s) => s.room);
  const status = useRoom((s) => s.status);
  const error = useRoom((s) => s.error);
  const joinedCode = useRoom((s) => s.code);
  const [code, setCode] = useState(() => joinedCode ?? codeFromUrl());
  const [name, setName] = useState(savedName);
  const joined = !!room && status !== "error";
  const me = useRoom((s) => s.name);
  const city = room?.cityId ? CITY_PACKS[room.cityId as CityId] : null;

  const join = () => {
    sfx.unlock();
    sfx.place();
    useRoom.getState().join(code, name);
  };

  return (
    <motion.div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none fixed inset-0 bg-[#050810]/80" />
      <Panel className="relative w-full max-w-sm p-5">
        <div className="flex items-center justify-between">
          <Logo size="sm" />
          <Button
            variant="ghost"
            size="sm"
            className="text-dim"
            onClick={() => {
              useRoom.getState().leave();
              window.history.replaceState(null, "", "/");
              setPhase("landing");
            }}
          >
            <ArrowLeft /> Leave
          </Button>
        </div>
        {!joined ? (
          <form
            className="mt-5 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length >= 4) join();
            }}
          >
            <h2 className="font-display text-3xl font-black uppercase tracking-[0.1em] text-white">Join a room</h2>
            <label className="text-xs text-dim">
              Room code
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="ABCDE" autoCapitalize="characters" autoComplete="off" className="mt-1 h-14 text-center font-mono text-3xl tracking-[0.3em]" />
            </label>
            <label className="text-xs text-dim">
              Your name
              <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} placeholder="Planner" autoComplete="nickname" className="mt-1 h-12 text-lg" />
            </label>
            <Button type="submit" size="lg" disabled={code.length < 4 || status === "connecting"} className="h-13 rounded-xl bg-[var(--city)] font-display text-lg font-bold uppercase tracking-[0.2em] text-[#03140d] hover:bg-[var(--city)]">
              {status === "connecting" ? <Loader2 className="animate-spin" /> : <LogIn />} Join
            </Button>
            {error && <p className="rounded-md border border-rose-400/30 bg-rose-500/10 p-2 text-sm text-rose-100">{error}</p>}
          </form>
        ) : (
          <div className="mt-5">
            <div className="font-mono text-[10px] tracking-[0.3em] text-emerald-300">YOU&apos;RE IN · ROOM {room.code}</div>
            <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.08em] text-white">Hi, {me}</h2>
            {city ? (
              <div className="mt-3 rounded-xl border p-3" style={{ borderColor: `${city.accent}55`, background: `${city.accent}14` }}>
                <div className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: city.accent }}>
                  {city.name} · {city.hazard}
                </div>
                <div className="font-display text-2xl font-bold uppercase tracking-wider text-white">{city.scenarioTitle}</div>
              </div>
            ) : null}
            <div className="mt-4 flex items-center gap-2 text-sm text-white/85">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--city)] opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-[var(--city)]" />
              </span>
              {room.phase === "playing" ? "Round in progress, jumping in…" : "Waiting for the host to start"}
            </div>
            <div className="mt-4 hud-label">In the room</div>
            <ul className="mt-2 flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {room.players.map((p) => (
                  <motion.li key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-sm", p.name === me ? "bg-[var(--city)]/15" : "bg-white/5")}>
                    <span className="flex items-center gap-2 text-white">
                      {p.host && <Crown className="size-3.5 text-amber-300" />}
                      {p.name}
                    </span>
                    <span className={cn("size-2 rounded-full", p.connected ? "bg-emerald-400" : "bg-slate-600")} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </Panel>
    </motion.div>
  );
}
