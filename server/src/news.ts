// POST /api/news: the storm's news reports, in loud cable-news style (it is a game), written by
// Gemini from the facts the app computed (shared/src/news.ts). Each report is checked: it must fit its slot, and every number in it must
// be one the facts hold. A report that fails is sent as null and the app reads its template.
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  NEWS_MAX_CHARS, numbersIn, type MayorPlatform, type NewsFacts, type NewsLine, type NewsReportFacts, type NewsScript,
} from '@shared';
import { AIError, GROUNDED, gemini as defaultGemini, type Gemini } from './ai/gemini';

const MAX_REPORTS = 6;
const MAX_RIVALS = 11;
const MAX_LIST = 12;
const CACHE_SIZE = 300;

const SYSTEM = `You are the head writer of a loud, over-the-top 24-hour TV news channel in a city-planning GAME. Candidates for mayor each drew up a plan (shelters, bus pickups, protected roads) before the disaster hit; now it is happening live and your anchor is LOVING the drama. You get the facts of each moment the news helicopter reaches, and the plans.
Write one live report per moment, in English (en) and in Hindi (hi, Devanagari script, the punchy style of a Hindi news channel; keep place and person names in Latin letters).
- Sensational and fun: breaking-news hype, dramatic hooks ("Breaking!", "Unbelievable scenes", "Jaw-dropping"), puns, playful jabs at the candidates' bets, cheeky praise when a plan pays off. Think cable news meets sports commentary. Keep it light: tease the candidates, never mock the residents who are stranded.
- Vary the openings and the gags; never start two reports the same way.
- Each report must say what happens at that moment (the "plain" line is the meaning; keep it, reword it) and how many are stranded, using the stranded text exactly as given, or that everyone is safe so far when stranded is null.
- Then tie it to the plans: a road the mayor kept open, a shelter of theirs taking people in, a gap in their plan, or, when there are rivals, what a rival candidate bet on instead. Always name the specific place or road from the plan, never "other shelters" or "elsewhere". Name the candidate when they have a name ("candidate Priya"); otherwise say "the mayor". Spread this across the reports; do not repeat the same plan fact.
- A rival with an empty plan put nothing on the map: roast them for it, gently.
- Do not call the election: the votes are not counted yet. Hype the race instead.
- Everyone is still a candidate: say "candidate Aum", never "Mayor Aum". In a solo game (the mayor has no name) say "the mayor".
- The tone, for example (made-up facts, do not reuse them):
  "Breaking! Oak Street is GONE under water, about 900 stranded! Candidate Lee's Pine Avenue gamble? Still standing!"
  "Unbelievable scenes in Midtown, cut off from every hospital! Candidate Ravi spent big on Elm Road, and it is not paying off!"
  "Candidate Mo put NOTHING on the map, folks. Nothing! Meanwhile Riverside floods, about 2,000 stranded."
  "ब्रेकिंग! Oak Street पानी में ग़ायब, लगभग 900 लोग फँसे! लेकिन candidate Lee का Pine Avenue वाला दांव अब भी टिका है!"
- At most ${NEWS_MAX_CHARS.en} characters in English and ${NEWS_MAX_CHARS.hi} in Hindi per report: it is read aloud in about six seconds. One or two short sentences. Exclamation marks welcome; no lists, emoji, hashtags or abbreviations.
${GROUNDED}`;

const SCHEMA = {
  type: 'object',
  properties: {
    reports: {
      type: 'array',
      items: {
        type: 'object',
        properties: { en: { type: 'string' }, hi: { type: 'string' } },
        required: ['en', 'hi'],
      },
    },
  },
  required: ['reports'],
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_LIST).map((x) => str(x)).filter(Boolean) : []);
const line = (v: unknown): NewsLine => (isObj(v) ? { en: str(v.en, 200), hi: str(v.hi, 240) } : { en: '', hi: '' });

export class BadNews extends Error {}

