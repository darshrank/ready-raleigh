// Card API (P16). Public: a card's face, art and metadata (what wallets and explorers read).
// Private to the card's player: the claim code (GET with ?owner=<their anonymous id>).
import type { FastifyInstance } from 'fastify';
import { explorerAddress, explorerTx } from '../solana/chain';
import type { Card } from '../solana/store';
import { AUTHORITY_LABEL } from '../solana/routes';
import { CARD_NAMES, ClaimError, type CardService, publicBase, templateArt } from './cards';
import { walletAddress } from './mint';

const ID = /^[\w-]{1,64}$/;

/** What anyone may see of a card. */
export function publicCard(c: Card) {
  const { playerId: _p, claimCode: _c, ...rest } = c;
  return {
    ...rest,
    name: CARD_NAMES[c.kind],
    imageUrl: `/api/cards/${c.id}/image`,
    assetUrl: c.asset ? explorerAddress(c.asset) : null,
    mintUrl: c.mintSignature ? explorerTx(c.mintSignature) : null,
  };
}

export function registerCards(app: FastifyInstance, cards: CardService) {
  app.get('/api/cards/collection.json', async () => ({
    name: 'Mayday Mayor Civic Cards',
    description: `Soulbound cards for real contributions to flood planning in Raleigh, on Solana devnet. Issued by: ${AUTHORITY_LABEL}.`,
    image: `${publicBase()}/api/cards/collection.svg`,
  }));
  app.get('/api/cards/collection.svg', async (_req, reply) =>
    reply.type('image/svg+xml').send(templateArt({ kind: 'mayor_elect', title: 'Civic Cards' })));

  // A play's cards. The card's own player (?owner=) also gets the claim codes.
  app.get<{ Querystring: { play?: string; owner?: string } }>('/api/cards', async (req, reply) => {
    const { play, owner } = req.query;
    if (!play || !ID.test(play)) return reply.code(400).send({ error: 'play is required' });
    const list = await cards.store.cardsForPlay(play);
    return {
      mintable: cards.minter !== null,
      cards: list.map((c) => ({ ...publicCard(c), ...(owner && owner === c.playerId ? { claimCode: c.claimCode } : {}) })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/cards/:id', async (req, reply) => {
    const card = ID.test(req.params.id) ? await cards.store.card(req.params.id) : null;
    if (!card) return reply.code(404).send({ error: 'no such card' });
    return { mintable: cards.minter !== null, card: publicCard(card) };
  });

  app.get<{ Params: { id: string } }>('/api/cards/:id/image', async (req, reply) => {
    const card = ID.test(req.params.id) ? await cards.store.card(req.params.id) : null;
    if (!card) return reply.code(404).send({ error: 'no such card' });
    const { type, body } = await cards.image(card);
    return reply.type(type).header('Cache-Control', card.art === 'pending' ? 'no-store' : 'public, max-age=86400').send(body);
  });

  // Metaplex metadata JSON (the asset's uri).
  app.get<{ Params: { id: string } }>('/api/cards/:id/metadata.json', async (req, reply) => {
    const card = ID.test(req.params.id) ? await cards.store.card(req.params.id) : null;
    if (!card) return reply.code(404).send({ error: 'no such card' });
    return {
      name: card.title,
      description: `${card.flavour} ${card.why} Issued by: ${AUTHORITY_LABEL}. Devnet, no monetary value.`,
      image: `${publicBase()}/api/cards/${card.id}/image`,
      attributes: card.attributes.map(({ key, value }) => ({ trait_type: key, value })),
      properties: { category: 'image', files: [{ uri: `${publicBase()}/api/cards/${card.id}/image`, type: card.art === 'template' ? 'image/svg+xml' : 'image/jpeg' }] },
    };
  });

  // Claim: mint the card to a wallet. Proof of ownership: the claim code, or the player's own id.
  app.post<{ Params: { id: string }; Body: { wallet?: string; code?: string; owner?: string } }>('/api/cards/:id/claim', async (req, reply) => {
    const wallet = walletAddress(req.body?.wallet);
    if (!wallet) return reply.code(400).send({ error: 'That is not a Solana wallet address.' });
    if (!ID.test(req.params.id)) return reply.code(404).send({ error: 'No such card.' });
    try {
      const card = await cards.claim(req.params.id, wallet, { code: req.body?.code?.trim(), owner: req.body?.owner });
      return { card: publicCard(card) };
    } catch (err) {
      if (err instanceof ClaimError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
}
