// After the storm, the results in three pages (like the results flow on feat/ready-raleigh-adit):
// 1. Score: how the plan did, against the best plan the data found, and where it fell short.
// 2. Leaderboard: the city's all-time board; in a room, this election's results first.
// 3. Debrief: a short summary Gemini writes from the engine's numbers (POST /api/debrief), read
//    aloud by the ElevenLabs narrator, and the play's public record on Solana.
// One plate, the same on a phone and a laptop: tabs at the top, Back and Next at the bottom.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { create } from 'zustand';
import type { DebriefFacts } from '@shared/debrief';
import type { Placement, ScoreResult } from '@shared/types';
import { fetchDebrief, playerId } from '../api';
import { CivicRecord } from '../civic/CivicRecord';
import type { MapData } from '../data';
import { usePlan } from '../plan/store';
import type { Story } from '../story';
import { leaveGame } from '../ui/Exit';
import { PLATE } from '../ui/Hud';
import { playStamp } from '../ui/sound';
import { hush, prefetchSpeech, say, useVoice } from '../ui/voice';
import { biggestGaps, debriefFacts, templateDebrief } from './debrief';
import { LeaderboardBody, useBoard } from './Leaderboard';
import type { Storm } from './sim';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const PAGES = ['Score', 'Leaderboard', 'Debrief'] as const;
/** The debrief waits this long for the board (it names the player's place), then writes without it. */
const RANK_WAIT_MS = 5000;

/** A room's parts of the results: the election (page 2) and what comes next (last page). */
export interface ResultsRoom {
  standings: ReactNode;
  actions: ReactNode;
  playId: string | null;
  owner: string | null;
  mayor: string;
}

interface DebriefStore {
  text: string | null;
  by: 'gemini' | 'template' | null;
  /** The narrator has read this round's summary once (coming back to the page does not replay it). */
  read: boolean;
  write: (facts: DebriefFacts) => void;
  reset: () => void;
}

let debriefRound = 0;

/** This round's debrief: Gemini's summary, else the template, and its clip loading for the narrator. */
export const useDebrief = create<DebriefStore>((set) => ({
  text: null,
  by: null,
  read: false,
  write: (facts) => {
    const my = ++debriefRound;
    set({ text: null, by: null, read: false });
    void fetchDebrief(facts).then((written) => {
      if (my !== debriefRound) return;
      const text = written ?? templateDebrief(facts);
      set({ text, by: written ? 'gemini' : 'template' });
      void prefetchSpeech([text], 'narrator');
    });
  },
  reset: () => {
    debriefRound++;
    set({ text: null, by: null, read: false });
  },
}));

/** The results' buttons, also for a room's own actions (routes/Play.tsx). */
export const RESULT_BUTTON = {
  primary:
    'border-(length:--rule) border-ink bg-ink px-4 py-2 text-left font-display text-24 leading-tight font-extrabold text-signal hover:bg-bond hover:text-ink',
  secondary: 'border-(length:--rule) border-ink bg-bond px-3 py-2 text-15 font-semibold hover:bg-chalk',
};
const { primary, secondary } = RESULT_BUTTON;

