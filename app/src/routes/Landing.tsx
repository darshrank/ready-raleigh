import { useState, type FormEvent } from 'react';
import { BUDGET, PLANNING_SECONDS } from '@shared/config';
import { Link, navigate } from '../router';
import { money } from '../ui/format';

// No I or O, so codes read cleanly off a projector.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newRoomCode = () =>
  Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

const button =
  'inline-block border-(length:--rule) border-ink px-4 py-2 text-15 font-semibold';

export function Landing() {
  const [code, setCode] = useState('');
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 4) navigate(`/play/${code}`);
  };

  return (
    <main className="mx-auto max-w-[960px] px-4 py-10 lg:px-10 lg:py-16">
      <h1 className="font-display text-72 font-extrabold lg:text-120">Ready Raleigh</h1>
      <p className="mt-4 max-w-[34em] text-18">
        Plan Raleigh's response to a disaster on real city data. You have {money(BUDGET)} and{' '}
        {PLANNING_SECONDS / 60} minutes. Then the water rises and we see who you reached.
      </p>

      <ol className="mt-10 border-t-(length:--rule) border-ink">
        <li className="grid gap-3 border-b-(length:--rule) border-ink py-5 lg:grid-cols-[200px_1fr_auto] lg:items-center lg:gap-6">
          <h2 className="font-display text-48 font-extrabold">Flood</h2>
          <p className="text-15">
            Water rises in three steps along Raleigh's creeks. Shelters, bus pickups and road
            protection keep people safe.
          </p>
          <Link to="/solo" className={`${button} bg-ink text-bond`}>
            Play solo
          </Link>
        </li>
        <li className="grid gap-3 border-b-(length:--rule) border-ink py-5 lg:grid-cols-[200px_1fr_auto] lg:items-center lg:gap-6">
          <h2 className="font-display text-48 font-extrabold">Heatwave</h2>
          <p className="text-15">
            The hottest blocks in the city on a July afternoon. Cooling centers, trees and water.
          </p>
          <p className="text-15">Not ready yet</p>
        </li>
      </ol>

      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <form onSubmit={join}>
          <label htmlFor="room" className="text-15 font-semibold">
            Join a room
          </label>
          <div className="mt-2 flex">
            <input
              id="room"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              placeholder="Code"
              autoComplete="off"
              inputMode="text"
              className="tabular w-32 border-(length:--rule) border-ink bg-bond px-3 py-2 font-display text-24 font-bold tracking-widest placeholder:text-ink/40"
            />
            <button type="submit" disabled={code.length !== 4} className={`${button} -ml-(--rule) bg-ink text-bond disabled:bg-bond disabled:text-ink/50`}>
              Join
            </button>
          </div>
        </form>
        <div>
          <p className="text-15 font-semibold">Run a room</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={() => navigate(`/play/${newRoomCode()}?host`)} className={`${button} bg-ink text-bond`}>
              Host a game
            </button>
            <Link to="/planner" className={`${button} bg-bond`}>
              Planner view
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
