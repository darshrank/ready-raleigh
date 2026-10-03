"use client";

import { Bot, Crosshair, Loader2, Send, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { create } from "zustand";
import { int, money, Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { placeOrMove } from "@/features/map/layers";
import { api, useBackend } from "@/lib/api";
import { sfx } from "@/lib/audio/sfx";
import { mapBus } from "@/lib/map-bus";
import { speak } from "@/lib/speech";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import { commanderContext, type Candidate } from "./commander";

export const useCommander = create<{ open: boolean; toggle: () => void }>((set) => ({ open: false, toggle: () => set((s) => ({ open: !s.open })) }));

const PROMPTS = ["What should I do first?", "Who is most at risk right now?", "Best use of my remaining budget?"];

interface Reply {
  answer: string;
  evidence: string[];
  tradeoff?: string;
  candidate: Candidate | null;
  source: "gemini" | "engine";
}

function offlineReply(question: string, cands: Candidate[]): Reply {
  const best = cands[0] ?? null;
  return {
    answer: best
      ? `${best.spec.label} at ${best.label} protects about ${int(best.residents)} more at-risk residents for ${money(best.spec.cost)}, the best value the engine found.`
      : "Nothing affordable adds protection in the estimate. Consider rescue teams, which act during the simulation.",
    evidence: best ? [`+${int(best.vulnerable)} vulnerability-weighted residents`, `Question: ${question}`] : [],
    candidate: best,
    source: "engine",
  };
}

export function CommanderButton({ className }: { className?: string }) {
  const toggle = useCommander((s) => s.toggle);
  const open = useCommander((s) => s.open);
  const gemini = useBackend((s) => s.status === "online" && s.services.gemini);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        sfx.click();
        toggle();
      }}
      aria-pressed={open}
      className={cn("border-violet-400/40 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25", className)}
    >
      <Bot /> <span className="hidden sm:inline">AI Commander</span>
      {gemini && <Sparkles className="size-3 text-violet-300" />}
    </Button>
  );
}

export function AiCommander() {
  const open = useCommander((s) => s.open);
  const toggle = useCommander((s) => s.toggle);
  const data = useGame((s) => s.data);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);

  const ask = async (question: string) => {
    if (!data || busy) return;
    setBusy(true);
    setReply(null);
    sfx.whoosh();
    await new Promise((r) => setTimeout(r, 30));
    const { context, candidates } = commanderContext();
    const b = useBackend.getState();
    let r: Reply;
    if (b.status === "online" && b.services.gemini) {
      try {
        const g = await api.commander(data.cityId, question, context);
        r = { answer: g.answer, evidence: g.evidence ?? [], tradeoff: g.tradeoff, candidate: candidates.find((c) => c.id === g.candidateId) ?? null, source: "gemini" };
      } catch {
        r = offlineReply(question, candidates);
      }
    } else r = offlineReply(question, candidates);
    setReply(r);
    setBusy(false);
    sfx.alert("info");
    speak(r.answer, { rate: 1.05 });
  };

  if (!data) return null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="pointer-events-none absolute inset-x-2 bottom-[9.5rem] z-30 md:inset-x-auto md:bottom-20 md:right-4 md:w-[380px]"
        >
          <Panel className="pointer-events-auto max-h-[56vh] overflow-y-auto border-violet-400/35 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.25em] text-violet-200">
                <Bot className="size-4" /> AI COMMANDER
              </div>
              <button type="button" onClick={toggle} className="text-dim hover:text-white" aria-label="Close AI Commander">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {PROMPTS.map((p) => (
                <button key={p} type="button" disabled={busy} onClick={() => void ask(p)} className="rounded-full border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-[12px] text-violet-100 transition hover:bg-violet-500/25 disabled:opacity-50">
                  {p}
                </button>
              ))}
            </div>
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) void ask(q.trim());
              }}
            >
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this city…" className="h-9 text-sm" />
              <Button type="submit" size="icon" disabled={busy || !q.trim()} className="bg-violet-500 text-white hover:bg-violet-400" aria-label="Ask">
                <Send />
              </Button>
            </form>
            {busy && (
              <div className="mt-4 flex items-center gap-2 font-mono text-xs text-violet-200">
                <Loader2 className="size-4 animate-spin" /> Reading the road network and census data…
              </div>
            )}
            {reply && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                <p className="text-[14px] leading-relaxed text-white">{reply.answer}</p>
                {reply.evidence.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-0.5 text-[12px] text-white/70">
                    {reply.evidence.slice(0, 3).map((e) => (
                      <li key={e}>• {e}</li>
                    ))}
                  </ul>
                )}
                {reply.tradeoff && <p className="mt-2 text-[12px] text-amber-200/80">Trade-off: {reply.tradeoff}</p>}
                {reply.candidate && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="bg-[var(--city)] text-[#03140d] hover:bg-[var(--city)]"
                      onClick={() => {
                        const c = reply.candidate!;
                        placeOrMove(c.spec.id, c.target, c.lon, c.lat, c.label);
                        mapBus.flyTo({ center: [c.lon, c.lat], zoom: 14.2, pitch: 55, duration: 1600 });
                      }}
                    >
                      Place it · {money(reply.candidate.spec.cost)}
                    </Button>
                    <Button size="sm" variant="outline" className="border-white/15" onClick={() => mapBus.flyTo({ center: [reply.candidate!.lon, reply.candidate!.lat], zoom: 14.5, pitch: 55, duration: 1600 })}>
                      <Crosshair /> Show me
                    </Button>
                  </div>
                )}
                <div className="mt-3 font-mono text-[9.5px] tracking-widest text-dim">{reply.source === "gemini" ? "GEMINI · NUMBERS FROM THE GAME ENGINE" : "ENGINE ADVISOR · GEMINI OFFLINE"}</div>
              </motion.div>
            )}
          </Panel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
