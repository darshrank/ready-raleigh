import { Landing } from './routes/Landing';
import { Planner } from './routes/Planner';
import { Play } from './routes/Play';
import { Solo } from './routes/Solo';
import { Link, matchPath, usePath } from './router';

export function App() {
  const path = usePath();
  let params: Record<string, string> | null;

  if (matchPath('/', path)) return <Landing />;
  if (matchPath('/solo', path)) return <Solo />;
  if (matchPath('/planner', path)) return <Planner />;
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
