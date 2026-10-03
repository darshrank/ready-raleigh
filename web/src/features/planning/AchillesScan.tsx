"use client";

import { Crosshair, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { int, money, Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { ROUND } from "@/config/game";
import { placeOrMove } from "@/features/map/layers";
import { COOLING_WALK_MINUTES, scanAchilles } from "@/lib/engine/achilles";
import { toEnginePlan } from "@/lib/engine/plan";
import { mapBus } from "@/lib/map-bus";
import { spent, useGame } from "@/stores/game";

/** Runs the scan with a short narrated animation, then flies to the finding. */
export function runAchillesScan() {
  const s = useGame.getState();
  if (s.achillesState !== "idle" || !s.data || !s.coverage) return;
  s.setAchilles(null, "scanning");
}

export function AchillesScan() {
  const state = useGame((s) => s.achillesState);
  const achilles = useGame((s) => s.achilles);
  const data = useGame((s) => s.data);
  const coverage = useGame((s) => s.coverage);
  const placements = useGame((s) => s.placements);
  const setAchilles = useGame((s) => s.setAchilles);
  const reducedMotion = useGame((s) => s.reducedMotion);
  const [line, setLine] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (state !== "scanning" || !data || !coverage) return;
    const timers = [0, 1, 2, 3, 4].map((k) => setTimeout(() => setLine(k), k * (reducedMotion ? 150 : 750)));
    const compute = setTimeout(() => {
      const result = scanAchilles(data, coverage.flood, toEnginePlan(useGame.getState().placements, data.cfg).crossings);
      setTimeout(
        () => {
          setAchilles(result, "done");
          if (result.mode === "network" && result.findings[0]) {
            const c = data.crossings[result.findings[0].crossing];
            mapBus.flyTo({ center: [c.lon, c.lat], zoom: 15, pitch: 60, bearing: 30, duration: reducedMotion ? 0 : 2600 });
          } else if (result.mode === "cooling" && result.gaps[0]) {
            const z = data.zones[result.gaps[0].zone];
            mapBus.flyTo({ center: [z.lon, z.lat], zoom: 14.2, pitch: 55, bearing: 20, duration: reducedMotion ? 0 : 2600 });
          }
        },
        reducedMotion ? 200 : 2400,
      );
    }, 60);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(compute);
    };
  }, [state, data, coverage, setAchilles, reducedMotion]);

  if (!data) return null;
  const cfg = data.cfg;
  const heat = cfg.hazard.type === "heat";
  const lines = heat
    ? ["SCANNING CITY…", `Mapping walking reach of ${data.shelters.length} possible cooling sites…`, `Checking ${data.origins.length} vulnerable household clusters…`, "Weighing heat exposure…", "Finding the widest cooling gap…"]
    : ["SCANNING CITY…", `Analyzing ${data.graph.m.toLocaleString()} road segments…`, `Testing ${data.crossings.length.toLocaleString()} crossings…`, `Evaluating population dependence for ${data.anchors.length + data.origins.length} neighborhood clusters…`, "Finding hidden bottleneck…"];
  const protectSpec = cfg.interventions.find((i) => i.effect === "protectRoad");
  const pickupSpec = cfg.interventions.find((i) => i.effect === "pickup");
  const top = achilles?.mode === "network" ? achilles.findings[0] : undefined;
  const gap = achilles?.mode === "cooling" ? achilles.gaps[0] : undefined;
  const c = top ? data.crossings[top.crossing] : null;
  const isProtected = c ? placements.some((p) => p.kind === protectSpec?.id && p.target === c.id) : false;
  const budgetLeft = ROUND.budget - spent(placements, cfg);

  return (
    <AnimatePresence>
      {state === "scanning" && (
        <motion.div key="scan" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pointer-events-none absolute left-1/2 top-24 z-30 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 sm:top-28">
          <Panel className="relative overflow-hidden border-rose-400/40 p-5">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute inset-x-0 h-1/2 animate-scan bg-gradient-to-b from-transparent via-rose-400/15 to-transparent" />
            </div>
            <div className="flex items-center gap-2 font-mono text-xs font-bold tracking-[0.25em] text-rose-300">
              <Crosshair className="size-4 animate-spin [animation-duration:3s]" /> {heat ? "COOLING ACCESS ANALYSIS" : "ACHILLES' HEEL ANALYSIS"}
            </div>
            <ul className="mt-3 flex flex-col gap-1 font-mono text-[12.5px]">
              {lines.slice(0, line + 1).map((l) => (
                <motion.li key={l} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="text-white/85">
                  {l}
                </motion.li>
              ))}
            </ul>
          </Panel>
        </motion.div>
      )}
      {state === "done" && !dismissed && (top || gap) && (
        <motion.div key="found" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pointer-events-none absolute bottom-40 left-1/2 z-30 max-h-[60vh] w-[560px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 overflow-y-auto md:bottom-28">
          <Panel className="pointer-events-auto border-rose-400/50 p-5">
            <button type="button" onClick={() => setDismissed(true)} className="absolute right-3 top-3 text-dim hover:text-white" aria-label="Dismiss">
              <X className="size-4" />
            </button>
            {top && c && (
              <>
                <div className="font-mono text-[11px] font-bold tracking-[0.25em] text-rose-300">CRITICAL INFRASTRUCTURE FOUND</div>
                <div className="mt-1 font-display text-3xl font-black uppercase tracking-wide text-white">{c.label}</div>
                <div className="mt-3 grid grid-cols-2 gap-4 text-[13px]">
                  <div>
                    <div className="hud-label">Why it matters</div>
                    <p className="mt-1 text-white/85">
                      {int(top.dependents)} residents&apos; fastest route to a hospital or safe ground crosses here at hour {achilles!.hour}.
                    </p>
                  </div>
                  <div>
                    <div className="hud-label">What happens if it fails</div>
                    <p className="mt-1 text-white/85">
                      {top.isolated > 0 ? `${int(top.isolated)} residents lose access to help within 30 minutes.` : `Detours add about ${top.addedMinutes.toFixed(1)} minutes for everyone who depends on it.`}{" "}
                      {Number.isFinite(top.closesAt)
                        ? `Expected to fail around hour ${top.closesAt.toFixed(0)}.`
                        : cfg.hazard.quake
                          ? `Not certain to fail: about ${Math.round(cfg.hazard.quake.highDamageShare * 100)}% of roads on High liquefaction ground break at the mainshock, and aftershocks close more.`
                          : "It sits outside the mapped hazard area."}
                    </p>
                  </div>
                  <div>
                    <div className="hud-label">Who depends on it</div>
                    <p className="mt-1 text-white/85">{top.zones.slice(0, 3).map((z) => data.zones[z.zone].name).join(", ")}</p>
                  </div>
                  <div>
                    <div className="hud-label">How to protect it</div>
                    {protectSpec && (
                      <Button size="sm" disabled={isProtected || budgetLeft < protectSpec.cost} onClick={() => placeOrMove(protectSpec.id, c.id, c.lon, c.lat, c.label)} className="mt-1 bg-sky-400 text-[#03121c] hover:bg-sky-300">
                        <ShieldCheck /> {isProtected ? "Protected" : `${protectSpec.short} · ${money(protectSpec.cost)}`}
                      </Button>
                    )}
                  </div>
                </div>
                {achilles!.findings.length > 1 && (
                  <div className="mt-3 border-t border-white/8 pt-2 text-xs text-dim">Also critical: {achilles!.findings.slice(1, 4).map((f) => data.crossings[f.crossing].label).join(" · ")}</div>
                )}
              </>
            )}
            {gap && (
              <>
                <div className="font-mono text-[11px] font-bold tracking-[0.25em] text-rose-300">COOLING GAP FOUND</div>
                <div className="mt-1 font-display text-3xl font-black uppercase tracking-wide text-white">{data.zones[gap.zone].name}</div>
                <div className="mt-3 grid grid-cols-2 gap-4 text-[13px]">
                  <div>
                    <div className="hud-label">Why it matters</div>
                    <p className="mt-1 text-white/85">
                      {int(gap.residents)} heat-vulnerable residents here have no possible cooling site within a {COOLING_WALK_MINUTES}-minute walk at an older adult&apos;s pace.
                    </p>
                  </div>
                  <div>
                    <div className="hud-label">How to close it</div>
                    {pickupSpec && gap.stop !== null ? (
                      <Button
                        size="sm"
                        disabled={budgetLeft < pickupSpec.cost}
                        onClick={() => {
                          const b = data.busStops[gap.stop!];
                          placeOrMove(pickupSpec.id, b.id, b.lon, b.lat, b.name || "Bus stop");
                        }}
                        className="mt-1 bg-amber-300 text-[#1c1403] hover:bg-amber-200"
                      >
                        <ShieldCheck /> {pickupSpec.short} at {data.busStops[gap.stop].name || "the nearest stop"} · {money(pickupSpec.cost)}
                      </Button>
                    ) : (
                      <p className="mt-1 text-white/85">Bring people to cooling by bus.</p>
                    )}
                  </div>
                </div>
                {achilles!.gaps.length > 1 && <div className="mt-3 border-t border-white/8 pt-2 text-xs text-dim">Also short on cooling: {achilles!.gaps.slice(1, 4).map((g) => data.zones[g.zone].name).join(" · ")}</div>}
              </>
            )}
          </Panel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
