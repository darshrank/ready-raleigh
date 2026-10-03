"use client";

import { ArrowLeft, Bot, CalendarDays, FlaskConical, User, Users, Wifi } from "lucide-react";
import { motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { CITY_PACKS } from "@/cities";
import { DataBadge, Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { ROOM, ROUND } from "@/config/game";
import { cn } from "@/lib/utils";
import { useRoom } from "@/lib/room/store";
import { useGame, type GameMode } from "@/stores/game";

const MODES: { id: GameMode; label: string; icon: typeof User; blurb: string }[] = [
  { id: "solo", label: "Solo", icon: User, blurb: "One planner, one city, one seeded disaster." },
  { id: "multiplayer", label: "Multiplayer room", icon: Users, blurb: "Everyone plans the same storm. Compare plans at the reveal." },
  { id: "planner", label: "Planner lab", icon: FlaskConical, blurb: "No timer. Take your time with the analysis layers." },
  { id: "daily", label: "Daily challenge", icon: CalendarDays, blurb: "Today's seed. Same storm and events for everyone." },
  { id: "ai", label: "AI challenge", icon: Bot, blurb: "Your plan against the optimizer, timeline by timeline." },
];

const BOT_NAMES = ["Unit Kestrel", "Unit Heron", "Unit Granite", "Unit Transit", "Unit Wildcard"];

export function ModeSelect() {
  const cityId = useGame((s) => s.cityId)!;
  const mode = useGame((s) => s.mode);
  const roomCode = useGame((s) => s.roomCode);
  const planningSeconds = useGame((s) => s.planningSeconds);
  const setMode = useGame((s) => s.setMode);
  const setPhase = useGame((s) => s.setPhase);
  const setPlanningSeconds = useGame((s) => s.setPlanningSeconds);
  const city = CITY_PACKS[cityId];
  const room = useRoom((s) => s.state);
  const roomStatus = useRoom((s) => s.status);
  const me = useRoom((s) => s.me);
  const name = useRoom((s) => s.name);
  const live = mode === "multiplayer" && roomStatus === "open" && !!room;
  const isHost = live && room!.hostId === me;
  const startLabel = mode !== "multiplayer" ? "Start briefing" : !live ? "Start with simulated players" : isHost ? "Start room for everyone" : "Waiting for the host";
  const start = () => {
    if (live) {
      // everyone (host included) loads when the room says the round started
      if (isHost) useRoom.getState().send({ t: "start", cityId, seed: Math.floor(Math.random() * 1e9), planningSeconds });
      return;
    }
    setPhase("loading");
  };
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/?room=${roomCode}` : "";

  return (
    <motion.div className="absolute inset-0 z-10 flex items-end justify-between gap-6 p-6 sm:p-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#050810]/95 via-[#050810]/60 to-transparent" />
      <div className="relative w-full max-w-lg">
        <Button variant="ghost" size="sm" onClick={() => setPhase("select")} className="mb-4 text-dim hover:text-white">
          <ArrowLeft /> Cities
        </Button>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: city.accent }}>
          {city.name} · {city.hazard}
        </div>
        <h2 className="mt-1 font-display text-5xl font-black uppercase tracking-[0.12em] text-white">{city.scenarioTitle}</h2>
        <p className="mt-2 text-sm text-dim">Pick how you want to play.</p>
        <div className="mt-6 flex flex-col gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                if (m.id === "planner") setPlanningSeconds(0);
                else if (planningSeconds === 0) setPlanningSeconds(ROUND.planningSeconds);
              }}
              className={cn(
                "hud-panel flex items-center gap-4 rounded-xl px-4 py-3 text-left transition",
                mode === m.id ? "border-[var(--city)]/60 bg-[var(--city)]/10" : "hover:border-white/25",
              )}
            >
              <m.icon className="size-5 shrink-0" style={{ color: mode === m.id ? city.accent : "#8796b0" }} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-bold uppercase tracking-[0.14em] text-white">{m.label}</div>
                <div className="text-xs text-dim">{m.blurb}</div>
              </div>
            </button>
          ))}
        </div>
        <Button
          size="lg"
          onClick={start}
          disabled={live && !isHost}
          className="mt-6 h-12 w-full rounded-lg bg-[var(--city)] font-display text-lg font-bold uppercase tracking-[0.2em] text-[#03140d] hover:bg-[var(--city)] hover:brightness-110"
        >
          {startLabel}
        </Button>
      </div>

      {mode === "multiplayer" && (
        <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="relative hidden w-[380px] md:block">
          <Panel className="p-5">
            <div className="flex items-center justify-between">
              <div className="hud-label">Room lobby</div>
              {live ? <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Live room</span> : <DataBadge kind="SIMULATED PLAYERS" />}
            </div>
            <div className="mt-3 flex items-center gap-4">
              <div className="rounded-lg bg-white p-2">
                <QRCodeSVG value={shareUrl} size={92} bgColor="#ffffff" fgColor="#050810" />
              </div>
              <div>
                <div className="text-xs text-dim">Room code</div>
                <div className="font-mono text-4xl font-bold tracking-[0.25em] text-white">{roomCode}</div>
                <div className="mt-1 text-xs text-dim">Scan or share the link to join</div>
              </div>
            </div>
            <label className="mt-5 block hud-label" htmlFor="player-name">Your name</label>
            <input
              id="player-name"
              value={name}
              maxLength={24}
              placeholder="e.g. Sam"
              onChange={(e) => useRoom.getState().setName(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--city)]"
            />
            <div className="mt-5 hud-label">Players</div>
            <ul className="mt-2 flex flex-col gap-1.5">
              {live
                ? room!.players.map((p) => (
                    <li key={p.id} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2 text-sm">
                      <span className="text-white">
                        {p.name}
                        {p.id === me && " (you)"}
                        {p.id === room!.hostId && " · Host"}
                      </span>
                      <span className={cn("flex items-center gap-1 text-xs", p.connected ? "text-emerald-300" : "text-dim")}>
                        <Wifi className="size-3" /> {p.connected ? "connected" : "away"}
                      </span>
                    </li>
                  ))
                : BOT_NAMES.slice(0, ROOM.simulatedPlayers).map((n) => (
                    <li key={n} className="flex items-center justify-between rounded-md bg-white/[0.03] px-3 py-2 text-sm">
                      <span className="text-white/80">{n}</span>
                      <span className="text-xs text-amber-300/80">simulated</span>
                    </li>
                  ))}
            </ul>
            <div className="mt-5 hud-label">Host controls</div>
            <div className="mt-2 flex gap-2">
              {[90, 180, 300].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPlanningSeconds(s)}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 font-mono text-xs",
                    planningSeconds === s ? "border-[var(--city)] text-white" : "border-white/10 text-dim hover:text-white",
                  )}
                >
                  {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs text-dim">Budget $10M · Seeded events · Same storm for every player</div>
            <p className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/5 p-2.5 text-xs leading-relaxed text-amber-100/80">
              {live
                ? "Everyone plans the same storm with the same seed. When everyone locks, each plan is scored by the same engine and the room sees where the crowd went."
                : roomStatus === "offline"
                  ? "The room server isn't reachable, so the room is filled with simulated players whose plans are scored by the same engine."
                  : "Connecting to the room server…"}
            </p>
          </Panel>
        </motion.div>
      )}
    </motion.div>
  );
}
