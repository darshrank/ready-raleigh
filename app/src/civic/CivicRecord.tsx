// The results card's public-record strip (P16): this play's place in the civic record on Solana
// (recorded, then anchored with a link to the transaction and to /verify), and any contribution
// card it earned, with Claim. Polls while something is still on its way; shows nothing when the
// server has no record of the play.
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { type CivicCard, type ProofView, fetchPlayCards, fetchProof } from './api';

const POLL_MS = 4000;
const POLL_FOR_MS = 6 * 60_000;

/** The card page, with the claim code in the hash so it never reaches a server log. */
export const cardHref = (c: CivicCard) => `/card/${c.id}${c.claimCode ? `#code=${c.claimCode}` : ''}`;

export function CivicRecord({ playId, owner }: { playId: string; owner: string | null }) {
  const [proof, setProof] = useState<ProofView | null>(null);
  const [cards, setCards] = useState<CivicCard[]>([]);
  const reduce = useReducedMotion();

  useEffect(() => {
    let live = true;
    let timer = 0;
    const started = Date.now();
    const until = started + POLL_FOR_MS;
    const poll = async () => {
      const [p, c] = await Promise.all([fetchProof(playId), fetchPlayCards(playId, owner)]);
      if (!live) return;
      if (p) setProof(p);
      if (c) setCards(c.cards);
      // Cards come from the election's end or a signal, within seconds; the anchor can take minutes (solo batches).
      const waiting = (p?.enabled && p.anchor?.status !== 'confirmed') || c?.cards.some((x) => x.art === 'pending') || (!c?.cards.length && Date.now() - started < 60_000);
      if (waiting && Date.now() < until) timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [playId, owner]);

  if (!proof) return null;
  const anchored = proof.anchor?.status === 'confirmed';
  return (
    <section aria-label="Public record" className="mt-3 border-t-(length:--rule) border-ink pt-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-15" role="status">
        <span className="font-semibold">Public record</span>
        {anchored ? (
          <>
            <span>· on Solana ✓</span>
            <a href={proof.anchor!.explorerUrl!} target="_blank" rel="noreferrer" className="underline">
              Transaction
            </a>
            <a href={`/verify/${playId}`} target="_blank" rel="noreferrer" className="underline">
              Verify
            </a>
          </>
        ) : proof.enabled ? (
          <span>· recorded, going on Solana with the next batch</span>
        ) : (
          <span>· recorded</span>
        )}
      </p>
      {cards.map((c) => (
        <motion.a
          key={c.id}
          href={cardHref(c)}
          target="_blank"
          rel="noreferrer"
          initial={reduce ? false : { scale: 0.85, rotate: -3, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          className="mt-2 flex items-center gap-3 border-(length:--rule) border-ink bg-signal p-2 shadow-piece hover:bg-bond"
        >
          <span className="aspect-square w-14 shrink-0 overflow-hidden border-(length:--rule) border-ink bg-flood">
            {c.art !== 'pending' && <img src={c.imageUrl} alt="" className="h-full w-full object-cover" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-13 font-semibold">You earned a card · {c.name}</span>
            <span className="block truncate font-display text-24 leading-tight font-extrabold">{c.title}</span>
          </span>
          <span className="shrink-0 border-(length:--rule) border-ink bg-ink px-2 py-1 font-display text-18 font-extrabold text-signal">
            {c.status === 'minted' ? 'View' : 'Claim'}
          </span>
        </motion.a>
      ))}
    </section>
  );
}
