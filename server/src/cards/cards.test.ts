import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../app';
import { Gemini } from '../ai/gemini';
import { civicRecord } from '../solana/civic';
import { MemoryCivicStore } from '../solana/store';
import type { Minter, MintRequest } from './mint';
import { wordsProblem } from './cards';

const minted: MintRequest[] = [];
const minter: Minter = {
  collection: 'Collection1111',
  async mint(req) {
    minted.push(req);
    return { asset: 'Asset1111', signature: 'MintSig' };
  },
};
const civic = civicRecord({ store: new MemoryCivicStore(), chain: null, dataBuild: () => 'fixture', log: { info: () => {}, warn: () => {} } });
const app = buildServer({ civic, minter, gemini: new Gemini({ apiKey: '' }), cardArt: false });
afterAll(() => app.close());

const WALLET = 'Hx7YqmDd9GQb5w3mY8tKqjzBcd6jCwJ4uE2r1xkVfP9a';

async function makeCard() {
  // The award path the room uses for its winner (template words: Gemini is off here).
  const { cardService } = await import('./cards');
  const cards = cardService({ civic, gemini: new Gemini({ apiKey: '' }), log: { info: () => {}, warn: () => {} }, minter, art: false });
  return cards.award({ kind: 'mayor_elect', playId: 'p1', playerId: 'secret-player', spot: null, signal: null, facts: { protectedPeople: 1234, score: 61.5, candidates: 3, room: 'ABCD' } });
}

describe('contribution cards', () => {
  it('awards a card with template words and facts as attributes, once per kind per play', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/cards?play=p1' })).json().cards).toEqual([]);
    const card = (await makeCard())!;
    expect(card).toMatchObject({ kind: 'mayor_elect', title: 'Mayor-elect', status: 'unclaimed' });
    expect(card.why).toContain('1234');
    expect(card.attributes).toContainEqual({ key: 'protectedPeople', value: '1234' });
    expect(card.attributes.map((a) => a.key)).not.toContain('room');
    expect((await makeCard())!.id).toBe(card.id);
  });

  it('shows the claim code only to the card\'s own player', async () => {
    const pub = (await app.inject({ method: 'GET', url: '/api/cards?play=p1' })).json();
    expect(pub.cards[0].claimCode).toBeUndefined();
    expect(pub.cards[0].playerId).toBeUndefined();
    const mine = (await app.inject({ method: 'GET', url: '/api/cards?play=p1&owner=secret-player' })).json();
    expect(mine.cards[0].claimCode).toMatch(/^[A-Z2-9]{8}$/);
  });

  it('serves template art and Metaplex metadata', async () => {
    const id = (await app.inject({ method: 'GET', url: '/api/cards?play=p1' })).json().cards[0].id;
    const img = await app.inject({ method: 'GET', url: `/api/cards/${id}/image` });
    expect(img.headers['content-type']).toMatch(/svg/);
    const meta = (await app.inject({ method: 'GET', url: `/api/cards/${id}/metadata.json` })).json();
    expect(meta).toMatchObject({ name: 'Mayor-elect' });
    expect(meta.description).toMatch(/Demo authority \(simulated\)/);
  });

  it('mints only with the right claim code and a real wallet address, then stays minted', async () => {
    const mine = (await app.inject({ method: 'GET', url: '/api/cards?play=p1&owner=secret-player' })).json().cards[0];
    const claim = (body: object) => app.inject({ method: 'POST', url: `/api/cards/${mine.id}/claim`, payload: body });
    expect((await claim({ wallet: 'not-a-wallet', code: mine.claimCode })).statusCode).toBe(400);
    expect((await claim({ wallet: WALLET, code: 'WRONG123' })).statusCode).toBe(403);
    const ok = await claim({ wallet: WALLET, code: mine.claimCode.toLowerCase() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().card).toMatchObject({ status: 'minted', asset: 'Asset1111', owner: WALLET });
    expect(minted).toHaveLength(1);
    expect(minted[0]!.uri).toMatch(new RegExp(`/api/cards/${mine.id}/metadata.json$`));
    // The mint transaction carries a readable memo; this play has no decisions memo on record.
    expect(minted[0]!.memo!(560)).toBe('ready-raleigh:v1:card:Mayor-elect:raleigh:play=p1 | decisions not on record');
    await claim({ wallet: WALLET, owner: 'secret-player' });
    expect(minted).toHaveLength(1); // already minted: no second asset
  });

  it('refuses Gemini words with numbers not in the facts', () => {
    const facts = { kind: 'mayor_elect' as const, playId: 'p', playerId: 'x', spot: null, signal: null, facts: { protectedPeople: 1234 } };
    expect(wordsProblem({ title: 'Flood Boss', flavour: 'Kept 1,234 dry.', why: 'Protected 1234 people.' }, facts)).toBeNull();
    expect(wordsProblem({ title: 'Flood Boss', flavour: 'Kept 9,999 dry.', why: 'x' }, facts)).toMatch(/9999/);
  });
});
