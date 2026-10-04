import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { DebriefFacts } from '@shared';
import { Gemini, type GenerateClient } from './ai/gemini';
import { debriefProblem, fitDebrief, readDebriefFacts, registerDebrief } from './debrief';

const facts: DebriefFacts = {
  city: 'Raleigh',
  hazard: 'flood',
  mayor: null,
  score: 62,
  bestPossible: 75,
  shareOfBest: 83,
  protectedPeople: 25324,
  strandedPeople: 7717,
  baselineProtected: 4498,
  vulnerablePct: 58,
  everyonePct: 61,
  spent: '$9M',
  budget: '$10M',
  plan: { name: null, shelters: ['Enloe High School (Five Points)'], busPickups: ['Southeast Raleigh'], roads: ['Capital Boulevard'] },
  missed: [{ hood: 'Brentwood', leftPct: 71, reason: 'households with no car and no bus pickup nearby' }],
  rank: { place: 3, of: 27 },
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

const good =
  'You scored 62, 83% of the best plan the data found. Enloe High School (Five Points) and Capital Boulevard kept 25,324 people safe. ' +
  'Brentwood was the gap: households with no car and no bus pickup nearby. Next time, put a bus pickup in Brentwood.';

describe('debrief', () => {
  it('reads and bounds the facts', () => {
    const read = readDebriefFacts({ facts: { ...facts, score: 140, missed: Array(9).fill(facts.missed[0]) } });
    expect(read.score).toBe(100);
    expect(read.missed).toHaveLength(3);
    expect(() => readDebriefFacts({ facts: { ...facts, hazard: 'meteor' } })).toThrow(/hazard/);
    expect(() => readDebriefFacts({})).toThrow(/facts/);
  });

  it('refuses numbers the facts do not hold, and long answers', () => {
    expect(debriefProblem(good, facts)).toBeNull();
    expect(debriefProblem(good.replace('25,324', '30,000'), facts)).toMatch(/30000/);
    expect(debriefProblem('x'.repeat(900), facts)).toBe('too long');
  });

  it('keeps the whole sentences that fit from an answer that runs long', () => {
    const first = 'You scored 62, 83% of the best plan, with a shelter at St. James United Methodist Church (Haithcock Farms).';
    const second = 'Brentwood was the gap: households with no car and no bus pickup nearby.';
    const next = 'Next time, put a bus pickup in Brentwood, near the homes without a car.';
    const long = [first, second, ...Array(6).fill(next)].join(' ');
    expect(long.length).toBeGreaterThan(560);
    expect(fitDebrief(long)).toBe([first, second, ...Array(5).fill(next)].join(' '));
    // A cut never lands after "St.": the sentence holding it stays whole or goes.
    const place = `Open a shelter at St. James United Methodist Church next time, ${'and keep buses running to the homes without a car, '.repeat(10)}so nobody is left.`;
    expect(fitDebrief(['You scored 62.', 'Brentwood was the gap.', place].join(' '))).toBe('You scored 62. Brentwood was the gap.');
    // Nothing to keep: the answer stays as it was, and the check refuses it.
    expect(fitDebrief('x'.repeat(900))).toHaveLength(900);
  });

  it('writes once per game, and says when it cannot', async () => {
    const { g, calls } = gemini({ summary: good });
    const app = Fastify();
    registerDebrief(app, g);
    const post = () => app.inject({ method: 'POST', url: '/api/debrief', payload: { facts } });
    const first = await post();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ text: good, by: 'gemini' });
    await post();
    expect(calls()).toBe(1);

    const bare = gemini({ summary: good.replace('25,324', '25324') });
    const app3 = Fastify();
    registerDebrief(app3, bare.g);
    expect((await app3.inject({ method: 'POST', url: '/api/debrief', payload: { facts } })).json().text).toBe(good);

    const bad = gemini({ summary: 'You scored 99 out of 100, wow, what a stunning plan for the city.' });
    const app2 = Fastify();
    registerDebrief(app2, bad.g);
    expect((await app2.inject({ method: 'POST', url: '/api/debrief', payload: { facts } })).statusCode).toBe(502);

    const off = Fastify();
    registerDebrief(off, new Gemini({ apiKey: '' }));
    expect((await off.inject({ method: 'POST', url: '/api/debrief', payload: { facts } })).statusCode).toBe(503);
  });
});
