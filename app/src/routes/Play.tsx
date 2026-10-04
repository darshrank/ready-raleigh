// A room (P9), Among Us style: anyone can open a lobby ("Host a game") and the others scan its
// QR code or type the code. Every player is a mayoral candidate on their own phone or laptop; the
// host is just the player with the Start and Next election buttons. Gameplay is the solo game.
import { useEffect, useState, type FormEvent } from 'react';
import { CANDIDATES, type CandidateId, type RoomState } from '@shared';
import { CandidateCard, Portrait, seatInk } from '../room/Candidate';
import { Invite } from '../room/Invite';
import { savedPlayer, useRoom, type Room } from '../room/useRoom';
import { Link } from '../router';
import { PLATE } from '../ui/Hud';
import { Solo } from './Solo';

const button = 'border-(length:--rule) border-ink px-4 py-3 font-display text-24 font-extrabold';

export function Play({ code }: { code: string }) {
  const room = useRoom(code);
  const s = room.state;
  const me = s && s.you !== null ? s.players.find((p) => p.seat === s.you) : undefined;
  // Opened from "Host a game": this player creates the room when they join.
  const [hosting] = useState(() => new URLSearchParams(location.search).has('host') && !savedPlayer(code));
  useEffect(() => {
    if (me && location.search) history.replaceState(null, '', location.pathname);
  }, [me]);

  if (s && me && s.phase !== 'lobby') {
    return (
      <Solo
        key={s.round}
        room={{
          code: s.code,
          endsAt: (s.endsAt ?? Date.now()) - room.offset,
          onLock: room.lock,
          stormGo: s.phase === 'results',
          waiting: <Waiting state={s} />,
          footer: <Standing state={s} room={room} />,
        }}
      />
    );
  }

  // A brand-new room does not exist until its host joins, so "not found" is expected then.
  const error = hosting && !me && /not found/.test(room.error ?? '') ? null : room.error;

  return (
    <main className="min-h-full bg-chalk px-4 py-6">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <header className={PLATE + ' flex items-baseline justify-between px-4 py-3'}>
          <Link to="/" className="font-display text-24 font-extrabold">
            Mayday Mayor
          </Link>
          <span className="tabular font-display text-24 font-extrabold tracking-widest">{code}</span>
        </header>
        {error && (
          <p role="alert" className={PLATE + ' bg-alarm px-4 py-3 text-15 font-semibold'}>
            {error}
          </p>
        )}
        {me && s ? (
          <Lobby state={s} room={room} mine={me.candidate} seat={me.seat} name={me.name} />
        ) : s && s.phase !== 'lobby' ? (
          <p className={PLATE + ' px-4 py-6 text-18'}>This election is under way. You can run in the next one: keep this page open.</p>
        ) : s || hosting ? (
          <Join taken={new Set(s?.players.map((p) => p.candidate))} hosting={hosting && !s} onJoin={(n, c) => room.join(n, c, hosting)} />
        ) : (
          <p className={PLATE + ' px-4 py-6 text-18'} role="status">
            {!room.connected ? 'Connecting to the room…' : room.error ? 'Ask the host for the code, or host a game yourself from the start page.' : 'Opening the room…'}
          </p>
        )}
      </div>
    </main>
  );
}

/** Name plus a candidate from the ballot (taken ones are greyed out). */
function Join({ taken, hosting, onJoin }: { taken: Set<CandidateId>; hosting: boolean; onJoin: (name: string, c: CandidateId) => void }) {
  const [name, setName] = useState('');
  const [pick, setPick] = useState<CandidateId | null>(() => CANDIDATES.find((c) => !taken.has(c)) ?? null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && pick) onJoin(name.trim(), pick);
  };
  return (
    <form onSubmit={submit} className={PLATE + ' flex flex-col gap-4 p-4'}>
      <h1 className="font-display text-32 font-extrabold">{hosting ? 'Host a game: run for mayor' : 'Run for mayor'}</h1>
      <label className="flex flex-col gap-1">
        <span className="text-15 font-semibold">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          autoComplete="nickname"
          className="border-(length:--rule) border-ink bg-bond px-3 py-2 text-18"
          placeholder="Name on the ballot"
          required
        />
      </label>
      <fieldset>
        <legend className="text-15 font-semibold">Your candidate</legend>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {CANDIDATES.map((c) => {
            const off = taken.has(c);
            return (
              <button
                key={c}
                type="button"
                disabled={off}
                aria-pressed={pick === c}
                aria-label={off ? 'Taken' : 'Pick this candidate'}
                onClick={() => setPick(c)}
                className={`relative aspect-square ${pick === c ? 'shadow-piece outline-3 outline-signal' : ''} disabled:opacity-35`}
              >
                <Portrait id={c} bg={pick === c ? 'var(--signal)' : 'var(--bond)'} className="h-full w-full" />
              </button>
            );
          })}
        </div>
      </fieldset>
      <button type="submit" disabled={!name.trim() || !pick} className={button + ' bg-ink text-signal disabled:bg-bond disabled:text-ink/50'}>
        {hosting ? 'Open the lobby' : 'Join the ballot'}
      </button>
    </form>
  );
}

