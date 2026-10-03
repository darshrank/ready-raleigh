"use client";

import { ArrowLeft, ArrowRight, Info, Loader2, RotateCcw, Volume2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { AnimatedNumber, DataBadge, int, Meter, money, Panel, pct, StatusChip } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { BRAND, SCORE_LABELS, SCORE_WEIGHTS, specFor } from "@/config/game";
import { CITY_PACKS } from "@/cities";
import { QUADRANT_COLOR } from "@/features/map/colors";
import { statusFor } from "@/features/planning/Inspector";
import { QUADRANT_LABEL, type Quadrant } from "@/lib/engine/crowd";
import { mapBus } from "@/lib/map-bus";
import { speak, stopSpeaking } from "@/lib/speech";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import { debriefText, useResults } from "./useResults";

const STEPS = ["Your result", "Who benefited", "The road not taken", "The room", "Perception gap", "Debrief"];

export function Results() {
  const step = useGame((s) => s.resultsStep);
  const setStep = useGame((s) => s.setResultsStep);
  const data = useGame((s) => s.data)!;
  const r = useResults();
  const ready = !!r.you && !!r.room;

  useEffect(() => {
    if (step === 4 && r.gap) mapBus.flyTo({ center: [r.gap.zone.lon, r.gap.zone.lat], zoom: 13.4, pitch: 50, duration: 2200 });
    else if (step === 3 || step === 2) mapBus.flyTo({ center: [-78.64, 35.8], zoom: 11.2, pitch: 40, duration: 1800 });
  }, [step, r.gap]);

  useEffect(() => () => stopSpeaking(), []);

  return (
    <motion.div className="pointer-events-none absolute inset-0 z-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-[#050810]/90 via-[#050810]/30 to-transparent" />
      <div className="absolute left-4 top-4 flex items-center gap-2">
        <DataBadge kind="SCENARIO DATA" />
        <span className="font-mono text-[10px] tracking-wider text-dim">{BRAND.disclaimer}</span>
      </div>
      {step === 4 && <QuadrantLegend />}
      <motion.aside
        initial={{ x: 60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="pointer-events-auto absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col p-4"
      >
        <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <nav className="flex gap-1 overflow-x-auto border-b border-white/8 px-3 py-2" aria-label="Results steps">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition",
                  step === i ? "bg-white/12 text-white" : "text-dim hover:text-white",
                )}
              >
                {i + 1}. {s}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {!ready ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-dim">
                <Loader2 className="size-6 animate-spin" />
                <div className="font-mono text-xs tracking-widest">RUNNING THE OPTIMIZER AND THE ROOM…</div>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35 }}>
                  {step === 0 && <YourResult r={r} />}
                  {step === 1 && <WhoBenefited r={r} />}
                  {step === 2 && <RoadNotTaken r={r} />}
                  {step === 3 && <TheRoom r={r} />}
                  {step === 4 && <PerceptionGap r={r} />}
                  {step === 5 && <Debrief r={r} zoneName={(i) => data.zones[i].name} cfg={data.cfg} />}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-white/8 p-3">
            <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep(step - 1)}>
              <ArrowLeft /> Back
            </Button>
            <span className="font-mono text-[10px] text-dim">
              {step + 1} / {STEPS.length}
            </span>
            <Button size="sm" disabled={step === STEPS.length - 1 || !ready} onClick={() => setStep(step + 1)} className="bg-[var(--city)] text-[#03140d] hover:bg-[var(--city)]">
              Next <ArrowRight />
            </Button>
          </div>
        </Panel>
      </motion.aside>
    </motion.div>
  );
}

type R = ReturnType<typeof useResults>;

