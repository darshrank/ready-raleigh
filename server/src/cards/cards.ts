// Contribution cards (P16, docs/SOLANA.md): a card is earned for something real (winning a room's
// election, tipping a spot into consensus, covering a blind spot first, a new best plan). It exists
// at once in our store (lazy mint) and is minted as a soulbound Metaplex Core asset when the player
// claims it with a wallet. Code computes every fact; Gemini writes the words and paints the art,
// with templates as the fallback so a card always appears.
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIError, GROUNDED, type Gemini } from '../ai/gemini';
import { fitMemo, memoDecisions, numbersIn } from '@shared';
import type { CivicLog, CivicRecord } from '../solana/civic';
import type { Card, CardKind, Signal } from '../solana/store';
import type { Minter } from './mint';

export const CARD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'cards');
/** Where wallets fetch card metadata and art. */
export const publicBase = () => (process.env.PUBLIC_URL?.trim() || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, '');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newClaimCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** City names for cards (ids as in shared/src/room.ts CITY_IDS). */
const CITY_NAMES: Record<string, string> = { raleigh: 'Raleigh', miami: 'Miami', 'san-francisco': 'San Francisco', 'new-york': 'New York City' };
export const cityName = (id: string) => CITY_NAMES[id] ?? id;

export const CARD_NAMES: Record<CardKind, string> = {
  mayor_elect: 'Mayor-elect',
  consensus: 'Consensus builder',
  blind_spot: 'Blind-spot spotter',
  new_best: 'Record plan',
  civic_planner: 'Civic planner',
};

/** What a card is for, in facts from code (also its on-chain attributes). */
export interface CardFacts {
  kind: CardKind;
  playId: string;
  playerId: string;
  /** The place it is about, if any: "Enloe High School (Five Points)". */
  spot: string | null;
  /** Numbers and short facts, already rounded. */
  facts: Record<string, string | number>;
  signal: Signal | null;
}

type Words = { title: string; flavour: string; why: string };

function templateWords(f: CardFacts): Words {
  const n = (k: string) => String(f.facts[k] ?? '');
  switch (f.kind) {
    case 'mayor_elect':
      return { title: 'Mayor-elect', flavour: 'Won the election with the plan that protected the most people.', why: `Your plan protected ${n('protectedPeople')} people when the storm hit room ${n('room')}.` };
    case 'consensus':
      return { title: 'Consensus builder', flavour: `Residents and the data now agree on ${f.spot}.`, why: `Your plan made ${f.spot} a shared priority, backed by ${n('players')} different players.` };
    case 'blind_spot':
      return { title: 'Blind-spot spotter', flavour: `You covered ${f.spot}, a top priority nobody had picked.`, why: `${f.spot} protects ${n('protectedPeople')} people, yet went unpicked in ${n('plays')} plays.` };
    case 'new_best':
      return { title: 'Record plan', flavour: 'The best plan residents have drawn so far.', why: `Your plan scored ${n('score')}, beating the old best of ${n('previous')}.` };
    default:
      return { title: 'Civic planner', flavour: 'Planned for the storm.', why: 'Your plan is part of the public record.' };
  }
}

const WORDS_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, flavour: { type: 'string' }, why: { type: 'string' } },
  required: ['title', 'flavour', 'why'],
};

const WORDS_SYSTEM = `You write the text of a collectible card in a city-planning game (Mayday Mayor). Residents plan for a disaster in their city; real contributions earn cards that a (simulated) local government recognizes.
- title: 2 to 4 words, punchy, like a trading-card name. At most 28 characters.
- flavour: one witty line, at most 90 characters.
- why: one plain sentence saying what the player did and why it matters for the city, at most 160 characters.
- Never use a person's name.
${GROUNDED}`;