/** The lobby, the same on every device: the invite, the ballot, and the host's Start button. */
function Lobby({ state, room, mine, seat, name }: { state: RoomState; room: Room; mine: CandidateId; seat: number; name: string }) {
  const taken = new Set(state.players.map((p) => p.candidate));
  const [changing, setChanging] = useState(false);
  const host = state.players.find((p) => p.seat === state.hostSeat);
  const isHost = state.you === state.hostSeat;
  return (
    <>
      <section className={PLATE + ' p-4'}>
        <Invite code={state.code} />
      </section>
      <section className={PLATE + ' flex flex-col gap-3 p-4'}>
        <h2 className="font-display text-24 font-extrabold">
          On the ballot ({state.players.length})
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {state.players.map((p) => (
            <CandidateCard
              key={p.seat}
              id={p.candidate}
              name={p.name}
              seat={p.seat}
              size="sm"
              dim={!p.connected}
              badge={[p.seat === state.you ? 'You' : null, p.seat === state.hostSeat ? 'Host' : null].filter(Boolean).join(' · ') || 'For mayor'}
            />
          ))}
        </div>
        {isHost ? (
          <button type="button" data-start onClick={room.start} className={button + ' bg-ink text-signal'}>
            Start the election
          </button>
        ) : (
          <p className="text-18" role="status">
            Waiting for {host?.name ?? 'the host'} to start the election.
          </p>
        )}
        <button type="button" onClick={() => setChanging((v) => !v)} className="self-start border-(length:--rule) border-ink bg-bond px-3 py-2 text-15 font-semibold">
          {changing ? 'Done' : `Change ${name}'s candidate`}
        </button>
        {changing && (
          <div className="grid w-full grid-cols-4 gap-2">
            {CANDIDATES.map((c) => (
              <button
                key={c}
                type="button"
                disabled={taken.has(c) && c !== mine}
                aria-pressed={c === mine}
                onClick={() => room.pick(c)}
                className="aspect-square disabled:opacity-35"
              >
                <Portrait id={c} bg={c === mine ? seatInk(seat) : 'var(--bond)'} className="h-full w-full" />
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** After "Start the storm": the storm waits until every candidate is ready. */
function Waiting({ state }: { state: RoomState }) {
  const here = state.players.filter((p) => p.connected || p.locked);
  const ready = here.filter((p) => p.locked).length;
  return (
    <>
      <p className="font-display text-24 font-extrabold">Ready. The storm starts when everyone is.</p>
      <p className="mt-1 text-15">
        {ready} of {here.length} candidates ready
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {here.map((p) => (
          <span key={p.seat} className={`flex items-center gap-2 border-(length:--rule) border-ink px-2 py-1 text-15 ${p.locked ? 'bg-safe' : 'bg-bond'}`}>
            <Portrait id={p.candidate} bg={seatInk(p.seat)} className="aspect-square w-6" />
            {p.name} {p.locked ? '✓' : '…'}
          </span>
        ))}
      </div>
    </>
  );
}

/** Replaces "Play again" on the results card: the election result. */
function Standing({ state, room }: { state: RoomState; room: Room }) {
  if (!state.results) {
    const waiting = state.players.filter((p) => p.connected && !p.locked).length;
    return (
      <p className="mt-4 border-t-(length:--rule) border-ink pt-3 text-15" role="status">
        Your platform is in. {waiting > 0 ? `Waiting for ${waiting} more candidate${waiting === 1 ? '' : 's'}.` : 'Counting the votes…'}
      </p>
    );
  }
  const mine = state.results.find((r) => r.seat === state.you);
  const best = state.bestPossible ?? 0;
  return (
    <div className="mt-4 border-t-(length:--rule) border-ink pt-3">
      <p className="font-display text-24 font-extrabold">
        {mine?.rank === 1 ? 'You are the mayor-elect!' : `You placed ${mine?.rank ?? '?'} of ${state.results.length}.`}
      </p>
      <ol className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto" aria-label="Election results">
        {state.results.map((r) => (
          <li key={r.seat} className={`grid grid-cols-[1.5rem_2rem_1fr_auto] items-center gap-2 ${r.seat === state.you ? 'font-bold' : ''}`}>
            <span className="tabular">{r.rank}</span>
            <Portrait id={r.candidate} bg={seatInk(r.seat)} className="aspect-square w-8" />
            <span className="min-w-0">
              <span className="block truncate">{r.submitted ? r.name : `${r.name} (no plan)`}</span>
              <span className="tabular block text-13 font-normal">{Math.round(r.protectedPeople).toLocaleString('en-US')} protected</span>
            </span>
            <span className="tabular text-right">
              {Math.round(r.score)}
              {best > 0 && <span className="block text-13 font-normal">{Math.round((100 * r.score) / best)}% of best</span>}
            </span>
          </li>
        ))}
      </ol>
      {state.you === state.hostSeat ? (
        <button type="button" onClick={room.again} className="mt-3 w-full border-(length:--rule) border-ink bg-ink px-4 py-3 text-left font-display text-24 font-extrabold text-signal">
          Next election
        </button>
      ) : (
        <p className="mt-2 text-15">Waiting for the host to call the next election.</p>
      )}
    </div>
  );
}