function Title({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="hud-label text-[var(--city)]">{kicker}</div>
      <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.1em] text-white">{children}</h2>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-40">
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="10" />
        <motion.circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="var(--city)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1.6, ease: "easeOut" }}
          style={{ filter: "drop-shadow(0 0 10px var(--city))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedNumber value={value} className="text-5xl font-bold text-white" />
        <span className="hud-label">Resilience</span>
      </div>
    </div>
  );
}

function YourResult({ r }: { r: R }) {
  const t = r.sim.totals;
  const s = r.you!;
  const data = useGame((st) => st.data)!;
  const cfg = data.cfg;
  const pack = CITY_PACKS[data.cityId];
  return (
    <div>
      <Title kicker={`${pack.name} · ${pack.scenarioTitle}`}>Your result</Title>
      <div className="flex items-center gap-6">
        <ScoreRing value={s.total} />
        <div className="flex flex-1 flex-col gap-2 text-sm">
          <Big label={cfg.terms.reached} value={t.protected + t.rescued} total={t.atRisk} color="#34d399" />
          <Big label={cfg.terms.stranded} value={t.stranded} total={t.atRisk} color="#f43f5e" />
          <Big label="Functionally isolated" value={t.isolated} total={t.atRisk} color="#a855f7" />
          <Big label={cfg.hazard.type === "heat" ? "Stayed home, coped" : "Stayed home, safe"} value={t.sheltering} total={t.atRisk} color="#94a3b8" />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between">
        <div className="hud-label">Score components</div>
        <Link href="/methodology#scoring" className="flex items-center gap-1 font-mono text-[10px] text-dim hover:text-white">
          <Info className="size-3" /> Game scoring model
        </Link>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k, i) => (
          <motion.div key={k} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.08 }}>
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-white/85">
                {SCORE_LABELS[k]} <span className="font-mono text-[10px] text-dim">×{SCORE_WEIGHTS[k]}</span>
              </span>
              <span className="font-mono text-white">{Math.round(s.components[k])}</span>
            </div>
            <Meter value={s.components[k] / 100} className="mt-1" />
          </motion.div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-dim">
        Weights are a design choice, not a scientific standard. Spent {money(s.spent)} of {money(10_000_000)}. Versus doing nothing:{" "}
        <span className="text-emerald-300">{s.gainVsBaseline >= 0 ? "+" : ""}{int(s.gainVsBaseline)}</span> vulnerability-weighted residents.
      </p>
    </div>
  );
}

function Big({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-white/80">{label}</span>
        <span className="font-mono text-white">
          <AnimatedNumber value={value} /> <span className="text-dim">({pct(value / total)})</span>
        </span>
      </div>
      <Meter value={value / total} color={color} className="mt-1" />
    </div>
  );
}

