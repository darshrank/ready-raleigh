// POST /api/debrief: the after-game summary, written by Gemini from the facts the app computed
// (shared/src/debrief.ts), read aloud on the results' last page (ElevenLabs, POST /api/tts). The
// answer is checked: short enough to read in one clip, and every number in it one the facts hold.
// Anything else is refused and the app shows its template summary instead.
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { DEBRIEF_MAX_CHARS, numbersIn, type DebriefFacts, type DebriefMiss, type MayorPlatform } from '@shared';
import { AIError, GROUNDED, gemini as defaultGemini, type Gemini } from './ai/gemini';

const CACHE_SIZE = 300;
const MAX_LIST = 12;

const SYSTEM = `You are the city's emergency management coach. A player of a city-planning GAME just watched a disaster test their plan (shelters, bus pickups, protected roads, bought with a fixed budget). Write their debrief: what the engine says happened, in plain, direct words.
- Three or four short sentences, about 420 characters and never more than ${DEBRIEF_MAX_CHARS}, read aloud by a narrator: no lists, headings, emoji or abbreviations.
- Say how the plan did (the score, and how close it came to the best plan the data found), what worked (name pieces of the plan by name), the biggest gap (the neighborhood and its reason, as given), and one concrete thing to try next time, using only places and pieces in the facts.
- Talk to the player as "you". When mayor is null (a solo game), you may open with "Mayor," and never say "candidate". In a room, call them by the candidate name once ("Candidate Priya, ..."). Be warm, specific and honest; never mock the residents who were stranded.
- Use the facts' numbers only: counts of people with thousands separators ("23,225"), percentages as "64%".
${GROUNDED}`;

/** "23225 people" -> "23,225 people", for the page and the narrator (only whole counts reach here). */
const withCommas = (text: string) => text.replace(/\b\d{4,}\b/g, (n) => Number(n).toLocaleString('en-US'));

/** Place names keep their periods: "St. James" does not end a sentence. */
const ABBREVIATION = /\b(St|Dr|Mt|Ft|Ave|Rd|Blvd|Jr|Sr|No)\.$/;

/** An answer over the limit keeps its first whole sentences that fit, if that leaves two or more. */
export function fitDebrief(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= DEBRIEF_MAX_CHARS) return clean;
  const sentences: string[] = [];
  for (const piece of clean.split(/(?<=[.!?])\s+(?=[A-Z"“])/)) {
    const last = sentences.length - 1;
    if (last >= 0 && ABBREVIATION.test(sentences[last]!)) sentences[last] += ` ${piece}`;
    else sentences.push(piece);
  }
  let out = '';
  let kept = 0;
  for (const s of sentences) {
    if (`${out} ${s}`.trim().length > DEBRIEF_MAX_CHARS) break;
    out = `${out} ${s}`.trim();
    kept++;
  }
  return kept >= 2 ? out : clean;
}

const SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
};

export class BadDebrief extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_LIST).map((x) => str(x)).filter(Boolean) : []);
/** A whole number in [0, max]. */
const whole = (v: unknown, max = 1e8) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0);

function readPlatform(v: unknown): MayorPlatform {
  const p = isObj(v) ? v : {};
  return { name: str(p.name, 40) || null, shelters: strs(p.shelters), busPickups: strs(p.busPickups), roads: strs(p.roads) };
}

/** The facts from a request body, trimmed and bounded. Throws BadDebrief. */
export function readDebriefFacts(body: unknown): DebriefFacts {
  const f = isObj(body) && isObj(body.facts) ? body.facts : null;
  if (!f) throw new BadDebrief('body needs facts');
  const hazard = f.hazard === 'heat' || f.hazard === 'quake' ? f.hazard : f.hazard === 'flood' ? 'flood' : null;
  if (!hazard) throw new BadDebrief('facts.hazard must be flood, heat or quake');
  const city = str(f.city, 40);
  if (!city) throw new BadDebrief('facts.city is required');
  const missed: DebriefMiss[] = (Array.isArray(f.missed) ? f.missed : []).slice(0, 3).flatMap((m) => {
    const x = isObj(m) ? m : {};
    const hood = str(x.hood);
    return hood ? [{ hood, leftPct: whole(x.leftPct, 100), reason: str(x.reason, 160) }] : [];
  });
  const rank = isObj(f.rank) && whole(f.rank.place) > 0 ? { place: whole(f.rank.place), of: Math.max(whole(f.rank.of), whole(f.rank.place)) } : null;
  return {
    city,
    hazard,
    mayor: str(f.mayor, 40) || null,
    score: whole(f.score, 100),
    bestPossible: whole(f.bestPossible, 100),
    shareOfBest: whole(f.shareOfBest, 1000),
    protectedPeople: whole(f.protectedPeople),
    strandedPeople: whole(f.strandedPeople),
    baselineProtected: whole(f.baselineProtected),
    vulnerablePct: whole(f.vulnerablePct, 100),
    everyonePct: whole(f.everyonePct, 100),
    spent: str(f.spent, 12),
    budget: str(f.budget, 12),
    plan: readPlatform(f.plan),
    missed,
    rank,
  };
}

/** Why a written debrief cannot be used, or null. Numbers must come from the facts. */
export function debriefProblem(text: string, facts: DebriefFacts): string | null {
  if (text.trim().length < 40) return 'too short';
  if (text.length > DEBRIEF_MAX_CHARS) return 'too long';
  const known = new Set(numbersIn(JSON.stringify(facts)));
  const unknown = numbersIn(text).filter((n) => !known.has(n));
  return unknown.length ? `numbers not in the facts: ${unknown.join(', ')}` : null;
}

export function debriefWriter(gemini: Gemini = defaultGemini) {
  const cache = new Map<string, Promise<string>>();

  async function write(facts: DebriefFacts): Promise<string> {
    const { summary } = await gemini.json<{ summary: string }>({
      system: SYSTEM,
      prompt: JSON.stringify(facts),
      schema: SCHEMA,
      temperature: 0.8,
      timeoutMs: 12_000,
      check: (v) => (typeof v.summary === 'string' ? debriefProblem(fitDebrief(v.summary), facts) : 'summary is not text'),
    });
    return withCommas(fitDebrief(summary));
  }

  /** The summary for these facts; the same game (a replay of the page) is written once. */
  return (facts: DebriefFacts): Promise<string> => {
    const key = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
    let p = cache.get(key);
    if (!p) {
      p = write(facts);
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    return p;
  };
}

export function registerDebrief(app: FastifyInstance, gemini: Gemini = defaultGemini) {
  const summary = debriefWriter(gemini);
  app.post('/api/debrief', async (req, reply) => {
    if (!gemini.ready()) return reply.code(503).send({ error: 'AI is off: the results show the template debrief' });
    let facts: DebriefFacts;
    try {
      facts = readDebriefFacts(req.body);
    } catch (err) {
      if (err instanceof BadDebrief) return reply.code(400).send({ error: err.message });
      throw err;
    }
    try {
      return { text: await summary(facts), by: 'gemini' };
    } catch (err) {
      if (!(err instanceof AIError)) throw err;
      req.log.warn({ err: err.message }, 'debrief not written; the results show the template');
      return reply.code(502).send({ error: 'debrief not written' });
    }
  });
}
