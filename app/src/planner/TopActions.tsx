// The planner page's top places to act: the ranking from GET /api/planner (the best plan's spots,
// then the next ones with a bigger budget, joined with how often residents picked each), as a
// numbered list in the rail and numbered pegs on the map, drawn with the game's own piece discs.
import { useEffect, useState } from 'react';
import { pieceName, type FloodPiece } from '../plan/pieces';
import { currentCityId } from '../story';
import { type Focus, type SetFocus, focusRow } from './focus';
import type { Peg } from './pegs';

/** How many places the page ranks (pegs and rows). */
export const TOP = 8;
const REFRESH_MS = 15_000;

export interface Spot {
  target: string;
  type: FloodPiece;
  name: string;
  hood: string;
  lon: number;
  lat: number;
  category: 'both' | 'data' | 'crowd';
  dataRank: number | null;
  crowdPicks: number;
  crowdShare: number;
  protectedPeople: number;
  reason: string;
}

export interface Ranking {
  plays: number;
  spots: Spot[];
}

export function usePlannerRanking(): { ranking: Ranking | null; error: boolean } {
  const [state, setState] = useState<{ ranking: Ranking | null; error: boolean }>({ ranking: null, error: false });
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/planner?mode=flood&city=${currentCityId()}`, { signal: AbortSignal.timeout(15_000) })
        .then((r) => (r.ok ? (r.json() as Promise<Ranking>) : Promise.reject(new Error(String(r.status)))))
        .then((ranking) => live && setState({ ranking: { plays: ranking.plays, spots: ranking.spots.slice(0, TOP) }, error: false }))
        .catch(() => live && setState((s) => ({ ranking: s.ranking, error: true })));
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return state;
}

const CATEGORY: Record<Spot['category'], { label: string; chip: string }> = {
  both: { label: 'Residents agree', chip: 'bg-safe' },
  data: { label: 'Residents miss it', chip: 'bg-signal' },
  crowd: { label: "Residents' pick", chip: 'bg-flood text-bond' },
};

/** Numbered pegs: the piece's disc on a white face (green where residents and the data agree). */
export function topPegs(ranking: Ranking | null): Peg[] {
  return (ranking?.spots ?? []).map((s, i) => ({
    key: `top:${i}`, lon: s.lon, lat: s.lat, symbol: s.type, face: s.category === 'both' ? 'safe' : 'bond',
    badge: String(i + 1), label: `${i + 1}. ${s.name}`,
  }));
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function TopActionsPanel({ ranking, error, focus, setFocus }: {
  ranking: Ranking | null;
  error: boolean;
  focus: Focus | null;
  setFocus: SetFocus;
}) {
  if (!ranking) {
    return (
      <section className="grid gap-2">
        <h2 className="text-18 font-semibold">Top places to act</h2>
        <p className="text-15">{error ? 'The planner server is off, so there is no ranking to show.' : 'Ranking the places.'}</p>
      </section>
    );
  }
  return (
    <section className="grid gap-2" aria-labelledby="top-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="top-title" className="text-18 font-semibold">Top places to act</h2>
        <span className="text-13 tabular-nums">{fmt(ranking.plays)} plays</span>
      </div>
      <p className="text-13">The data's best plan, ranked, next to how often residents chose each place. Numbers match the pegs on the map.</p>
      <ol className="grid gap-1.5">
        {ranking.spots.map((s, i) => {
          const c = CATEGORY[s.category];
          return (
            <li
              key={s.target}
              {...focusRow(`top:${i}`, focus, setFocus)}
              title={s.reason}
              className={`grid cursor-pointer grid-cols-[1.75rem_1fr] gap-x-2 border-(length:--rule) border-ink px-2 py-1.5 text-13 ${focus?.key === `top:${i}` ? 'bg-signal' : 'bg-bond'}`}
            >
              <span className="row-span-2 flex h-7 w-7 items-center justify-center bg-ink font-display text-18 font-extrabold text-bond tabular-nums">{i + 1}</span>
              <span className="text-15 leading-snug font-semibold">
                {pieceName(s.type)}: {s.name}
              </span>
              <span className="tabular-nums">
                {s.hood} · {s.type === 'bus_pickup' ? `${fmt(s.protectedPeople)} people with no car` : `${fmt(s.protectedPeople)} people`} ·{' '}
                {s.crowdPicks === 0 ? 'no player picked it' : `${Math.round(100 * s.crowdShare)}% of players`}{' '}
                <span className={`border-(length:--rule) border-ink px-1 font-semibold whitespace-nowrap ${c.chip}`}>{c.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