export function ResultsPanel({
  storm,
  result,
  data,
  placements,
  story,
  room,
}: {
  storm: Storm;
  result: ScoreResult | null;
  data: MapData;
  placements: Placement[];
  story: Story;
  room?: ResultsRoom;
}) {
  const reduce = !!useReducedMotion();
  const [page, setPage] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const boardStatus = useBoard((s) => s.status);
  const yourRank = useBoard((s) => s.board?.you?.rank ?? null);
  const players = useBoard((s) => s.board?.players ?? 0);
  const soloPlayId = useBoard((s) => s.playId);
  const reset = usePlan((s) => s.reset);

  // The debrief is written once per round: as soon as the board has the player's place, or after
  // a short wait without it, so it is ready by the time the player reaches the last page.
  const written = useRef(false);
  const mayor = room?.mayor ?? null;
  useEffect(() => {
    useDebrief.getState().reset();
    written.current = false;
  }, [storm]);
  useEffect(() => {
    if (!result || written.current) return;
    const write = () => {
      if (written.current) return;
      written.current = true;
      const rank = yourRank ? { place: yourRank, of: players } : null;
      useDebrief.getState().write(debriefFacts(result, data, story, placements, mayor, rank));
    };
    if (boardStatus === 'ready' || boardStatus === 'offline') return write();
    const id = window.setTimeout(write, RANK_WAIT_MS);
    return () => clearTimeout(id);
  }, [result, boardStatus, yourRank, players, data, story, placements, mayor]);

  const go = (k: number) => {
    if (k === page) return;
    playStamp();
    setPage(k);
    body.current?.scrollTo({ top: 0 });
  };
  const last = page === PAGES.length - 1;

  return (
    <motion.section
      aria-label="Results"
      initial={reduce ? false : { y: '120%' }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className={PLATE + ' pointer-events-auto flex max-h-[calc(100dvh-6rem)] w-full max-w-lg flex-col lg:max-h-[calc(100dvh-7rem)]'}
    >
      <nav aria-label="Results pages" className="flex shrink-0 border-b-(length:--rule) border-ink">
        {PAGES.map((p, k) => (
          <button
            key={p}
            type="button"
            aria-current={page === k ? 'step' : undefined}
            onClick={() => go(k)}
            className={
              'flex-auto px-2 py-2 text-15 font-semibold whitespace-nowrap ' +
              (k > 0 ? 'border-l-(length:--rule) border-ink ' : '') +
              (page === k ? 'bg-ink text-bond' : 'bg-bond text-ink hover:bg-chalk')
            }
          >
            <span className="hidden sm:inline">{k + 1}. </span>
            {p}
            {k === 1 && yourRank ? <span className="tabular"> · #{yourRank}</span> : null}
          </button>
        ))}
      </nav>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            initial={reduce ? false : { x: 18, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? undefined : { x: -18, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {page === 0 && <ScorePage storm={storm} result={result} story={story} />}
            {page === 1 &&
              (room ? (
                <>
                  {room.standings}
                  <div className="mt-4 border-t-(length:--rule) border-ink pt-3">
                    <LeaderboardBody result={result} room />
                  </div>
                </>
              ) : (
                <LeaderboardBody result={result} />
              ))}
            {page === 2 && (
              <DebriefPage
                playId={room ? room.playId : soloPlayId}
                owner={room ? room.owner : playerId()}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t-(length:--rule) border-ink p-3">
        <div className="flex gap-2">
          {page > 0 && (
            <button type="button" onClick={() => go(page - 1)} className={secondary}>
              Back
            </button>
          )}
          {page === 0 && !room && (
            <button type="button" onClick={reset} className={secondary}>
              Play again
            </button>
          )}
          {last && !room && (
            <button type="button" onClick={leaveGame} className={secondary}>
              Main menu
            </button>
          )}
        </div>
        {!last ? (
          <button type="button" onClick={() => go(page + 1)} className={primary} autoFocus={page === 0}>
            Next: {PAGES[page + 1]!.toLowerCase()}
          </button>
        ) : room ? (
          room.actions
        ) : (
          <button type="button" onClick={reset} className={primary} autoFocus>
            Play again
          </button>
        )}
      </div>
    </motion.section>
  );
}

function ScorePage({ storm, result, story }: { storm: Storm; result: ScoreResult | null; story: Story }) {
  const end = storm.timeline[storm.timeline.length - 1];
  const prot = end?.protectedPeople ?? 0;
  const strand = end?.strandedPeople ?? 0;
  const score = result?.score ?? 0;
  const best = result?.bestPossible ?? 0;
  const baseline = result?.baseline.protectedPeople ?? 0;
  const gaps = result ? biggestGaps(result) : [];
  return (
    <div>
      <h2 className="font-display text-32 font-extrabold">{story.passed}</h2>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular font-display text-72 leading-none font-extrabold">{Math.round(score)}</span>
        <span className="text-18 font-semibold">out of 100</span>
      </p>
      {best > 0 && (
        <p className="mt-1 text-15">
          <span className="tabular font-semibold">{Math.round((100 * score) / best)}%</span> of the best plan the data found ({Math.round(best)}).
        </p>
      )}
      <dl className="tabular mt-3 grid grid-cols-2 gap-3 border-t-(length:--rule) border-ink pt-3">
        <div>
          <dt className="text-13">Protected</dt>
          <dd className="font-display text-32 font-extrabold">{fmt(prot)}</dd>
        </div>
        <div>
          <dt className="text-13">Stranded</dt>
          <dd className="font-display text-32 font-extrabold">{fmt(strand)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-15">
        {baseline >= 1
          ? `Existing shelters took ${fmt(baseline)}. Your plan reached ${fmt(Math.max(0, prot - baseline))} of the ${fmt(prot + strand - baseline)} residents they could not.`
          : `Your plan reached ${Math.round(prot + strand > 0 ? (100 * prot) / (prot + strand) : 0)}% of the residents ${story.cause} put at risk.`}
      </p>
      {result && (
        <div className="mt-4 grid gap-2">
          <Meter label="Vulnerable residents protected" pct={result.vulnerable.protectedPct} ink="bg-safe" />
          <Meter label="Everyone protected" pct={result.vulnerable.everyonePct} ink="bg-safe" />
        </div>
      )}
      {gaps.length > 0 && (
        <div className="mt-4 border-t-(length:--rule) border-ink pt-3">
          <h3 className="text-15 font-semibold">Where the plan fell short</h3>
          <ul className="mt-2 grid gap-3">
            {gaps.map((g) => (
              <li key={g.hood}>
                <Meter label={g.hood} pct={g.leftPct} ink="bg-alarm" unit="left exposed" />
                {g.reason && <p className="mt-0.5 text-13">{g.reason.charAt(0).toUpperCase() + g.reason.slice(1)}.</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A flat bar in an ink rule: the share filled in `ink`. */
function Meter({ label, pct, ink, unit = '' }: { label: string; pct: number; ink: string; unit?: string }) {
  const reduce = useReducedMotion();
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-15">
        <span className="truncate font-semibold">{label}</span>
        <span className="tabular shrink-0">
          {Math.round(p)}%{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div className="mt-1 h-3 border-(length:--rule) border-ink bg-bond">
        <motion.div
          className={'h-full ' + ink}
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${p}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 }}
        />
      </div>
    </div>
  );
}

/** The summary, the narrator reading it (once on arrival, again on Listen), and the public record. */
function DebriefPage({ playId, owner }: { playId: string | null; owner: string | null }) {
  const reduce = useReducedMotion();
  const text = useDebrief((s) => s.text);
  const by = useDebrief((s) => s.by);
  const line = useVoice((s) => s.line);
  const speaking = !!text && line === text;
  useEffect(() => {
    if (!text || useDebrief.getState().read) return;
    useDebrief.setState({ read: true });
    void say(text, 'narrator');
  }, [text]);
  useEffect(() => () => hush(), []);

  return (
    <div>
      <h2 className="font-display text-32 font-extrabold">Debrief</h2>
      <p className="text-13 font-semibold">
        {by === 'gemini' ? 'Written by Gemini from the game’s numbers' : by === 'template' ? 'From the game’s numbers' : 'Writing your debrief…'}
      </p>
      {text ? (
        <motion.p initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 text-18 leading-snug">
          {text}
        </motion.p>
      ) : (
        <p className="mt-3 text-18 leading-snug" role="status">
          Reading the storm’s numbers…
        </p>
      )}
      <button
        type="button"
        disabled={!text}
        aria-pressed={speaking}
        onClick={() => (speaking ? hush() : text && void say(text, 'narrator'))}
        className="mt-3 inline-flex items-center gap-2 border-(length:--rule) border-ink bg-bond px-3 py-1.5 text-15 font-semibold shadow-piece hover:bg-chalk disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden className="shrink-0">
          {speaking ? (
            <rect x="5" y="5" width="10" height="10" className="fill-ink" />
          ) : (
            <>
              <path d="M3 7h3l5-4v14l-5-4H3z" className="fill-ink" />
              <path d="M14 6.5a5 5 0 0 1 0 7" className="fill-none stroke-ink" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </svg>
        {speaking ? 'Stop' : 'Listen'}
      </button>
      {playId && <CivicRecord key={playId} playId={playId} owner={owner} />}
    </div>
  );
}
