// The planner page's civic signals (P16): what residents' plans have revealed, each one published on
// Solana when it changed (GET /api/solana/signals). Consensus = residents and the data agree, act
// now; blind spot = a top priority nobody picks, outreach needed; new best = residents beat the
// record. Each links to its transaction, so a planner can cite it.
import { useEffect, useState } from 'react';
import type { MapData } from '../data';
import { currentCityId } from '../story';
import { type Focus, type SetFocus, focusRow, spotPoint } from './focus';
import type { Peg } from './pegs';

const REFRESH_MS = 15_000;
/** Signals listed before "Show all". */
const SHOWN = 3;

interface Signal {
  id: string;
  city: string;
  type: 'consensus' | 'blind_spot' | 'new_best';
  /** Planner target ('site:<id>', ...), or 'city' for a city-wide signal. */
  spot: string;
  label: string;
  state: 'on' | 'off';
  evidence: Record<string, number | string>;
  playIds: string[];
  createdAt: string;
  anchor: { status: string; explorerUrl: string | null } | null;
}

/** The headline and the planner's next step for a signal. */
function describe(s: Signal): { title: string; detail: string; tone: string } {
  const ev = s.evidence;
  const players = new Set(s.playIds).size;
  if (s.type === 'consensus') {
    return s.state === 'on'
      ? { title: `Consensus at ${s.label}`, detail: `Residents and the data agree (${players} plays back it). Act here first.`, tone: 'bg-safe' }
      : { title: `Consensus faded at ${s.label}`, detail: '', tone: 'bg-bond' };
  }
  if (s.type === 'blind_spot') {
    return s.state === 'on'
      ? { title: `Blind spot: ${s.label}`, detail: `A top-${ev.dataRank} priority (${Number(ev.protectedPeople).toLocaleString('en-US')} people) nobody picked in ${ev.plays} plays. Outreach needed.`, tone: 'bg-signal' }
      : { title: `Blind spot covered: ${s.label}`, detail: 'A resident finally planned for it.', tone: 'bg-bond' };
  }
  return { title: `New best plan: ${ev.score}`, detail: `A resident beat the old best of ${ev.previous}.`, tone: 'bg-bond' };
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export interface SignalsState {
  /** One per spot and kind, newest state; null while loading. */
  signals: Signal[] | null;
  /** The server's chain is off. */
  off: boolean;
}

/** The city's civic signals, refreshed every 15 s. */
export function useCivicSignals(city = currentCityId()): SignalsState {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [off, setOff] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/solana/signals?limit=40', { signal: AbortSignal.timeout(10_000) })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: { enabled: boolean; signals: Signal[] }) => {
          if (!live) return;
          // One entry per spot and kind: its latest state (the full history stays on Solana).
          const seen = new Set<string>();
          setSignals(body.signals.filter((s) => {
            const key = `${s.type}|${s.label}`;
            if (s.city !== city || seen.has(key)) return false;
            seen.add(key);
            return true;
          }));
          setOff(!body.enabled);
        })
        .catch(() => live && setSignals((s) => s ?? []));
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [city]);
  return { signals, off };
}

/** Pegs for the signals with a place: green for consensus, pink for a blind spot, grey once over. */
export function signalPegs(data: MapData | null, signals: Signal[] | null): Peg[] {
  if (!data || !signals) return [];
  return signals.flatMap((s): Peg[] => {
    if (s.type === 'new_best') return [];
    const at = spotPoint(data, s.spot);
    if (!at) return [];
    const face = s.state === 'off' ? 'chalk' : s.type === 'consensus' ? 'safe' : 'alarm';
    // Up and left of the place, so a top-place peg on the same spot still shows.
    return [{ key: `signal:${s.id}`, lon: at[0], lat: at[1], symbol: s.type, face, label: s.label, size: 32, offset: [-20, -20] }];
  });
}

export function CivicSignalsPanel({ signals, off, focus, setFocus }: SignalsState & { focus: Focus | null; setFocus: SetFocus }) {
  const [all, setAll] = useState(false);
  return (
    <section className="grid gap-2" aria-labelledby="signals-title">
      <h2 id="signals-title" className="text-18 font-semibold">Civic signals</h2>
      <p className="text-13">
        What residents' plans reveal, published on Solana{off ? ' (the chain is off on this server)' : ''} so anyone can check it. On the map: green
        pegs for consensus, pink for blind spots, grey once over.
      </p>
      {signals === null ? (
        <p className="text-15">Loading signals.</p>
      ) : signals.length === 0 ? (
        <p className="text-15">No signals yet. They appear as residents play: consensus needs three different players behind the same spot.</p>
      ) : (
        <ol className="grid gap-2">
          {(all ? signals : signals.slice(0, SHOWN)).map((s) => {
            const d = describe(s);
            return (
              <li
                key={s.id}
                {...focusRow(`signal:${s.id}`, focus, setFocus)}
                className={`grid cursor-pointer gap-0.5 border-(length:--rule) border-ink px-2 py-1.5 text-13 ${focus?.key === `signal:${s.id}` ? 'bg-signal' : d.tone}`}
              >
                <p className="text-15 font-semibold">{d.title}</p>
                {d.detail && <p>{d.detail}</p>}
                <p className="flex flex-wrap gap-x-3">
                  <span className="tabular-nums">{ago(s.createdAt)}</span>
                  {s.anchor?.explorerUrl ? (
                    <a href={s.anchor.explorerUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                      On Solana ✓
                    </a>
                  ) : (
                    <span>not on chain</span>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      {signals && signals.length > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="justify-self-start text-13 font-semibold underline">
          {all ? 'Show fewer' : `Show all ${signals.length}`}
        </button>
      )}
    </section>
  );
}
