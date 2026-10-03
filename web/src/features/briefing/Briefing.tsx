"use client";

import { Radio, Volume2, VolumeX } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CITY_PACKS } from "@/cities";
import { DataBadge, int, money, Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { BRAND, ROUND } from "@/config/game";
import { protectableCrossings } from "@/features/map/layers";
import { mapBus } from "@/lib/map-bus";
import { speak, stopSpeaking } from "@/lib/speech";
import { SCENARIOS } from "@/scenarios";
import { useGame } from "@/stores/game";

export function Briefing() {
  const data = useGame((s) => s.data)!;
  const coverage = useGame((s) => s.coverage)!;
  const reducedMotion = useGame((s) => s.reducedMotion);
  const demo = useGame((s) => s.demo);
  const mode = useGame((s) => s.mode);
  const planningSeconds = useGame((s) => s.planningSeconds);
  const [voice, setVoice] = useState(true);
  const [charIdx, setCharIdx] = useState(-1);
  const started = useRef(false);
  const city = CITY_PACKS[data.cityId];
  const scenario = SCENARIOS[data.cityId];
  const cfg = data.cfg;
  const type = cfg.hazard.type;

  const stats = useMemo(() => {
    let noCar = 0;
    let older = 0;
    let lowIncome = 0;
    for (const o of data.origins) {
      const sh = data.zoneShares[o.z];
      noCar += o.pop * sh.snv;
      older += o.pop * sh.s65;
      lowIncome += o.pop * sh.spov;
    }
    const hazardKm2 = Object.values(data.meta.floodAreaKm2).reduce((a, b) => a + b, 0);
    const hotKm2 = type === "heat" ? (Array.from(data.cells.v).filter((v) => v >= 600).length * 0.015) : 0;
    return {
      atRisk: data.origins.reduce((s, o) => s + o.pop, 0),
      noCar,
      older,
      lowIncome,
      fourth:
        type === "heat"
          ? { label: "Possible cooling sites", value: int(data.shelters.length) }
          : type === "quake"
            ? { label: "Roads on failing ground", value: int(protectableCrossings(data, coverage.flood.edgeClose).length) }
            : { label: "Flood-prone crossings", value: int(protectableCrossings(data, coverage.flood.edgeClose).length) },
      area: type === "heat" ? { label: "Heat-island blocks", value: `${hotKm2.toFixed(1)} km²` } : { label: type === "quake" ? "Liquefaction zones" : "Flood hazard area", value: `${hazardKm2.toFixed(1)} km²` },
    };
  }, [data, coverage, type]);

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
    if (!voice || started.current) return;
    started.current = true;
    const cancel = speak(scenario.briefing.script, { onBoundary: setCharIdx, onEnd: () => setCharIdx(scenario.briefing.script.length) });
    return () => cancel();
  }, [voice, scenario]);
  useEffect(() => () => stopSpeaking(), []);

  const begin = () => {
    stopSpeaking();
    const s = useGame.getState();
    s.newRound();
    useGame.setState({ timerRunning: planningSeconds > 0 && mode !== "planner" });
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

  const script = scenario.briefing.script;
  const spokenTo = charIdx < 0 ? 0 : charIdx;
  const clock = (h: number) => {
    const total = cfg.startClock + h;
    return `${String(Math.floor(total % 24)).padStart(2, "0")}:${String(Math.round((total % 1) * 60)).padStart(2, "0")}`;
  };

  return (
    <motion.div className="absolute inset-0 z-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-[#050810]/95 via-[#050810]/40 to-transparent" />
      <div className="absolute left-6 top-5 flex items-center gap-2 sm:left-10">
        <DataBadge kind="SCENARIO DATA" />
        <span className="font-mono text-[10px] tracking-[0.2em] text-dim">{BRAND.disclaimer}</span>
      </div>
      <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.6 }} className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col justify-center p-6">
        <Panel className="flex max-h-[92vh] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/8 px-5 py-3">
            <div className="flex items-center gap-2">
              <Radio className="size-4 animate-pulse text-rose-400" />
              <span className="font-mono text-[11px] font-semibold tracking-[0.25em] text-rose-300">EMERGENCY BRIEFING</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-dim hover:text-white"
              onClick={() => {
                if (voice) stopSpeaking();
                else started.current = false;
                setVoice(!voice);
              }}
              aria-label={voice ? "Mute briefing" : "Play briefing"}
            >
              {voice ? <Volume2 /> : <VolumeX />}
            </Button>
          </div>
          <div className="overflow-y-auto px-5 py-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: city.accent }}>
              {city.name}, {city.state}
            </div>
            <h2 className="font-display text-4xl font-black uppercase tracking-[0.12em] text-white">{scenario.name}</h2>
            <p className="mt-3 text-[15px] leading-relaxed" aria-live="polite">
              <span className="text-white">{script.slice(0, spokenTo)}</span>
              <span className="text-white/45">{script.slice(spokenTo)}</span>
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Stat label={cfg.terms.atRisk} value={int(stats.atRisk)} accent />
              <Stat label="Households without a car (people)" value={int(stats.noCar)} />
              <Stat label="Aged 65+" value={int(stats.older)} />
              <Stat label="Below the poverty line" value={int(stats.lowIncome)} />
              <Stat label={stats.area.label} value={stats.area.value} />
              <Stat label={stats.fourth.label} value={stats.fourth.value} />
            </div>
            <div className="mt-5 hud-label">Timeline</div>
            <ol className="mt-2 flex flex-col gap-1">
              {scenario.briefing.timeline.map((t) => (
                <li key={t.label} className="flex items-baseline gap-3 text-sm">
                  <span className="w-20 font-mono text-xs text-[var(--city)]">
                    H+{t.hour} <span className="text-dim">{clock(t.hour)}</span>
                  </span>
                  <span className="text-white/85">{t.label}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Stat label="Budget" value={money(ROUND.budget)} />
              <Stat label="Planning time" value={mode === "planner" || planningSeconds === 0 ? "No limit" : `${Math.floor(planningSeconds / 60)}:${String(planningSeconds % 60).padStart(2, "0")}`} />
              <Stat label="Intel tokens" value={String(ROUND.intelTokens)} />
            </div>
            <div className="mt-5 hud-label">Uncertainty</div>
            <ul className="mt-1 flex list-inside list-disc flex-col gap-0.5 text-xs text-dim">
              {scenario.briefing.uncertainty.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
            <div className="mt-2 font-mono text-[10px] text-dim">
              Simulation covers {cfg.durationHours} hours · 1 agent ≈ {cfg.residentsPerAgent} residents
            </div>
          </div>
          <div className="border-t border-white/8 p-4">
            <Button size="lg" onClick={begin} className="h-12 w-full bg-[var(--city)] font-display text-lg font-bold uppercase tracking-[0.2em] text-[#03140d] hover:bg-[var(--city)] hover:brightness-110">
              Begin planning
            </Button>
          </div>
        </Panel>
      </motion.div>
    </motion.div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-[10.5px] text-dim">{label}</div>
      <div className={accent ? "font-mono text-xl font-semibold text-[var(--city)]" : "font-mono text-lg font-semibold text-white"}>{value}</div>
    </div>
  );
}
