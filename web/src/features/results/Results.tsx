"use client";

import { ArrowLeft, ArrowRight, Bot, Crown, ExternalLink, Info, Loader2, RotateCcw, ShieldCheck, Volume2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { CITY_PACKS } from "@/cities";
import { AnimatedNumber, DataBadge, int, Meter, money, Panel, pct } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { BRAND, ROUND, SCORE_LABELS, SCORE_WEIGHTS } from "@/config/game";
import { isRoomHost, playerId, useRoom } from "@/features/room/room-store";
import { api, useBackend, type ProofReply } from "@/lib/api";
import { sfx } from "@/lib/audio/sfx";
import { toEnginePlan } from "@/lib/engine/plan";
import { mapBus } from "@/lib/map-bus";
import { speak, stopSpeaking } from "@/lib/speech";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import { debriefContext, debriefText, grade, useResults, type Results as R } from "./useResults";

const STEPS = ["Score", "The room", "Debrief"];

export function Results() {
  const step = useGame((s) => s.resultsStep);
  const setStep = useGame((s) => s.setResultsStep);
  const data = useGame((s) => s.data)!;
  const r = useResults();
  const ready = !!r.you && !!r.rows;
  const celebrated = useRef(false);
  const confetti = !!r.you && !!r.optimal && (r.you.total >= r.optimal.total || r.you.total >= 70);

  // once per round: celebrate, save the round, report to the room
  useEffect(() => {
    if (!r.you || !r.optimal || celebrated.current) return;
    celebrated.current = true;
    const g = useGame.getState();
    sfx.fanfare();
    sfx.buzz([60, 40, 60, 40, 160]);
    const plan = toEnginePlan(g.placements, data.cfg);
    const t = r.sim.totals;
    const room = useRoom.getState();
    const name = room.name || "Solo player";
    if (g.mode === "multiplayer" && room.room) {
      room.send({ type: "result", round: room.room.round, result: { score: r.you.total, reached: Math.round(t.protected + t.rescued), atRisk: Math.round(t.atRisk), vulnerableShare: r.you.shares.vulnerable, spent: r.you.spent, plan } });
    }
    if (useBackend.getState().status === "online") {
      void api.saveRound({ roomCode: room.room?.code ?? null, cityId: data.cityId, seed: g.seed, playerName: name, score: r.you.total, protected: Math.round(t.protected + t.rescued), atRisk: Math.round(t.atRisk), spent: r.you.spent, plan }).catch(() => {});
      void api
        .saveActions({ roomCode: room.room?.code ?? null, playerId: playerId(), cityId: data.cityId, actions: g.placements.map((p) => ({ action: "place", intervention: p.kind, lon: p.lon, lat: p.lat, cost: data.cfg.interventions.find((i) => i.id === p.kind)?.cost ?? 0 })) })
        .catch(() => {});
    }
  }, [r.you, r.optimal, r.sim, data]);

  useEffect(() => {
    const pack = CITY_PACKS[data.cityId];
    const overview = pack.cameraBookmarks.find((b) => b.id === "overview") ?? pack.cameraBookmarks[0];
    if (step === 1 && r.gap) mapBus.flyTo({ center: [r.gap.zone.lon, r.gap.zone.lat], zoom: 13.2, pitch: 50, duration: 2200 });
    else mapBus.flyTo({ center: overview.center, zoom: overview.zoom, pitch: 45, bearing: overview.bearing, duration: 1800 });
  }, [step, r.gap, data.cityId]);

  useEffect(() => () => stopSpeaking(), []);

  const next = () => {
    sfx.whoosh();
    setStep(step + 1);
  };

  return (
    <motion.div className="pointer-events-none absolute inset-0 z-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#050810]/90 via-[#050810]/30 to-transparent sm:bg-gradient-to-l" />
      {confetti && <Confetti />}
      <div className="absolute left-4 top-4 hidden items-center gap-2 sm:flex">
        <DataBadge kind="SCENARIO DATA" />
        <span className="font-mono text-[10px] tracking-wider text-dim">{BRAND.disclaimer}</span>
      </div>
      <motion.aside
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="pointer-events-auto absolute inset-x-0 bottom-0 flex h-[78vh] flex-col p-2 sm:inset-y-0 sm:left-auto sm:right-0 sm:h-auto sm:w-full sm:max-w-[540px] sm:p-4"
      >
        <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <nav className="flex gap-1 border-b border-white/8 px-3 py-2" aria-label="Results steps">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                disabled={!ready}
                onClick={() => setStep(i)}
                className={cn("flex-1 rounded-md px-2 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition", step === i ? "bg-white/12 text-white" : "text-dim hover:text-white")}
              >
                {i + 1}. {s}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {!ready ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-dim">
                <Loader2 className="size-6 animate-spin" />
                <div className="font-mono text-xs tracking-widest">SCORING YOUR CITY AGAINST THE AI…</div>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                  {step === 0 && <YourScore r={r} />}
                  {step === 1 && <TheRoom r={r} />}
                  {step === 2 && <Debrief r={r} />}
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
            <Button size="sm" disabled={step === STEPS.length - 1 || !ready} onClick={next} className="bg-[var(--city)] text-[#03140d] hover:bg-[var(--city)]">
              Next <ArrowRight />
            </Button>
          </div>
        </Panel>
      </motion.aside>
    </motion.div>
  );
}

function Title({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="hud-label text-[var(--city)]">{kicker}</div>
      <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.08em] text-white">{children}</h2>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const shown = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (shown.current >= value) return clearInterval(id);
      shown.current += 3;
      sfx.scoreTick();
    }, 45);
    return () => clearInterval(id);
  }, [value]);
  return (
    <div className="relative size-36 shrink-0 sm:size-40">
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
      <motion.div
        initial={{ scale: 2.4, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: -8 }}
        transition={{ delay: 1.5, type: "spring", stiffness: 260, damping: 14 }}
        className="absolute -right-2 -top-1 flex size-12 items-center justify-center rounded-xl border-2 border-[var(--city)] bg-[#050810] font-display text-3xl font-black text-[var(--city)] shadow-[0_0_20px_-4px_var(--city)]"
      >
        {grade(value)}
      </motion.div>
    </div>
  );
}

