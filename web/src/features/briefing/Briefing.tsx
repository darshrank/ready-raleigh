"use client";

import { Radio, Volume2, VolumeX } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CITY_PACKS } from "@/cities";
import { DataBadge, int, money, Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { BRAND, ROUND } from "@/config/game";
import { useRoom } from "@/features/room/room-store";
import { sfx } from "@/lib/audio/sfx";
import { mapBus } from "@/lib/map-bus";
import { prefetchSpeech, speak, stopSpeaking } from "@/lib/speech";
import { SCENARIOS } from "@/scenarios";
import { useGame } from "@/stores/game";

/** Seconds of briefing in a room before everyone starts planning (matches the server's deadline). */
const ROOM_BRIEFING_S = 15;

export function Briefing() {
  const data = useGame((s) => s.data)!;
  const reducedMotion = useGame((s) => s.reducedMotion);
  const demo = useGame((s) => s.demo);
  const mode = useGame((s) => s.mode);
  const planningSeconds = useGame((s) => s.planningSeconds);
  const sound = useGame((s) => s.sound);
  const room = useRoom((s) => s.room);
  const [charIdx, setCharIdx] = useState(-1);
  const [voice, setVoice] = useState(true);
  const started = useRef(false);
  const city = CITY_PACKS[data.cityId];
  const scenario = SCENARIOS[data.cityId];
  const cfg = data.cfg;
  const type = cfg.hazard.type;
  const inRoom = mode === "multiplayer" && room?.phase === "playing" && !!room.startedAt;
  const [now, setNow] = useState(() => Date.now());
  const roomStartsAt = inRoom ? room!.startedAt! + ROOM_BRIEFING_S * 1000 : 0;

  const stats = useMemo(() => {
    let noCar = 0;
    let older = 0;
    for (const o of data.origins) {
      const sh = data.zoneShares[o.z];
      noCar += o.pop * sh.snv;
      older += o.pop * sh.s65;
    }
    const hazardKm2 = Object.values(data.meta.floodAreaKm2).reduce((a, b) => a + b, 0);
    const hotKm2 = type === "heat" ? Array.from(data.cells.v).filter((v) => v >= 600).length * 0.015 : 0;
    return {
      atRisk: data.origins.reduce((s, o) => s + o.pop, 0),
      noCar,
      older,
      area: type === "heat" ? { label: "Heat-island blocks", value: `${hotKm2.toFixed(1)} km²` } : { label: type === "quake" ? "Liquefaction zones" : "Flood hazard area", value: `${hazardKm2.toFixed(1)} km²` },
    };
  }, [data, type]);

  useEffect(() => prefetchSpeech(scenario.briefing.script), [scenario]);

  // cinematic fly-through
  useEffect(() => {
    const tour = city.cameraBookmarks;
    const overview = tour.find((b) => b.id === "overview") ?? tour[0];
    if (reducedMotion) {
      mapBus.flyTo({ center: overview.center, zoom: overview.zoom, pitch: overview.pitch, bearing: overview.bearing, duration: 0 });
      return;
    }
    const order = [...tour.filter((b) => b.id !== "overview"), overview];
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const b = order[i];
      mapBus.flyTo({ center: b.center, zoom: b.zoom, pitch: b.pitch + 4, bearing: b.bearing, duration: 4200, curve: 1.3 });
      i += 1;
      if (i < order.length) timer = setTimeout(next, 4600);
    };
    timer = setTimeout(next, 300);
    return () => clearTimeout(timer);
  }, [reducedMotion, city]);

  useEffect(() => {
    if (!voice || !sound || started.current) return;
    started.current = true;
    const cancel = speak(scenario.briefing.script, { onBoundary: setCharIdx, onEnd: () => setCharIdx(scenario.briefing.script.length) });
    return () => cancel();
  }, [voice, sound, scenario]);
  useEffect(() => () => stopSpeaking(), []);

  const begin = () => {
    stopSpeaking();
    sfx.whoosh();
    const s = useGame.getState();
    s.newRound();
    const deadline = useRoom.getState().room?.deadline;
    if (mode === "multiplayer" && deadline) useGame.setState({ timeLeft: Math.max(10, (deadline - Date.now()) / 1000), timerRunning: true });
    else useGame.setState({ timerRunning: planningSeconds > 0 && mode !== "planner" });
    s.setPhase("planning");
    const b = city.cameraBookmarks.find((x) => x.id === "overview") ?? city.cameraBookmarks[0];
    mapBus.flyTo({ center: b.center, zoom: b.zoom + 0.3, pitch: 48, bearing: b.bearing, duration: 1800 });
  };

  useEffect(() => {
    if (!demo) return;
    const t = setTimeout(begin, 9000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  // a room starts planning together
  useEffect(() => {
    if (!inRoom) return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= roomStartsAt) {
        clearInterval(tick);
        begin();
      }
    }, 250);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom, roomStartsAt]);

  const script = scenario.briefing.script;
  const spokenTo = charIdx < 0 ? 0 : charIdx;
  const roomLeft = inRoom ? Math.max(0, Math.ceil((roomStartsAt - now) / 1000)) : 0;

  return (
    <motion.div className="absolute inset-0 z-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#050810]/95 via-[#050810]/30 to-transparent sm:bg-gradient-to-l" />
      <div className="absolute left-4 top-4 flex items-center gap-2 sm:left-10 sm:top-5">
        <DataBadge kind="SCENARIO DATA" />
        <span className="hidden font-mono text-[10px] tracking-[0.2em] text-dim sm:inline">{BRAND.disclaimer}</span>
      </div>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="absolute inset-x-0 bottom-0 p-3 sm:inset-y-0 sm:left-auto sm:right-0 sm:flex sm:w-[480px] sm:flex-col sm:justify-center sm:p-6"
      >
        <Panel className="flex max-h-[68vh] flex-col overflow-hidden sm:max-h-[90vh]">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5 sm:px-5">
            <div className="flex items-center gap-2">
              <Radio className="size-4 animate-pulse text-rose-400" />
              <span className="font-mono text-[11px] font-semibold tracking-[0.25em] text-rose-300">EMERGENCY BRIEFING</span>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-dim hover:text-white"
              onClick={() => {
                if (voice) stopSpeaking();
                else started.current = false;
                setVoice(!voice);
              }}
              aria-label={voice ? "Mute briefing" : "Play briefing"}
            >
              {voice && sound ? <Volume2 /> : <VolumeX />}
            </Button>
          </div>
          <div className="overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: city.accent }}>
              {city.name}, {city.state}
            </div>
            <h2 className="font-display text-3xl font-black uppercase tracking-[0.1em] text-white sm:text-4xl">{scenario.name}</h2>
            <p className="mt-2 text-[14px] leading-relaxed sm:text-[15px]" aria-live="polite">
              <span className="text-white">{script.slice(0, spokenTo)}</span>
              <span className="text-white/45">{script.slice(spokenTo)}</span>
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Stat label={cfg.terms.atRisk} value={int(stats.atRisk)} accent />
              <Stat label="People without a car" value={int(stats.noCar)} />
              <Stat label="Aged 65+" value={int(stats.older)} />
              <Stat label={stats.area.label} value={stats.area.value} />
            </div>
            <div className="mt-3 font-mono text-[11px] text-dim">
              Budget {money(ROUND.budget)} · {planningSeconds > 0 ? `${Math.floor(planningSeconds / 60)}:${String(planningSeconds % 60).padStart(2, "0")} to plan` : "no time limit"} · {cfg.durationHours} h simulated
            </div>
          </div>
          <div className="border-t border-white/8 p-3 sm:p-4">
            {inRoom ? (
              <div className="flex h-12 items-center justify-center rounded-lg border border-[var(--city)]/40 bg-[var(--city)]/10 font-display text-lg font-bold uppercase tracking-[0.2em] text-white">
                Planning starts in {roomLeft}s
              </div>
            ) : (
              <Button size="lg" onClick={begin} className="h-12 w-full bg-[var(--city)] font-display text-lg font-bold uppercase tracking-[0.2em] text-[#03140d] hover:bg-[var(--city)] hover:brightness-110">
                Begin planning
              </Button>
            )}
          </div>
        </Panel>
      </motion.div>
    </motion.div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-[10.5px] leading-tight text-dim">{label}</div>
      <div className={accent ? "font-mono text-xl font-semibold text-[var(--city)]" : "font-mono text-lg font-semibold text-white"}>{value}</div>
    </div>
  );
}
