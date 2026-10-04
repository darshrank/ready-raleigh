// Calls to the game server (proxied under /api by Vite). Every call fails soft: the game works
// without the server, it just does not add to the planners' data.
import type { Placement } from '@shared/types';
import { soloPlan } from './plan/usePlanScore';

const PLAYER_KEY = 'ready-raleigh-player';

/**
 * An anonymous id per browser, so the planner reports count people rather than games. Random, not
 * tied to any name or account.
 */
function playerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

/** Stores a finished solo game (the server scores it again). Never throws. */
export async function saveSoloPlay(placements: Placement[]): Promise<void> {
  try {
    const plan = { ...soloPlan(placements), playerId: playerId() };
    await fetch('/api/plays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Server down or offline: the game goes on.
  }
}
