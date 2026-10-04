// /verify/:playId: anyone can check a play against Solana without trusting our database (P16).
// This browser recomputes the play's fingerprint from its public fields, walks the Merkle proof to
// the root, and reads the memo straight from a Solana devnet RPC node.
import { useEffect, useState } from 'react';
import { playFingerprint, verifyProof } from '@shared/proof';
import { type ProofView, fetchProof } from '../civic/api';
import { Link } from '../router';
import { PLATE } from '../ui/Hud';

const RPC = 'https://api.devnet.solana.com';

type Check = { label: string; ok: boolean | null; detail: string };

/** The memo text of a transaction, read from the chain. */
async function memoOnChain(signature: string): Promise<string | null> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] }),
  });
  const body = (await res.json()) as { result?: { meta?: { logMessages?: string[] } } | null };
  const line = body.result?.meta?.logMessages?.find((l) => l.startsWith('Program log: Memo'));
  return line ? (/: "(.*)"$/.exec(line)?.[1] ?? null) : null;
}

export function Verify({ playId }: { playId: string }) {
  const [view, setView] = useState<ProofView | null | 'missing'>(null);
  const [checks, setChecks] = useState<Check[]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const v = await fetchProof(playId);
      if (!live) return;
      if (!v) return setView('missing');
      setView(v);
      const out: Check[] = [];
      const push = (c: Check) => live && setChecks((cs) => [...cs.filter((x) => x.label !== c.label), c]);
      const print = await playFingerprint(v.play.input);
      out.push({ label: 'Fingerprint', ok: print === v.play.fingerprint, detail: `SHA-256 of the play, recomputed here: ${print.slice(0, 16)}…` });
      out.forEach(push);
      // The play's own memo: its decisions in words, with this fingerprint.
      if (v.play.memo?.signature) {
        push({ label: 'Decisions on Solana', ok: null, detail: 'Reading the decisions from a devnet node…' });
        try {
          const memo = await memoOnChain(v.play.memo.signature);
          push({
            label: 'Decisions on Solana',
            ok: !!memo && memo.includes(print),
            detail: memo ? `Memo on chain: ${memo}` : 'The transaction has no memo.',
          });
        } catch {
          push({ label: 'Decisions on Solana', ok: null, detail: 'Could not reach a devnet node from this browser.' });
        }
      }
      if (!v.anchor || v.anchor.status !== 'confirmed' || !v.play.proof) {
        push({ label: 'On Solana', ok: null, detail: 'Not anchored yet: plays go on Solana in batches. Check back in a few minutes.' });
        return;
      }
      const inTree = await verifyProof(print, v.play.proof, v.anchor.root);
      push({ label: 'In the batch', ok: inTree, detail: `Merkle proof of ${v.play.proof.length} step${v.play.proof.length === 1 ? '' : 's'} to root ${v.anchor.root.slice(0, 16)}… (${v.anchor.count} plays)` });
      push({ label: 'On Solana', ok: null, detail: 'Reading the transaction from a devnet node…' });
      try {
        const memo = await memoOnChain(v.anchor.signature!);
        push({ label: 'On Solana', ok: memo === v.anchor.memo && !!memo?.includes(v.anchor.root), detail: memo ? `Memo on chain: ${memo}` : 'The transaction has no memo.' });
      } catch {
        push({ label: 'On Solana', ok: null, detail: 'Could not reach a devnet node from this browser.' });
      }
    })();
    return () => {
      live = false;
    };
  }, [playId]);

  const v = view && view !== 'missing' ? view : null;
  return (
    <main className="min-h-full bg-chalk px-4 py-6">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <header className={PLATE + ' flex items-baseline justify-between px-4 py-3'}>
          <Link to="/" className="font-display text-24 font-extrabold">
            Mayday Mayor
          </Link>
          <span className="text-15 font-semibold">Verify a play</span>
        </header>
        {view === 'missing' && <p className={PLATE + ' px-4 py-6 text-18'}>No play with this id is on record.</p>}
        {v && (
          <section className={PLATE + ' flex flex-col gap-3 p-4'}>
            <h1 className="font-display text-32 font-extrabold">Is this play on the public record?</h1>
            <p className="text-15">
              Your browser checks it on its own: no trust in our server needed. Play <span className="tabular">{playId.slice(0, 8)}</span>, {v.play.input.mode} mode,
              room {v.play.input.roomCode}, score {Math.round(v.play.input.score)}, {v.play.input.placements.length} pieces, data of {v.play.input.dataBuild.slice(0, 10)}.
            </p>
            <ol className="flex flex-col gap-2">
              {checks.map((c) => (
                <li key={c.label} className={`border-(length:--rule) border-ink px-3 py-2 ${c.ok === true ? 'bg-safe' : c.ok === false ? 'bg-alarm' : 'bg-bond'}`}>
                  <p className="font-display text-24 font-extrabold">
                    {c.ok === true ? '✓' : c.ok === false ? '✗' : '…'} {c.label}
                  </p>
                  <p className="text-13 break-all">{c.detail}</p>
                </li>
              ))}
            </ol>
            <p className="flex flex-wrap gap-x-4 text-15">
              {v.play.memo?.explorerUrl && (
                <a href={v.play.memo.explorerUrl} target="_blank" rel="noreferrer" className="underline">
                  The decisions on Solana Explorer
                </a>
              )}
              {v.anchor?.explorerUrl && (
                <a href={v.anchor.explorerUrl} target="_blank" rel="noreferrer" className="underline">
                  The batch on Solana Explorer
                </a>
              )}
            </p>
            <p className="text-13">Tamper-evident, not a vote count: it proves the play was recorded and has not changed, not who played it.</p>
          </section>
        )}
      </div>
    </main>
  );
}
