// The planner page's civic signals (P16): what residents' plans have revealed, each one published on
// Solana when it changed (GET /api/solana/signals). Consensus = residents and the data agree, act
// now; blind spot = a top priority nobody picks, outreach needed; new best = residents beat the
// record. Each links to its transaction, so a planner can cite it.
import { useEffect, useState } from 'react';

const REFRESH_MS = 15_000;

interface Signal {
  id: string;
  city: string;
  type: 'consensus' | 'blind_spot' | 'new_best';
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
      : { title: `Consensus faded at ${s.label}`, detail: 'Fewer recent plans pick it.', tone: 'bg-bond' };
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

export function CivicSignalsPanel({ city = 'raleigh' }: { city?: string }) {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [off, setOff] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/solana/signals?limit=40', { signal: AbortSignal.timeout(10_000) })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: { enabled: boolean; signals: Signal[] }) => {
          if (!live) return;
          setSignals(body.signals.filter((s) => s.city === city));
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

  return (
    <section className="grid gap-2" aria-labelledby="signals-title">
      <h2 id="signals-title" className="text-18 font-semibold">Civic signals</h2>
      <p className="text-13">
        What residents' plans reveal, published on Solana{off ? ' (the chain is off on this server)' : ''} so anyone can check it.
      </p>
      {signals === null ? (
        <p className="text-15">Loading signals.</p>
      ) : signals.length === 0 ? (
        <p className="text-15">No signals yet. They appear as residents play: consensus needs three different players behind the same spot.</p>
      ) : (
        <ol className="grid max-h-80 gap-2 overflow-y-auto pr-1">
          {signals.map((s) => {
            const d = describe(s);
            return (
              <li key={s.id} className={`grid gap-0.5 border-(length:--rule) border-ink px-3 py-2 text-13 ${d.tone}`}>
                <p className="text-15 font-semibold">{d.title}</p>
                <p>{d.detail}</p>
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
    </section>
  );
}
