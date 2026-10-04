// The results' leaderboard page: the top of the city's all-time board (every player's best plan,
// ranked), then your own row if it is further down. The
// rows read like the room's election results (routes/Play.tsx): rank, name, residents protected,
// score and its share of the best plan the data found, which sits in the list too. The board lives
// on the server (Tiger Data, else memory); without the server the page says so and still sets
// your score against the best plan. Solo plays are saved here first; a room's are saved by the server.
import { useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { create } from 'zustand';
import { BUDGET } from '@shared/config';
import type { Placement, ScoreResult } from '@shared/types';
import { BOARD_TOP, fetchLeaderboard, playerId, playerName, renamePlayer, saveSoloPlay, type BoardEntry, type Leaderboard } from '../api';
import type { CityId } from '../cities';
import { currentStory } from '../story';
import { money } from '../ui/format';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

type Status = 'idle' | 'loading' | 'ready' | 'offline';

/** The game the board is for. `placements` is null for a room (the server saved its plays). */
interface Pending {
  placements: Placement[] | null;
  city: CityId;
  /** Whose row is "you": the browser's id (solo) or the room's player id. */
  asPlayer: string;
  saved: boolean;
}

interface BoardStore {
  status: Status;
  board: Leaderboard | null;
  city: CityId | null;
  /** The solo play's id once the server has it (the public record shows it). */
  playId: string | null;
  /** Solo: save the finished game, then load its city's board. */
  submit: (placements: Placement[], city: CityId) => void;
  /** Rooms: load the board, with this room player's row marked. */
  watch: (city: CityId, asPlayer: string) => void;
  /** After "The leaderboard needs the game server": save (if needed) and load again. */
  retry: () => void;
  /** Change the player's name on every board, then reload this one. */
  rename: (name: string) => Promise<boolean>;
  reset: () => void;
}

/** A newer round (or Play again) makes answers for an older one stale. */
let round = 0;
let pending: Pending | null = null;
/** A busy server (it warms up for a minute after it starts) gets one more try before the page gives up. */
const RETRY_MS = 2500;

export const useBoard = create<BoardStore>((set) => {
  const load = async (my: number, tries: number) => {
    const p = pending;
    if (!p) return;
    set({ status: 'loading', board: null });
    for (let k = 0; k < tries && my === round; k++) {
      if (k > 0) await new Promise((r) => setTimeout(r, RETRY_MS));
      if (p.placements && !p.saved) {
        const id = await saveSoloPlay(p.placements, p.city);
        p.saved = id !== null;
        if (id && my === round) set({ playId: id });
      }
      const board = await fetchLeaderboard(p.city, p.asPlayer);
      if (board) {
        if (my === round) set({ status: 'ready', board });
        return;
      }
    }
    if (my === round) set({ status: 'offline', board: null });
  };
  return {
    status: 'idle',
    board: null,
    city: null,
    playId: null,
    submit: (placements, city) => {
      pending = { placements, city, asPlayer: playerId(), saved: false };
      set({ city, playId: null });
      void load(++round, 2);
    },
    watch: (city, asPlayer) => {
      pending = { placements: null, city, asPlayer, saved: true };
      set({ city, playId: null });
      void load(++round, 2);
    },
    retry: () => void load(++round, 1),
    rename: async (name) => {
      const my = round;
      const ok = await renamePlayer(name);
      const p = pending;
      if (ok && p) {
        const board = await fetchLeaderboard(p.city, p.asPlayer);
        if (board && my === round) set({ board });
      }
      return ok;
    },
    reset: () => {
      round++;
      pending = null;
      set({ status: 'idle', board: null, city: null, playId: null });
    },
  };
});

type Line = { kind: 'player'; entry: BoardEntry } | { kind: 'best'; score: number } | { kind: 'gap'; skipped: number };

/**
 * The top of the board with the best plan where its score falls, then your row when it is lower
 * down, after a gap that stands for the mayors in between.
 */
function lines(top: BoardEntry[], best: number, below: BoardEntry | null): Line[] {
  const out: Line[] = [];
  let placed = best <= 0;
  for (const entry of top) {
    if (!placed && best >= entry.score) {
      out.push({ kind: 'best', score: best });
      placed = true;
    }
    out.push({ kind: 'player', entry });
  }
  if (!placed) out.push({ kind: 'best', score: best });
  if (below) {
    const skipped = below.rank - top.length - 1;
    if (skipped > 0) out.push({ kind: 'gap', skipped });
    out.push({ kind: 'player', entry: below });
  }
  return out;
}

/**
 * The board's page body. `room`: a room's results show the election above, so this is the city's
 * all-time board under a smaller heading, and names come from the lobby (no name form).
 */
export function LeaderboardBody({ result, room = false }: { result: ScoreResult | null; room?: boolean }) {
  const status = useBoard((s) => s.status);
  const board = useBoard((s) => s.board);
  const reduce = !!useReducedMotion();
  const story = currentStory();
  const best = result?.bestPossible ?? 0;
  // No server: your own row, unranked, so the page still compares you with the best plan.
  const offline: BoardEntry | null =
    status === 'offline' && result
      ? { rank: 0, name: room ? 'You' : playerName(), score: result.score, protectedPeople: result.protectedPeople, strandedPeople: result.strandedPeople, spent: 0, at: '', you: true }
      : null;
  const you = board?.you ?? null;
  const top = board ? board.entries.slice(0, BOARD_TOP) : offline ? [offline] : [];
  /** Your row when it is below the top: it follows the list, so you always see your own score. */
  const below = you && !top.some((e) => e.you) ? you : null;

  const headline =
    status === 'loading' || status === 'idle'
      ? 'Counting every mayor’s score…'
      : status === 'offline'
        ? 'The leaderboard needs the game server.'
        : !you
          ? 'Your plan is not on the board yet.'
          : board!.players === 1
            ? `You are the first mayor on the ${story.name} board.`
            : you.rank === 1
              ? `You are the best mayor in ${story.name}!`
              : `You placed ${you.rank} of ${board!.players}${room ? ` in ${story.name}` : ''}.`;

  return (
    <section aria-labelledby="board-title">
      {room ? (
        <h3 id="board-title" className="font-display text-24 font-extrabold">
          All time in {story.name}
        </h3>
      ) : (
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="board-title" className="font-display text-32 font-extrabold">
            Leaderboard
          </h2>
          <span className="truncate text-15 font-semibold">{story.name}</span>
        </div>
      )}
      <p className={'mt-1 font-display leading-tight font-extrabold ' + (room ? 'text-18' : 'text-24')} role="status">
        {headline}
      </p>
      {status === 'offline' && (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-15">Your score is still yours: here it is against the best plan.</p>
          <button
            type="button"
            onClick={() => useBoard.getState().retry()}
            className="border-(length:--rule) border-ink bg-bond px-3 py-1.5 text-15 font-semibold shadow-piece hover:bg-chalk"
          >
            Try again
          </button>
        </div>
      )}

      {(status === 'ready' || status === 'offline') && (
        <ol className="mt-3 flex flex-col gap-1" aria-label={`${story.name} leaderboard`}>
          {lines(top, best, below).map((line, k) => (
            <motion.li
              key={line.kind === 'player' ? `${line.entry.rank}-${line.entry.name}` : line.kind}
              initial={reduce ? false : { x: 16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: reduce ? 0 : 0.1 + k * 0.05 }}
            >
              {line.kind === 'best' ? (
                <BestRow score={line.score} />
              ) : line.kind === 'gap' ? (
                <GapRow skipped={line.skipped} />
              ) : (
                <PlayerRow entry={line.entry} best={best} />
              )}
            </motion.li>
          ))}
        </ol>
      )}

      {status === 'ready' && !room && <NameForm current={you?.name ?? playerName()} />}
      {status === 'ready' && board && (
        <p className="mt-2 text-13">
          {fmt(board.players)} {board.players === 1 ? 'mayor' : 'mayors'}, {fmt(board.plays)} {board.plays === 1 ? 'play' : 'plays'}.{' '}
          {board.store === 'tiger' ? 'All time, saved in Tiger Data.' : 'Kept on this server until it restarts.'}
        </p>
      )}
    </section>
  );
}

const ROW = 'grid grid-cols-[2rem_1fr_auto] items-center gap-2 px-2 py-1.5';

function PlayerRow({ entry, best }: { entry: BoardEntry; best: number }) {
  return (
    <div className={ROW + (entry.you ? ' border-(length:--rule) border-ink bg-signal shadow-piece' : '')}>
      <span className="tabular font-display text-24 leading-none font-extrabold">{entry.rank > 0 ? entry.rank : '–'}</span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          {entry.rank === 1 && <Crown on={entry.you} />}
          <span className="truncate">{entry.you ? `${entry.name} (you)` : entry.name}</span>
        </span>
        <span className="tabular block text-13">
          {fmt(entry.protectedPeople)} protected{entry.spent > 0 ? ` · ${money(entry.spent)}` : ''}
        </span>
      </span>
      <span className="tabular text-right">
        <span className="block font-display text-24 leading-none font-extrabold">{Math.round(entry.score)}</span>
        {best > 0 && <span className="block text-13">{Math.round((100 * entry.score) / best)}% of best</span>}
      </span>
    </div>
  );
}

/** The mayors between the top of the board and you. */
function GapRow({ skipped }: { skipped: number }) {
  return (
    <div className={ROW + ' py-0'}>
      <span aria-hidden className="text-center font-display text-32 leading-none font-extrabold">
        …
      </span>
      <span className="text-13">
        {fmt(skipped)} more {skipped === 1 ? 'mayor' : 'mayors'}
      </span>
    </div>
  );
}

/** The optimizer's plan on the same data and budget: the score to beat, not a player. */
function BestRow({ score }: { score: number }) {
  return (
    <div className={ROW + ' border-(length:--rule) border-dashed border-ink'}>
      <svg width="22" height="22" viewBox="0 0 18 18" aria-hidden className="fill-none stroke-ink" strokeWidth="2">
        <circle cx="9" cy="9" r="6.5" />
        <circle cx="9" cy="9" r="2.2" />
      </svg>
      <span className="min-w-0">
        <span className="block truncate font-semibold">Best plan the data found</span>
        <span className="block text-13">The optimizer, same {money(BUDGET)}</span>
      </span>
      <span className="tabular block text-right font-display text-24 leading-none font-extrabold">{Math.round(score)}</span>
    </div>
  );
}

function Crown({ on }: { on: boolean }) {
  return (
    <svg width="16" height="13" viewBox="0 0 16 13" role="img" aria-label="First place" className="shrink-0">
      <path d="M1 12h14l1-9-4.5 3L8 1 4.5 6 0 3z" className={(on ? 'fill-bond' : 'fill-signal') + ' stroke-ink'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** The name on every board this browser has played on. */
function NameForm({ current }: { current: string }) {
  const rename = useBoard((s) => s.rename);
  const [draft, setDraft] = useState(current);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const clean = draft.replace(/\s+/g, ' ').trim().slice(0, 24);
  const changed = clean.length > 0 && clean !== current;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    setState('saving');
    setState((await rename(clean)) ? 'saved' : 'failed');
  };
  return (
    <form onSubmit={save} className="mt-3 border-t-(length:--rule) border-ink pt-3">
      <label htmlFor="board-name" className="text-13 font-semibold">
        Your name on the board
      </label>
      <div className="mt-1 flex">
        <input
          id="board-name"
          value={draft}
          maxLength={24}
          autoComplete="nickname"
          onChange={(e) => {
            setDraft(e.target.value);
            setState('idle');
          }}
          className="min-w-0 flex-1 border-(length:--rule) border-ink bg-bond px-3 py-1.5 text-15"
        />
        <button
          type="submit"
          disabled={!changed || state === 'saving'}
          className="-ml-(--rule) border-(length:--rule) border-ink bg-ink px-3 py-1.5 text-15 font-semibold text-bond disabled:bg-bond disabled:text-ink/50"
        >
          {state === 'saving' ? 'Saving' : 'Save'}
        </button>
      </div>
      {state === 'saved' && (
        <p className="mt-1 text-13" role="status">
          Saved. Your plays show this name.
        </p>
      )}
      {state === 'failed' && (
        <p className="mt-1 text-13" role="status">
          The name did not save. Try again in a moment.
        </p>
      )}
    </form>
  );
}
