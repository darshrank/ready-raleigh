import { CardPage } from './routes/Card';
import { Landing } from './routes/Landing';
import { Planner } from './routes/Planner';
import { Play } from './routes/Play';
import { Solo } from './routes/Solo';
import { Verify } from './routes/Verify';
import { Link, matchPath, usePath } from './router';

export function App() {
  const path = usePath();
  let params: Record<string, string> | null;

  if (matchPath('/', path)) return <Landing />;
  if (matchPath('/solo', path)) return <Solo />;
  if (matchPath('/planner', path)) return <Planner />;
  if ((params = matchPath('/card/:id', path))) return <CardPage key={params.id} id={params.id ?? ''} />;
  if ((params = matchPath('/verify/:playId', path))) return <Verify key={params.playId} playId={params.playId ?? ''} />;
  // No central screen: an old /host link opens the room like any player.
  if ((params = matchPath('/host/:code', path))) return <Play key={params.code} code={(params.code ?? '').toUpperCase()} />;
  if ((params = matchPath('/play/:code', path))) return <Play key={params.code} code={(params.code ?? '').toUpperCase()} />;

  return (
    <main className="px-4 py-10">
      <p className="text-18">
        This page does not exist. <Link to="/" className="underline">Go to the start.</Link>
      </p>
    </main>
  );
}
