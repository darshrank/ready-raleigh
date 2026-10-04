// The after-game debrief (POST /api/debrief): what the app knows about a finished game, and the
// short summary Gemini writes from it. The app computes every number (rounded the way the summary
// may say them); Gemini only phrases them, and an answer with a number not in the facts is refused.
import type { MayorPlatform } from './news';

/** A neighborhood the plan left exposed, with the engine's plain-words reason. */
export interface DebriefMiss {
  hood: string;
  /** Share of the neighborhood's at-risk people the plan did not protect, whole percent. */
  leftPct: number;
  reason: string;
}

export interface DebriefFacts {
  city: string;
  hazard: 'flood' | 'heat' | 'quake';
  /** Rooms: the candidate's name. Null in a solo game ("you"). */
  mayor: string | null;
  /** 0-100, whole points. */
  score: number;
  /** The best plan the data found on the same budget, whole points. */
  bestPossible: number;
  /** score / bestPossible, whole percent. */
  shareOfBest: number;
  protectedPeople: number;
  strandedPeople: number;
  /** People the existing shelters already protect without the plan (0 when the city has none). */
  baselineProtected: number;
  /** Vulnerable residents (65 and over, low income, no car) protected, and everyone, whole percent. */
  vulnerablePct: number;
  everyonePct: number;
  /** "$9M" spent of "$10M". */
  spent: string;
  budget: string;
  plan: MayorPlatform;
  /** The biggest gaps, worst first (at most 3). */
  missed: DebriefMiss[];
  /** Place on the city's leaderboard when it is known. */
  rank: { place: number; of: number } | null;
}

/** Longest debrief: read aloud in about 35 seconds, and short enough for one ElevenLabs clip. */
export const DEBRIEF_MAX_CHARS = 560;
