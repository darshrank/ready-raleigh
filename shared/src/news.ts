// The storm's news (POST /api/news): what the app knows about the storm and the plans in it, and the
// reports Gemini writes from it. The app computes every fact; Gemini only phrases them. A report
// that comes back missing, too long or with a number not in the facts is replaced by the template.

/** What one mayor put on the map, by name. */
export interface MayorPlatform {
  /** Null in solo games (the player is "the mayor"). */
  name: string | null;
  /** "Enloe High School (Five Points)". */
  shelters: string[];
  /** Neighborhoods with a bus pickup. */
  busPickups: string[];
  /** Flood roads the plan keeps open. */
  roads: string[];
}

/** One helicopter stop: the moment the anchor reports. */
export interface NewsReportFacts {
  what: 'road' | 'area' | 'cut';
  /** The road or neighborhood. */
  name: string;
  /** "10 PM" on the storm's clock. */
  time: string;
  /** People stranded so far, as each language says it ("About 1,200", "लगभग 1 हज़ार"); null if none. */
  stranded: { en: string; hi: string } | null;
  /** The mayor's protected roads that would have closed by now but stay open. */
  heldRoads: string[];
  /** The mayor's shelters taking people in by now. */
  sheltersOpen: string[];
  /** The template report (what the desk says without Gemini), so the meaning stays right. */
  plain: NewsLine;
}

export interface NewsFacts {
  city: string;
  hazard: 'flood' | 'heat' | 'quake';
  /** The player's own platform. */
  mayor: MayorPlatform;
  /** Rooms: the other candidates' platforms (no scores; the storm has not been counted yet). */
  rivals: MayorPlatform[];
  reports: NewsReportFacts[];
}

export interface NewsLine {
  en: string;
  hi: string;
}

/** One line per report, in order; null where the template should be used. */
export interface NewsScript {
  lines: (NewsLine | null)[];
}

/** Longest line the anchor can read before the next helicopter stop (about 6 s at speed 1.1). */
export const NEWS_MAX_CHARS = { en: 120, hi: 140 } as const;

/** Digit groups in a text, without thousands separators: "About 1,200 at 10 PM" -> ["1200", "10"]. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((n) => n.replace(/,/g, ''));
}
