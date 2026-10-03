import { useEffect, useState } from 'react';
import type { Cell } from '@shared/types';
import { loadCells } from './data';
import { MapView } from './map/MapView';

export function App() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCells().then(setCells, (e: unknown) => setError(String(e)));
  }, []);

  return (
    <main className="relative h-full w-full">
      <MapView cells={cells} />
      <div className="absolute left-4 top-4 border-[2.5px] border-ink bg-bond px-4 py-3">
        <h1 className="font-display text-[32px] font-extrabold leading-none">Ready Raleigh</h1>
        <p className="mt-1 text-[13px]">
          {error ? `Could not load the map data. ${error}` : (
            <span className="tabular">{cells.length} cells loaded</span>
          )}
        </p>
      </div>
    </main>
  );
}