function WhoBenefited({ r }: { r: R }) {
  const data = useGame((s) => s.data)!;
  const s = r.you!;
  const groups = [
    { label: "All at-risk residents", v: s.shares.overall },
    { label: "Older adults (65+)", v: s.shares.older },
    { label: "Below poverty line", v: s.shares.lowIncome },
    { label: "Households without a car", v: s.shares.noCar },
  ];
  const top = [...r.zones].filter((z) => z.atRisk > 0).sort((a, b) => b.atRisk - a.atRisk).slice(0, 6);
  const f = r.failure;
  return (
    <div>
      <Title kicker="Equity">Who benefited?</Title>
      <div className="flex flex-col gap-2.5">
        {groups.map((g, i) => (
          <motion.div key={g.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.1 }}>
            <div className="flex justify-between text-[12.5px]">
              <span className="text-white/85">{g.label}</span>
              <span className="font-mono text-white">{pct(g.v)}</span>
            </div>
            <Meter value={g.v} color={g.v < s.shares.overall - 0.15 ? "#f43f5e" : "var(--city)"} className="mt-1 h-2" />
          </motion.div>
        ))}
      </div>

      <div className="mt-6 hud-label">Neighborhood breakdown</div>
      <table className="mt-2 w-full text-[12px]">
        <thead>
          <tr className="text-left text-dim">
            <th className="py-1 font-normal">Neighborhood</th>
            <th className="py-1 text-right font-normal">At risk</th>
            <th className="py-1 text-right font-normal">Safe</th>
            <th className="py-1 text-right font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {top.map((z) => (
            <tr key={z.zone} className="border-t border-white/5">
              <td className="py-1.5 text-white">{data.zones[z.zone].name}</td>
              <td className="py-1.5 text-right font-mono text-white/80">{int(z.atRisk)}</td>
              <td className="py-1.5 text-right font-mono text-white/80">{pct(z.protected / z.atRisk)}</td>
              <td className="py-1.5 text-right">
                <StatusChip level={z.isolated > z.atRisk * 0.3 ? "ISOLATED" : statusFor(z.protected / z.atRisk, z.atRisk)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {f && (
        <div className="mt-6">
          <div className="hud-label text-rose-300">Critical failure</div>
          <div className="mt-2 flex flex-col items-stretch gap-1">
            {[
              `${f.crossing.label} closed · H+${f.closedAt.toFixed(1)}`,
              `${int(f.affected)} evacuating residents lost their route`,
              `${int(f.rerouted)} rerouted onto longer detours`,
              `${int(f.stranded)} stranded before reaching safety`,
              f.isolation ? `${f.isolation.title} · H+${f.isolation.hour}` : "No neighborhood lost all access",
            ].map((txt, i, arr) => (
              <motion.div key={txt} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.35 }} className="flex flex-col items-center">
                <div className={cn("w-full rounded-md border px-3 py-1.5 text-center font-mono text-[11.5px] uppercase tracking-wide", i === 0 || i === arr.length - 1 ? "border-rose-400/40 bg-rose-500/10 text-rose-100" : "border-white/10 bg-white/[0.03] text-white/85")}>
                  {txt}
                </div>
                {i < arr.length - 1 && <span className="text-rose-300/70">↓</span>}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {r.missed && r.missed.unprotectedVuln > 0 && (
        <div className="mt-6 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
          <div className="hud-label text-amber-300">What you missed</div>
          <div className="mt-1 font-display text-xl font-bold uppercase text-white">{data.zones[r.missed.zone].name}</div>
          <p className="mt-1 text-[12.5px] text-white/80">
            {int(r.missed.atRisk - r.missed.protected)} residents never reached safety. {pct(data.zoneShares[r.missed.zone].snv)} of households have no car and{" "}
            {pct(data.zoneShares[r.missed.zone].spov)} live below the poverty line.
          </p>
          <Button size="sm" variant="outline" className="mt-2 border-white/15" onClick={() => mapBus.flyTo({ center: [data.zones[r.missed.zone].lon, data.zones[r.missed.zone].lat], zoom: 14, pitch: 55, duration: 1800 })}>
            Show me
          </Button>
        </div>
      )}
    </div>
  );
}

function RoadNotTaken({ r }: { r: R }) {
  const data = useGame((s) => s.data)!;
  const ref = r.reference!;
  const you = r.you!;
  const opt = r.optimal!;
  const chart = r.sim.timeline
    .filter((_, i) => i % 4 === 0)
    .map((s, i) => ({ hour: s.hour, You: Math.round(s.protected), Optimizer: Math.round(ref.sim.timeline[i * 4]?.protected ?? 0) }));
  const label = (effect: string, t: number, specId: string) =>
    effect === "shelter" || effect === "medical" || effect === "protectSite"
      ? data.shelters[t].name
      : effect === "pickup"
        ? data.busStops[t].name || "Bus stop"
        : effect === "protectRoad"
          ? data.crossings[t].label
          : effect === "rescue"
            ? data.fire[t].name
            : specFor(data.cfg, specId).label;
  return (
    <div>
      <Title kicker="Alternate timeline">The road not taken</Title>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="hud-label">Your city</div>
          <div className="font-mono text-4xl font-bold text-white">{you.total}</div>
          <div className="text-xs text-dim">{pct(you.shares.overall)} reached safety</div>
        </div>
        <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 p-3">
          <div className="hud-label text-violet-300">Optimized city</div>
          <div className="font-mono text-4xl font-bold text-violet-100">{opt.total}</div>
          <div className="text-xs text-violet-200/70">{pct(opt.shares.overall)} reached safety</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-dim">Same seed, same storm, same random events. Only the plan differs.</p>
      <div className="mt-4 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.1)" />
            <XAxis dataKey="hour" stroke="#8796b0" fontSize={10} tickFormatter={(h) => `H${h}`} />
            <YAxis stroke="#8796b0" fontSize={10} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <RTooltip contentStyle={{ background: "#0c1324", border: "1px solid rgba(148,163,184,0.2)", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="You" stroke="#34d399" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Optimizer" stroke="#c084fc" strokeWidth={2} dot={false} strokeDasharray="5 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 hud-label">What the optimizer chose (greedy, vulnerability-weighted)</div>
      <ol className="mt-2 flex flex-col gap-1.5">
        {ref.steps.map((s, i) => (
          <li key={i} className="flex items-baseline gap-2 text-[12.5px]">
            <span className="font-mono text-violet-300">{i + 1}.</span>
            <span className="text-white">{label(s.effect, s.target, s.spec)}</span>
            <span className="ml-auto font-mono text-[11px] text-dim">
              {specFor(data.cfg, s.spec).short} · {money(specFor(data.cfg, s.spec).cost)}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-dim">The optimizer is shown on the map in violet. It searches with the planning estimate, then runs through the same simulation as you.</p>
    </div>
  );
}

function TheRoom({ r }: { r: R }) {
  return (
    <div>
      <Title kicker="Multiplayer reveal">The room</Title>
      <div className="mb-3 flex items-center gap-2">
        <DataBadge kind="SIMULATED PLAYERS" />
        <span className="text-xs text-dim">Stand-ins until realtime rooms run on the backend</span>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-dim">
            <th className="py-1 font-normal">#</th>
            <th className="py-1 font-normal">Player</th>
            <th className="py-1 text-right font-normal">Score</th>
            <th className="py-1 text-right font-normal">Vulnerable</th>
            <th className="py-1 text-right font-normal">Budget eff.</th>
            <th className="py-1 text-right font-normal">Critical kept</th>
          </tr>
        </thead>
        <tbody>
          {r.room!.map((p, i) => {
            const kept = r.ctx!.critical.filter((c) => p.sim.plan.crossings.includes(c.crossing)).length;
            return (
              <motion.tr
                key={p.name}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.12 }}
                className={cn("border-t border-white/5", !p.simulated && "bg-[var(--city)]/10")}
              >
                <td className="py-2 font-mono text-dim">{i + 1}</td>
                <td className="py-2">
                  <div className="text-white">{p.name}</div>
                  {"style" in p && <div className="text-[10.5px] text-dim">{p.style as string}</div>}
                </td>
                <td className="py-2 text-right font-mono text-lg font-semibold text-white">{p.score.total}</td>
                <td className="py-2 text-right font-mono text-white/80">{pct(p.score.shares.vulnerable)}</td>
                <td className="py-2 text-right font-mono text-white/80">{Math.round(p.score.components.budget)}</td>
                <td className="py-2 text-right font-mono text-white/80">{kept}</td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-4 text-xs leading-relaxed text-dim">
        The heatmap shows where the whole room placed interventions. Grey icons are other players&apos; picks. Every plan ran through the same simulation.
      </p>
    </div>
  );
}

function QuadrantLegend() {
  return (
    <Panel className="pointer-events-auto absolute bottom-4 left-4 w-[300px] p-3">
      <div className="hud-label">Crowd vs. data</div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {(["consensus", "blindspot", "signal", "low"] as Quadrant[]).map((q) => (
          <div key={q} className="flex items-center gap-2 text-[11.5px] text-white/85">
            <span className="size-3 rounded-sm" style={{ background: `rgba(${QUADRANT_COLOR[q].slice(0, 3).join(",")},0.9)` }} />
            {QUADRANT_LABEL[q]}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10.5px] leading-snug text-dim">Data = vulnerability-weighted residents left unprotected with no action. Crowd = how strongly the room&apos;s placements reached each zone.</div>
    </Panel>
  );
}

function PerceptionGap({ r }: { r: R }) {
  const counts = r.crowd!.zones.reduce<Record<string, number>>((acc, z) => ({ ...acc, [z.quadrant]: (acc[z.quadrant] ?? 0) + 1 }), {});
  const g = r.gap;
  return (
    <div>
      <Title kicker="Crowd intelligence">Perception gap</Title>
      <div className="grid grid-cols-2 gap-2">
        {(["consensus", "blindspot", "signal", "low"] as Quadrant[]).map((q) => (
          <div key={q} className="rounded-lg border border-white/8 p-2.5" style={{ background: `rgba(${QUADRANT_COLOR[q].slice(0, 3).join(",")},0.1)` }}>
            <div className="text-[11px] text-white/80">{QUADRANT_LABEL[q]}</div>
            <div className="font-mono text-2xl font-semibold text-white">{counts[q] ?? 0}</div>
            <div className="text-[10px] text-dim">neighborhoods</div>
          </div>
        ))}
      </div>
      {g && (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 }} className="mt-5 rounded-xl border border-rose-400/40 bg-rose-500/10 p-4">
          <div className="font-mono text-[11px] font-bold tracking-[0.2em] text-rose-300">{g.crowd < 0.05 ? "EVERY PLAYER OVERLOOKED" : "THE ROOM BARELY REACHED"}</div>
          <div className="mt-1 font-display text-3xl font-black uppercase tracking-wide text-white">{g.zone.name}</div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
            <span className="text-dim">At-risk residents</span>
            <span className="text-right font-mono text-white">{int(g.zone.atRisk)}</span>
            <span className="text-dim">No-car households</span>
            <span className="text-right font-mono text-white">{pct(g.shares.snv)}</span>
            <span className="text-dim">Aged 65+</span>
            <span className="text-right font-mono text-white">{pct(g.shares.s65)}</span>
            <span className="text-dim">Below poverty line</span>
            <span className="text-right font-mono text-white">{pct(g.shares.spov)}</span>
            <span className="text-dim">Area in flood zones</span>
            <span className="text-right font-mono text-white">{pct(g.zone.floodShare)}</span>
            <span className="text-dim">Nearest dry shelter site</span>
            <span className="text-right font-mono text-white">{g.nearestShelter ? `${(g.nearestShelter.meters / 1000).toFixed(1)} km` : "none"}</span>
            {g.bottleneck && (
              <>
                <span className="text-dim">Network bottleneck</span>
                <span className="text-right text-white">{g.bottleneck.label}</span>
              </>
            )}
          </div>
          <div className="mt-4 font-display text-xl font-bold uppercase tracking-wide text-rose-100">Why did everyone miss it?</div>
        </motion.div>
      )}
    </div>
  );
}

function Debrief({ r, zoneName, cfg }: { r: R; zoneName: (i: number) => string; cfg: import("@/config/game").ScenarioParams }) {
  const parts = debriefText(r, { zone: zoneName }, cfg);
  const newRound = useGame((s) => s.newRound);
  const setPhase = useGame((s) => s.setPhase);
  const backToLanding = useGame((s) => s.backToLanding);
  return (
    <div>
      <Title kicker="After-action report">Debrief</Title>
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9.5px] tracking-widest text-dim">DETERMINISTIC DEBRIEF</span>
        <span className="text-[11px] text-dim">Gemini commentary arrives with the backend. Every number here comes from the engine.</span>
      </div>
      <div className="flex flex-col gap-3 text-[14px] leading-relaxed text-white/90">
        {parts.map((p, i) => (
          <motion.p key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.25 }}>
            {p}
          </motion.p>
        ))}
      </div>
      <Button variant="outline" size="sm" className="mt-4 border-white/15" onClick={() => speak(parts.join(" "))}>
        <Volume2 /> Listen
      </Button>
      <div className="mt-6 rounded-lg border border-white/8 bg-white/[0.03] p-4 text-center font-display text-lg font-semibold uppercase tracking-wide text-white/90">
        {BRAND.closing}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button
          className="bg-[var(--city)] text-[#03140d] hover:bg-[var(--city)]"
          onClick={() => {
            newRound();
            useGame.setState({ timerRunning: useGame.getState().planningSeconds > 0, demo: false });
            setPhase("planning");
          }}
        >
          <RotateCcw /> Replan this storm
        </Button>
        <Button
          variant="outline"
          className="border-white/15"
          onClick={() => {
            newRound();
            useGame.setState({ demo: false });
            setPhase("select");
          }}
        >
          Choose another city
        </Button>
        <Button variant="ghost" className="col-span-2 text-dim" onClick={backToLanding}>
          Back to start
        </Button>
      </div>
    </div>
  );
}
