// /card/:id: a contribution card (P16), and claiming it. The claim code arrives in the hash
// (#code=...) from the results card, or the player types it on another device. Claiming mints a
// soulbound Metaplex Core asset to the wallet (Phantom, or a pasted address). Devnet only.
import { useEffect, useState, type FormEvent } from 'react';
import { type CivicCard, claimCard, connectWallet, fetchCard, fetchStatus, hasWallet } from '../civic/api';
import { Link } from '../router';
import { PLATE } from '../ui/Hud';

const button = 'border-(length:--rule) border-ink px-4 py-3 text-left font-display text-24 font-extrabold disabled:opacity-50';

export function CardPage({ id }: { id: string }) {
  const [card, setCard] = useState<CivicCard | null>(null);
  const [mintable, setMintable] = useState(false);
  const [missing, setMissing] = useState(false);
  const [authority, setAuthority] = useState<string | null>(null);
  const [code, setCode] = useState(() => new URLSearchParams(location.hash.slice(1)).get('code') ?? '');
  const [wallet, setWallet] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let timer = 0;
    const load = async () => {
      const res = await fetchCard(id);
      if (!live) return;
      if (!res) return setMissing(true);
      setCard(res.card);
      setMintable(res.mintable);
      if (res.card.art === 'pending') timer = window.setTimeout(load, 3000);
    };
    void load();
    void fetchStatus().then((s) => live && setAuthority(s?.authorityLabel ?? null));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id]);

  const claim = async (to: string) => {
    setBusy(true);
    setError(null);
    try {
      setCard(await claimCard(id, to, { code }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const withPhantom = async () => {
    try {
      const address = await connectWallet();
      if (address) {
        setWallet(address);
        await claim(address);
      }
    } catch {
      setError('The wallet did not connect.');
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (wallet.trim()) void claim(wallet.trim());
  };

  if (missing) {
    return (
      <main className="min-h-full bg-chalk px-4 py-10">
        <p className={PLATE + ' mx-auto max-w-md px-4 py-6 text-18'}>
          This card does not exist. <Link to="/" className="underline">Go to the start.</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-full bg-chalk px-4 py-6">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <header className={PLATE + ' flex items-baseline justify-between px-4 py-3'}>
          <Link to="/" className="font-display text-24 font-extrabold">
            Mayday Mayor
          </Link>
          <span className="text-15 font-semibold">Civic card</span>
        </header>
        {card && (
          <article className={PLATE + ' overflow-hidden'}>
            <div className="aspect-square w-full border-b-(length:--rule) border-ink bg-flood">
              {card.art === 'pending' ? (
                <p className="flex h-full items-center justify-center font-display text-24 font-extrabold text-bond" role="status">
                  Printing the art…
                </p>
              ) : (
                <img src={card.imageUrl} alt={`Art for ${card.title}`} className="h-full w-full object-cover" />
              )}
            </div>
            <div className="p-4">
              <p className="text-13 font-semibold">{card.name}</p>
              <h1 className="font-display text-48 leading-none font-extrabold">{card.title}</h1>
              <p className="mt-2 text-18 font-semibold">{card.flavour}</p>
              <p className="mt-1 text-15">{card.why}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t-(length:--rule) border-ink pt-3 text-13">
                {card.attributes.map((a) => (
                  <div key={a.key} className="min-w-0">
                    <dt className="font-semibold">{a.key}</dt>
                    <dd className="tabular truncate">{a.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </article>
        )}

        {card && card.status === 'minted' && (
          <section className={PLATE + ' flex flex-col gap-2 p-4'}>
            <h2 className="font-display text-32 font-extrabold">Claimed ✓</h2>
            <p className="text-15">
              Minted on Solana devnet to <span className="tabular break-all">{card.owner}</span>. It is soulbound: it can never be sold or
              transferred.
            </p>
            <p className="flex gap-3 text-15">
              {card.assetUrl && (
                <a href={card.assetUrl} target="_blank" rel="noreferrer" className="underline">
                  The card on Solana
                </a>
              )}
              {card.mintUrl && (
                <a href={card.mintUrl} target="_blank" rel="noreferrer" className="underline">
                  Mint transaction
                </a>
              )}
            </p>
          </section>
        )}

        {card && card.status !== 'minted' && (
          <section className={PLATE + ' flex flex-col gap-3 p-4'}>
            <h2 className="font-display text-32 font-extrabold">Claim your card</h2>
            {!mintable ? (
              <p className="text-15">Claiming opens soon. Keep your claim code: {code ? <strong className="tabular">{code}</strong> : 'it is on your results card'}.</p>
            ) : (
              <>
                <p className="text-15">It is minted to your wallet on Solana devnet, free and soulbound. No real money is involved.</p>
                <label className="flex flex-col gap-1">
                  <span className="text-15 font-semibold">Claim code</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
                    className="tabular border-(length:--rule) border-ink bg-bond px-3 py-2 text-18 tracking-widest"
                    placeholder="8 letters and digits"
                    autoComplete="off"
                  />
                </label>
                {hasWallet() && (
                  <button type="button" disabled={busy || code.length !== 8} onClick={() => void withPhantom()} className={button + ' bg-ink text-signal'}>
                    {busy ? 'Minting…' : 'Connect wallet and claim'}
                  </button>
                )}
                <form onSubmit={submit} className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-15 font-semibold">{hasWallet() ? 'Or paste a wallet address' : 'Your Solana wallet address'}</span>
                    <input
                      value={wallet}
                      onChange={(e) => setWallet(e.target.value.trim())}
                      className="tabular border-(length:--rule) border-ink bg-bond px-3 py-2 text-15"
                      placeholder="e.g. from Phantom"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <button type="submit" disabled={busy || !wallet || code.length !== 8} className={button + ' bg-bond text-ink hover:bg-chalk'}>
                    {busy ? 'Minting…' : 'Claim to this address'}
                  </button>
                </form>
                {error && (
                  <p role="alert" className="border-(length:--rule) border-ink bg-alarm px-3 py-2 text-15 font-semibold">
                    {error}
                  </p>
                )}
              </>
            )}
          </section>
        )}
        {authority && <p className="text-13">Issued by: {authority}. Devnet only, no monetary value.</p>}
      </div>
    </main>
  );
}
