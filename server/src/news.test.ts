import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { NewsFacts } from '@shared';
import { Gemini, type GenerateClient } from './ai/gemini';
import { lineProblem, readFacts, registerNews } from './news';

const facts: NewsFacts = {
  city: 'Raleigh',
  hazard: 'flood',
  mayor: { name: 'Aum', shelters: ['Enloe High School (Five Points)'], busPickups: ['Southeast Raleigh'], roads: ['Capital Boulevard'] },
  rivals: [{ name: 'Priya', shelters: [], busPickups: ['Oakwood', 'Mordecai'], roads: [] }],
  reports: [
    {
      what: 'road', name: 'Wake Forest Road', time: '9 PM', stranded: { en: 'About 1,200', hi: 'लगभग 1 हज़ार' },
      heldRoads: ['Capital Boulevard'], sheltersOpen: ['Enloe High School (Five Points)'],
      plain: { en: 'Wake Forest Road is under water. About 1,200 stranded so far.', hi: 'वेक फ़ॉरेस्ट रोड पानी में डूब गई है।' },
    },
    {
      what: 'cut', name: 'Brentwood', time: '3 AM', stranded: null, heldRoads: [], sheltersOpen: [],
      plain: { en: 'Brentwood is cut off from every hospital. So far, everyone has reached safety.', hi: 'ब्रेंटवुड' },
    },
  ],
};

function gemini(answer: unknown) {
  let calls = 0;
  const client: GenerateClient = {
    models: {
      async generateContent() {
        calls++;
        return { text: JSON.stringify(answer) } as never;
      },
    },
  };
  return { g: new Gemini({ client, textModels: ['m'] }), calls: () => calls };
}

describe('news reports', () => {
  it('reads and bounds the facts, and refuses a body without reports', () => {
    expect(readFacts({ facts }).reports).toHaveLength(2);
    expect(readFacts({ facts: { ...facts, rivals: Array(40).fill(facts.rivals[0]) } }).rivals).toHaveLength(11);
    expect(() => readFacts({ facts: { ...facts, reports: [] } })).toThrow(/reports/);
    expect(() => readFacts({ facts: { ...facts, hazard: 'meteor' } })).toThrow(/hazard/);
  });

  it('only lets numbers through that the facts hold', () => {
    const ok = { en: 'Wake Forest Road goes under; about 1,200 stranded at 9 PM.', hi: 'लगभग 1 हज़ार लोग फँसे।' };
    expect(lineProblem(ok, facts)).toBeNull();
    expect(lineProblem({ ...ok, en: 'About 5,000 stranded.' }, facts)).toMatch(/5000/);
    expect(lineProblem({ ...ok, hi: 'लगभग १२०० लोग' }, facts)).toMatch(/Devanagari/);
    expect(lineProblem({ ...ok, en: 'x'.repeat(121) }, facts)).toBe('too long');
    expect(lineProblem({ ...ok, hi: '' }, facts)).toBe('empty');
  });

  it('POST /api/news returns checked lines, null for a bad one, and writes a storm once', async () => {
    const { g, calls } = gemini({
      reports: [
        { en: "Wake Forest Road is under water, but Mayor Aum's Capital Boulevard holds. About 1,200 stranded.", hi: 'वेक फ़ॉरेस्ट रोड डूबी, लगभग 1 हज़ार फँसे।' },
        { en: 'Brentwood is cut off; 40,000 people wait.', hi: 'ब्रेंटवुड कट गया।' },
      ],
    });
    const app = Fastify();
    registerNews(app, g);
    const res = await app.inject({ method: 'POST', url: '/api/news', payload: { facts } });
    expect(res.statusCode).toBe(200);
    const { lines } = res.json();
    expect(lines[0].en).toMatch(/Capital Boulevard/);
    expect(lines[1]).toBeNull();
    await app.inject({ method: 'POST', url: '/api/news', payload: { facts } });
    expect(calls()).toBe(1);
    await app.close();
  });

  it('answers 503 without a key and 502 when Gemini fails, so the desk keeps its templates', async () => {
    const off = Fastify();
    registerNews(off, new Gemini({ apiKey: '' }));
    expect((await off.inject({ method: 'POST', url: '/api/news', payload: { facts } })).statusCode).toBe(503);
    const broken = Fastify();
    registerNews(broken, gemini('not an object').g);
    expect((await broken.inject({ method: 'POST', url: '/api/news', payload: { facts } })).statusCode).toBe(502);
    await Promise.all([off.close(), broken.close()]);
  });
});