function YourScore({ r }: { r: R }) {
  const t = r.sim.totals;
  const s = r.you!;
  const opt = r.optimal!;
  const data = useGame((st) => st.data)!;
  const cfg = data.cfg;
  const pack = CITY_PACKS[data.cityId];
  const beat = s.total >= opt.total;
  return (
    <div>
      <Title kicker={`${pack.name} · ${pack.scenarioTitle}`}>{beat ? "You beat the AI!" : "Your result"}</Title>
      <div className="flex items-center gap-4 sm:gap-6">
        <ScoreRing value={s.total} />
        <div className="flex flex-1 flex-col gap-2 text-sm">
          <Big label={cfg.terms.reached} value={t.protected + t.rescued} total={t.atRisk} color="#34d399" />
          <Big label={cfg.terms.stranded} value={t.stranded} total={t.atRisk} color="#f43f5e" />
          <Big label="Cut off from help" value={t.isolated} total={t.atRisk} color="#a855f7" />
        </div>
      </div>
      <div className={cn("mt-4 flex items-center gap-3 rounded-xl border p-3", beat ? "border-emerald-400/40 bg-emerald-500/10" : "border-violet-400/35 bg-violet-500/10")}>
        <Bot className={cn("size-6 shrink-0", beat ? "text-emerald-300" : "text-violet-300")} />
        <div className="text-[13px] text-white/90">
          {beat ? (
            <>The optimizer scored <b>{opt.total}</b>. Your plan matched or beat it on the same storm and the same random events.</>
          ) : (
            <>The AI optimizer scored <b>{opt.total}</b>, {opt.total - s.total} points higher. Page 2 shows where it spent the money.</>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="hud-label">How the score is built</div>
        <Link href="/methodology#scoring" className="flex items-center gap-1 font-mono text-[10px] text-dim hover:text-white">
          <Info className="size-3" /> Scoring model
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k, i) => (
          <motion.div key={k} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.07 }}>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="truncate text-white/80">{SCORE_LABELS[k]}</span>
              <span className="font-mono text-white">{Math.round(s.components[k])}</span>
            </div>
            <Meter value={s.components[k] / 100} className="mt-1" />
          </motion.div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-dim">
        Spent {money(s.spent)} of {money(ROUND.budget)}. Weights are a design choice, not a scientific standard.
      </p>
    </div>
  );
}

function Big({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12.5px] text-white/80">{label}</span>
        <span className="font-mono text-[13px] text-white">
          <AnimatedNumber value={value} /> <span className="text-dim">({pct(value / total)})</span>
        </span>
      </div>
      <Meter value={value / total} color={color} className="mt-1" />
    </div>
  );
}

