// Calls to the game server (proxied under /api by Vite). Every call fails soft: the game works
// without the server, it just does not add to the planners' data.
import type { NewsFacts, NewsScript } from '@shared/news';
import type { Placement } from '@shared/types';
import { soloPlan } from './plan/usePlanScore';
import { currentCityId } from './story';

const PLAYER_KEY = 'ready-raleigh-player';

/**
 * An anonymous id per browser, so the planner reports count people rather than games. Random, not
 * tied to any name or account.
 */
export function playerId(): string {
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

/** Stores a finished solo game (the server scores it again). Never throws: null when not stored. */
export async function saveSoloPlay(placements: Placement[]): Promise<string | null> {
  try {
    const plan = { ...soloPlan(placements), playerId: playerId(), city: currentCityId() };
    const res = await fetch('/api/plays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? ((await res.json()) as { id: string }).id : null;
  } catch {
    // Server down or offline: the game goes on.
    return null;
  }
}

const aiOn = import.meta.env.VITE_FEATURE_AI !== 'false';

/** The storm's reports written by Gemini (POST /api/news), or null: the desk then reads its templates. */
export async function fetchNews(facts: NewsFacts): Promise<NewsScript | null> {
  if (!aiOn) return null;
  try {
    const res = await fetch('/api/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const script = (await res.json()) as NewsScript;
    return Array.isArray(script?.lines) ? script : null;
  } catch {
    return null;
  }
}