/** Art prompts: Sakhi's printed look (flat spot inks on paper, bold outlines), no text in the image. */
const ART_STYLE = 'Flat screen-print poster, three spot inks only (deep navy ink #1e2a47, signal yellow #ffc628, flood blue #0078bf) plus a touch of hot pink #ff48b0 on off-white paper. Bold ink outlines, halftone shading, playful mid-century civic poster. Square composition. No text, no letters, no numbers, no logos.';
const ART_SUBJECT: Record<CardKind, (f: CardFacts) => string> = {
  mayor_elect: () => 'A jubilant cartoon mayoral candidate in a rain coat with a sash, raising a fist on a flooded city street, rescue boats and a bus behind.',
  consensus: (f) => `A crowd of neighbors raising hands together around a building that becomes a shelter, in ${f.spot ?? 'a city neighborhood'}, under storm clouds.`,
  blind_spot: (f) => `A news helicopter's spotlight revealing a forgotten street in ${f.spot ?? 'a neighborhood'} during a flood, a single bright shelter glowing.`,
  new_best: () => 'A city skyline shaped like a trophy rising above calm flood water, sun breaking through clouds.',
  civic_planner: () => 'A planner\'s hands placing pieces on a printed city map, rain outside the window.',
};

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** The template art: a printed card face in the inks. */
export function templateArt(card: Pick<Card, 'kind' | 'title'>): string {
  const badge: Record<CardKind, string> = {
    mayor_elect: '<path d="M256 150l28 58 64 9-46 45 11 64-57-30-57 30 11-64-46-45 64-9z" fill="#ffc628" stroke="#1e2a47" stroke-width="8" stroke-linejoin="round"/>',
    consensus: '<g fill="#ffc628" stroke="#1e2a47" stroke-width="8"><circle cx="196" cy="220" r="34"/><circle cx="256" cy="200" r="38"/><circle cx="316" cy="220" r="34"/><path d="M146 330c0-40 30-64 110-64s110 24 110 64z"/></g>',
    blind_spot: '<g stroke="#1e2a47" stroke-width="8"><path d="M256 120l-90 220h180z" fill="#ffc628" opacity=".9"/><circle cx="256" cy="120" r="22" fill="#ff48b0"/></g>',
    new_best: '<g stroke="#1e2a47" stroke-width="8" fill="#ffc628"><path d="M186 160h140v50c0 50-30 80-70 80s-70-30-70-80z"/><path d="M226 290h60v40h-60z"/></g>',
    civic_planner: '<g stroke="#1e2a47" stroke-width="8"><rect x="166" y="160" width="180" height="180" fill="#f7f9f8"/><path d="M166 250h180M256 160v180" /><circle cx="300" cy="210" r="18" fill="#ff48b0"/></g>',
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" fill="#f7f9f8"/>
<rect x="24" y="24" width="464" height="464" fill="#0078bf" stroke="#1e2a47" stroke-width="10"/>
<path d="M24 380c60-24 120 24 180 0s120-24 180 0 80 12 104 0v108H24z" fill="#00508a"/>
${badge[card.kind]}
<rect x="24" y="404" width="464" height="84" fill="#1e2a47"/>
<text x="256" y="458" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="34" fill="#ffc628">${escapeXml(card.title.toUpperCase().slice(0, 24))}</text>
</svg>`;
}

/** Why Gemini's words cannot be used, or null. Numbers must come from the facts. */
export function wordsProblem(w: Words, f: CardFacts): string | null {
  if (!w.title?.trim() || !w.flavour?.trim() || !w.why?.trim()) return 'empty';
  if (w.title.length > 32 || w.flavour.length > 110 || w.why.length > 200) return 'too long';
  const known = new Set(numbersIn(JSON.stringify(f)));
  const unknown = numbersIn(`${w.title} ${w.flavour} ${w.why}`).filter((n) => !known.has(n));
  return unknown.length ? `numbers not in the facts: ${unknown.join(', ')}` : null;
}

export interface CardOptions {
  civic: CivicRecord;
  gemini: Gemini;
  log: CivicLog;
  /** Null until SOLANA_CARD_COLLECTION is set (cards still appear; claiming waits). */
  minter: Minter | null;
  /** Generate art with Gemini (off in tests). */
  art?: boolean;
}

export function cardService({ civic, gemini, log, minter, art = true }: CardOptions) {
  const store = civic.store;
  const artPath = (id: string, ext: string) => join(CARD_DIR, `${id}.${ext}`);

  async function words(f: CardFacts, city: string): Promise<Words> {
    if (!gemini.ready()) return templateWords(f);
    try {
      const w = await gemini.json<Words>({
        system: WORDS_SYSTEM,
        // The room code is not a place: it stays out of what Gemini sees.
        prompt: JSON.stringify({ card: CARD_NAMES[f.kind], city: cityName(city), spot: f.spot, facts: Object.fromEntries(Object.entries(f.facts).filter(([k]) => k !== 'room')) }),
        schema: WORDS_SCHEMA,
        temperature: 1,
        timeoutMs: 12_000,
        check: (v) => wordsProblem(v, f),
      });
      return { title: w.title.trim(), flavour: w.flavour.trim(), why: w.why.trim() };
    } catch (err) {
      log.warn({ err: err instanceof AIError ? err.message : err }, 'cards: words fall back to the template');
      return templateWords(f);
    }
  }

  async function paint(card: Card, f: CardFacts) {
    let result: Card['art'] = 'template';
    if (art && gemini.ready()) {
      try {
        const img = await gemini.image({ prompt: `${ART_STYLE}\nSubject: ${ART_SUBJECT[f.kind](f)}`, aspectRatio: '1:1' });
        await mkdir(CARD_DIR, { recursive: true });
        await writeFile(artPath(card.id, img.mimeType === 'image/png' ? 'png' : 'jpg'), img.data);
        result = 'gemini';
      } catch (err) {
        log.warn({ err: err instanceof AIError ? err.message : err }, 'cards: art falls back to the template');
      }
    }
    const latest = (await store.card(card.id)) ?? card;
    await store.saveCard({ ...latest, art: result });
  }

  /** Creates a card now (words first, art in the background). One card per kind per play. */
  async function award(f: CardFacts): Promise<Card | null> {
    const existing = (await store.cardsForPlay(f.playId)).find((c) => c.kind === f.kind);
    if (existing) return existing;
    const proof = await store.play(f.playId);
    const city = proof?.input.city ?? 'raleigh';
    const w = await words(f, city);
    const signalAnchor = f.signal?.anchorId ? await store.anchor(f.signal.anchorId) : null;
    const card: Card = {
      id: randomUUID(), kind: f.kind, playId: f.playId, playerId: f.playerId, city,
      createdAt: new Date().toISOString(), ...w,
      attributes: [
        { key: 'Card', value: CARD_NAMES[f.kind] },
        { key: 'City', value: cityName(city) },
        ...(f.spot ? [{ key: 'Spot', value: f.spot }] : []),
        ...Object.entries(f.facts).filter(([k]) => k !== 'room').map(([key, value]) => ({ key, value: String(value) })),
        ...(proof ? [{ key: 'Play fingerprint', value: proof.fingerprint.slice(0, 16) }, { key: 'Data build', value: proof.input.dataBuild.slice(0, 10) }] : []),
        ...(signalAnchor?.signature ? [{ key: 'Signal tx', value: signalAnchor.signature.slice(0, 20) }] : []),
        { key: 'Authority', value: 'Demo (simulated)' },
      ],
      signalId: f.signal?.id ?? null, art: 'pending', claimCode: newClaimCode(),
      status: 'unclaimed', asset: null, owner: null, mintSignature: null,
    };
    await store.saveCard(card);
    log.info(`cards: ${CARD_NAMES[f.kind]} "${card.title}" for play ${f.playId.slice(0, 8)}`);
    void paint(card, f).catch((err) => log.warn({ err }, 'cards: painting failed'));
    return card;
  }

  /** A signal award (from civic signals) as a card. */
  async function fromSignal(signal: Signal, play: { playId: string; playerId: string }) {
    const kind: CardKind | null = signal.type === 'consensus' ? 'consensus' : signal.type === 'blind_spot' ? 'blind_spot' : signal.type === 'new_best' ? 'new_best' : null;
    if (!kind) return null;
    const ev = signal.evidence;
    const facts: Record<string, string | number> =
      kind === 'new_best' ? { score: ev.score!, previous: ev.previous!, plays: ev.plays! }
        : kind === 'consensus' ? { players: new Set(signal.playIds).size, plays: ev.plays!, protectedPeople: ev.protectedPeople! }
          : { plays: ev.plays!, protectedPeople: ev.protectedPeople!, dataRank: ev.dataRank! };
    return award({ kind, ...play, spot: kind === 'new_best' ? null : signal.label, facts, signal });
  }

  /** The card's art: Gemini's image, or the template SVG. */
  async function image(card: Card): Promise<{ type: string; body: Buffer | string }> {
    if (card.art === 'gemini') {
      for (const [ext, type] of [['jpg', 'image/jpeg'], ['png', 'image/png']] as const) {
        try {
          return { type, body: await readFile(artPath(card.id, ext)) };
        } catch {}
      }
    }
    return { type: 'image/svg+xml', body: templateArt(card) };
  }

  /** Mints the card to `wallet`. Throws ClaimError with an HTTP status. */
  async function claim(id: string, wallet: string, proofOfOwner: { code?: string; owner?: string }): Promise<Card> {
    const card = await store.card(id);
    if (!card) throw new ClaimError(404, 'No such card.');
    const allowed = (proofOfOwner.code && proofOfOwner.code.toUpperCase() === card.claimCode) || (proofOfOwner.owner && proofOfOwner.owner === card.playerId);
    if (!allowed) throw new ClaimError(403, 'That claim code does not match this card.');
    if (card.status === 'minted') return card;
    if (card.status === 'minting') throw new ClaimError(409, 'This card is being minted.');
    if (!minter) throw new ClaimError(503, 'Cards cannot be minted yet (no collection set up).');
    await store.saveCard({ ...card, status: 'minting' });
    // The mint transaction carries the card and the play's decisions in words (a Memo), so Solana
    // Explorer shows them as text right there. The decisions come from the play's own memo.
    const play = await store.play(card.playId);
    const head = `ready-raleigh:v1:card:${CARD_NAMES[card.kind]}:${card.city}:play=${play?.fingerprint.slice(0, 16) ?? card.playId.slice(0, 8)}`;
    const decisions = play?.memo?.text ? memoDecisions(play.memo.text) : [];
    const memo = (maxBytes: number) => fitMemo(head, decisions, maxBytes, 'decisions not on record');
    try {
      const { asset, signature } = await minter.mint({ name: card.title, uri: `${publicBase()}/api/cards/${card.id}/metadata.json`, owner: wallet, attributes: card.attributes, memo });
      const minted: Card = { ...card, status: 'minted', asset, owner: wallet, mintSignature: signature };
      await store.saveCard(minted);
      log.info(`cards: minted "${card.title}" to ${wallet.slice(0, 6)}… (${asset})`);
      return minted;
    } catch (err) {
      await store.saveCard({ ...card, status: 'unclaimed' });
      log.warn({ err: (err as Error).message }, 'cards: mint failed');
      throw new ClaimError(502, 'Minting failed on Solana. Try again in a moment.');
    }
  }

  return { award, fromSignal, image, claim, minter, store };
}

export class ClaimError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type CardService = ReturnType<typeof cardService>;