function TheRoom({ r }: { r: R }) {
  const data = useGame((s) => s.data)!;
  const db = useBackend((s) => s.status === "online" && s.services.database);
  const [best, setBest] = useState<{ playerName: string; score: number }[] | null>(null);
  useEffect(() => {
    if (!db) return;
    api
      .leaderboard(data.cityId)
      .then((j) => setBest(j.entries.slice(0, 5)))
      .catch(() => setBest(null));
  }, [db, data.cityId]);
  const ref = r.reference!;
  const chart = r.sim.timeline
    .filter((_, i) => i % 4 === 0)
    .map((s, i) => ({ hour: s.hour, You: Math.round(s.protected), AI: Math.round(ref.sim.timeline[i * 4]?.protected ?? 0) }));
  const g = r.gap;
  return (
    <div>
      <Title kicker={r.multiplayer ? "Live room" : "Leaderboard"}>The room</Title>
      {!r.multiplayer && (
        <div className="mb-2 flex items-center gap-2">
          <DataBadge kind="SIMULATED PLAYERS" />
          <span className="text-[11px] text-dim">Host a room to play against real people</span>
        </div>
      )}
      <ol className="flex flex-col gap-1.5">
        {r.rows!.map((p, i) => (
          <motion.li
            key={p.name}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2",
              p.kind === "you" ? "border-[var(--city)]/50 bg-[var(--city)]/12" : p.kind === "ai" ? "border-violet-400/35 bg-violet-500/10" : "border-white/8 bg-white/[0.03]",
            )}
          >
            <span className="w-5 font-mono text-sm text-dim">{p.pending ? "…" : i + 1}</span>
            {i === 0 && !p.pending && <Crown className="size-4 text-amber-300" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-white">{p.name}</div>
              <div className="font-mono text-[10.5px] text-dim">{p.pending ? "still planning…" : `${pct(p.reached)} safe · ${pct(p.vulnerable)} vulnerable · ${money(p.spent)}`}</div>
            </div>
            <span className="font-mono text-xl font-bold text-white">{p.pending ? "" : p.score}</span>
          </motion.li>
        ))}
      </ol>

      {g && (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className="mt-4 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3">
          <div className="font-mono text-[10.5px] font-bold tracking-[0.2em] text-rose-300">{g.crowd < 0.05 ? "EVERYONE OVERLOOKED" : "THE ROOM BARELY REACHED"}</div>
          <div className="mt-0.5 font-display text-2xl font-black uppercase tracking-wide text-white">{g.zone.name}</div>
          <div className="mt-1 text-[12.5px] text-white/80">
            {int(g.zone.atRisk)} at-risk residents · {pct(g.shares.snv)} of households without a car · {pct(g.shares.spov)} below the poverty line
            {g.nearestShelterKm !== null && ` · nearest dry shelter site ${g.nearestShelterKm.toFixed(1)} km`}
          </div>
        </motion.div>
      )}

      <div className="mt-4 hud-label">People safe over time: you vs the AI</div>
      <div className="mt-1 h-36">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={{ top: 5, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.1)" />
            <XAxis dataKey="hour" stroke="#8796b0" fontSize={10} tickFormatter={(h) => `H${h}`} />
            <YAxis stroke="#8796b0" fontSize={10} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <RTooltip contentStyle={{ background: "#0c1324", border: "1px solid rgba(148,163,184,0.2)", fontSize: 12 }} />
            <Line type="monotone" dataKey="You" stroke="#34d399" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="AI" stroke="#c084fc" strokeWidth={2} dot={false} strokeDasharray="5 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {best && best.length > 0 && (
        <div className="mt-4">
          <div className="hud-label">All-time best in {CITY_PACKS[data.cityId].name} · Tiger Data</div>
          <ol className="mt-1.5 flex flex-col gap-0.5 font-mono text-[12px]">
            {best.map((b, i) => (
              <li key={`${b.playerName}-${i}`} className="flex justify-between text-white/80">
                <span>
                  {i + 1}. {b.playerName}
                </span>
                <span className="text-white">{b.score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="mt-3 text-[11px] text-dim">The map shows where the room placed interventions. Violet icons are the AI optimizer&apos;s picks.</p>
    </div>
  );
}

function Debrief({ r }: { r: R }) {
  const data = useGame((s) => s.data)!;
  const newRound = useGame((s) => s.newRound);
  const setPhase = useGame((s) => s.setPhase);
  const backToLanding = useGame((s) => s.backToLanding);
  const placements = useGame((s) => s.placements);
  const mode = useGame((s) => s.mode);
  const room = useRoom((s) => s.room);
  const gemini = useBackend((s) => s.status === "online" && s.services.gemini);
  const solana = useBackend((s) => s.status === "online" && s.services.solana);
  const zoneName = (i: number) => data.zones[i].name;
  const fallback = debriefText(r, { zone: zoneName }, data.cfg).join(" ");
  const [text, setText] = useState<string | null>(gemini ? null : fallback);
  const [proof, setProof] = useState<ProofReply | "busy" | null>(null);
  const multiplayer = mode === "multiplayer" && !!room;
  const host = isRoomHost(room);

  useEffect(() => {
    if (!gemini) return;
    let live = true;
    api
      .debrief(data.cityId, debriefContext(r, zoneName))
      .then((j) => live && setText(j.text))
      .catch(() => live && setText(fallback));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gemini]);

  const f = r.failure;
  return (
    <div>
      <Title kicker="After-action report">Debrief</Title>
      <div className="mb-2 font-mono text-[9.5px] tracking-widest text-dim">{gemini ? "GEMINI · EVERY NUMBER FROM THE GAME ENGINE" : "ENGINE DEBRIEF"}</div>
      {text ? (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[14.5px] leading-relaxed text-white/90">
          {text}
        </motion.p>
      ) : (
        <div className="flex items-center gap-2 font-mono text-xs text-dim">
          <Loader2 className="size-4 animate-spin" /> Writing your debrief…
        </div>
      )}
      <Button variant="outline" size="sm" className="mt-3 border-white/15" disabled={!text} onClick={() => text && speak(text)}>
        <Volume2 /> Listen
      </Button>

      {f && f.affected > 0 && (
        <div className="mt-5">
          <div className="hud-label text-rose-300">What broke</div>
          <div className="mt-2 flex flex-col gap-1">
            {[`${f.crossing.label} failed · hour ${f.closedAt.toFixed(1)}`, `${int(f.affected)} evacuating residents lost their route`, `${int(f.stranded)} never reached safety`].map((txt, i, arr) => (
              <motion.div key={txt} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.3 }} className="flex flex-col items-center">
                <div className={cn("w-full rounded-md border px-3 py-1.5 text-center font-mono text-[11px] uppercase tracking-wide", i === 0 || i === arr.length - 1 ? "border-rose-400/40 bg-rose-500/10 text-rose-100" : "border-white/10 bg-white/[0.03] text-white/85")}>{txt}</div>
                {i < arr.length - 1 && <span className="text-rose-300/70">↓</span>}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {solana && (
        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="hud-label">Civic proof</div>
              <div className="text-[12px] text-white/75">Record a hash of this plan on Solana devnet, so it can&apos;t be quietly changed later.</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-white/15"
              disabled={proof === "busy" || (!!proof && typeof proof === "object" && !!proof.signature)}
              onClick={() => {
                setProof("busy");
                api
                  .proof({ cityId: data.cityId, score: r.you!.total, playerName: useRoom.getState().name || "Solo player", plan: toEnginePlan(placements, data.cfg) })
                  .then(setProof)
                  .catch((e: Error) => setProof({ hash: "", error: e.message }));
              }}
            >
              {proof === "busy" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Seal plan
            </Button>
          </div>
          {proof && proof !== "busy" && (
            <div className="mt-2 break-all font-mono text-[10.5px]">
              {proof.signature ? (
                <a href={proof.explorerUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-emerald-300 hover:underline">
                  VERIFIED PLAN RECEIPT <ExternalLink className="size-3" />
                </a>
              ) : (
                <span className="text-amber-200">Not recorded: {proof.error}</span>
              )}
              {proof.hash && <div className="text-dim">sha256 {proof.hash.slice(0, 24)}…</div>}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 rounded-lg border border-white/8 bg-white/[0.03] p-3 text-center font-display text-base font-semibold uppercase tracking-wide text-white/90">{BRAND.closing}</div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {multiplayer ? (
          host ? (
            <Button className="col-span-2 bg-[var(--city)] text-[#03140d] hover:bg-[var(--city)]" onClick={() => useRoom.getState().send({ type: "reset" })}>
              <RotateCcw /> Back to the lobby for another round
            </Button>
          ) : (
            <div className="col-span-2 rounded-lg border border-white/10 p-2 text-center text-[12px] text-dim">The host starts the next round.</div>
          )
        ) : (
          <>
            <Button
              className="bg-[var(--city)] text-[#03140d] hover:bg-[var(--city)]"
              onClick={() => {
                newRound();
                useGame.setState({ timerRunning: useGame.getState().planningSeconds > 0, demo: false });
                setPhase("planning");
              }}
            >
              <RotateCcw /> Try again
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
              Another city
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          className="col-span-2 text-dim"
          onClick={() => {
            useRoom.getState().leave();
            backToLanding();
          }}
        >
          Back to start
        </Button>
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ["#34d399", "#38bdf8", "#facc15", "#fb923c", "#f43f5e", "#a855f7"];

function Confetti() {
  const reduced = useGame((s) => s.reducedMotion);
  const [pieces] = useState(() =>
    Array.from({ length: 70 }, (_, i) => ({ id: i, x: Math.random() * 100, d: Math.random() * 0.6, r: Math.random() * 360, c: CONFETTI_COLORS[i % CONFETTI_COLORS.length], s: 6 + Math.random() * 6, dur: 2.6 + Math.random() })),
  );
  if (reduced) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-0 block rounded-sm"
          style={{ left: `${p.x}%`, width: p.s, height: p.s * 0.45, background: p.c }}
          initial={{ y: -20, rotate: p.r, opacity: 1 }}
          animate={{ y: "105vh", rotate: p.r + 540, opacity: [1, 1, 0] }}
          transition={{ duration: p.dur, delay: 1.4 + p.d, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}