function readPlatform(v: unknown): MayorPlatform {
  const p = isObj(v) ? v : {};
  return { name: str(p.name, 40) || null, shelters: strs(p.shelters), busPickups: strs(p.busPickups), roads: strs(p.roads) };
}

/** The facts from a request body, trimmed and bounded. Throws BadNews. */
export function readFacts(body: unknown): NewsFacts {
  const f = isObj(body) && isObj(body.facts) ? body.facts : null;
  if (!f) throw new BadNews('body needs facts');
  const hazard = f.hazard === 'heat' || f.hazard === 'quake' ? f.hazard : f.hazard === 'flood' ? 'flood' : null;
  if (!hazard) throw new BadNews('facts.hazard must be flood, heat or quake');
  if (!Array.isArray(f.reports) || f.reports.length === 0) throw new BadNews('facts.reports must be a non-empty array');
  const reports: NewsReportFacts[] = f.reports.slice(0, MAX_REPORTS).map((r) => {
    const x = isObj(r) ? r : {};
    const what = x.what === 'road' || x.what === 'cut' ? x.what : 'area';
    const stranded = isObj(x.stranded) ? { en: str(x.stranded.en, 30), hi: str(x.stranded.hi, 30) } : null;
    return {
      what, name: str(x.name), time: str(x.time, 12), stranded,
      heldRoads: strs(x.heldRoads), sheltersOpen: strs(x.sheltersOpen), plain: line(x.plain),
    };
  });
  return {
    city: str(f.city, 40),
    hazard,
    mayor: readPlatform(f.mayor),
    rivals: (Array.isArray(f.rivals) ? f.rivals : []).slice(0, MAX_RIVALS).map(readPlatform),
    reports,
  };
}

/** Why a written report cannot be used, or null. Numbers must come from the facts. */
export function lineProblem(l: NewsLine, facts: NewsFacts): string | null {
  if (!l.en.trim() || !l.hi.trim()) return 'empty';
  if (l.en.length > NEWS_MAX_CHARS.en || l.hi.length > NEWS_MAX_CHARS.hi) return 'too long';
  if (/[०-९]/.test(l.hi)) return 'Devanagari digits';
  const known = new Set(numbersIn(JSON.stringify(facts)));
  const unknown = [...numbersIn(l.en), ...numbersIn(l.hi)].filter((n) => !known.has(n));
  return unknown.length ? `numbers not in the facts: ${unknown.join(', ')}` : null;
}

export function newsWriter(gemini: Gemini = defaultGemini) {
  const cache = new Map<string, Promise<NewsScript>>();

  async function write(facts: NewsFacts): Promise<NewsScript> {
    const { reports } = await gemini.json<{ reports: NewsLine[] }>({
      system: SYSTEM,
      prompt: JSON.stringify(facts),
      schema: SCHEMA,
      temperature: 1.1,
      timeoutMs: 8000,
      check: (v) => (Array.isArray(v.reports) ? null : 'reports is not an array'),
    });
    return {
      lines: facts.reports.map((_, k) => {
        const l = line(reports[k]);
        return lineProblem(l, facts) ? null : l;
      }),
    };
  }

  /** The script for these facts; the same storm (a replay, a channel switch) is written once. */
  return (facts: NewsFacts): Promise<NewsScript> => {
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

export function registerNews(app: FastifyInstance, gemini: Gemini = defaultGemini) {
  const script = newsWriter(gemini);
  app.post('/api/news', async (req, reply) => {
    if (!gemini.ready()) return reply.code(503).send({ error: 'AI is off: the desk reads its templates' });
    let facts: NewsFacts;
    try {
      facts = readFacts(req.body);
    } catch (err) {
      if (err instanceof BadNews) return reply.code(400).send({ error: err.message });
      throw err;
    }
    try {
      return await script(facts);
    } catch (err) {
      if (!(err instanceof AIError)) throw err;
      req.log.warn({ err: err.message }, 'news not written; the desk reads its templates');
      return reply.code(502).send({ error: 'news not written' });
    }
  });
}
