// The civic record's API (docs/SOLANA.md). Everything here is public by design: anyone can check
// a play's proof against the memo on Solana without trusting our database.
import type { FastifyInstance } from 'fastify';
import { CLUSTER, explorerAddress, explorerTx } from './chain';
import { type CivicRecord, withExplorer } from './civic';

/** Shown wherever the authority appears: the demo key is not a real government. */
export const AUTHORITY_LABEL = 'Demo authority (simulated), not the City of Raleigh';

export function registerCivic(app: FastifyInstance, civic: CivicRecord) {
  app.get('/api/solana/status', async () => ({
    enabled: civic.enabled,
    cluster: CLUSTER,
    authority: civic.address,
    authorityLabel: AUTHORITY_LABEL,
    explorerUrl: civic.address ? explorerAddress(civic.address) : null,
    store: civic.store.kind,
  }));

  app.get<{ Params: { playId: string } }>('/api/solana/proof/:playId', async (req, reply) => {
    if (!/^[\w-]{1,64}$/.test(req.params.playId)) return reply.code(400).send({ error: 'bad play id' });
    const view = await civic.proof(req.params.playId);
    if (!view) return reply.code(404).send({ error: 'no such play' });
    // The player id stays private: it only matters for handing a player their own cards.
    const { playerId: _private, ...play } = view.play;
    const memoUrl = play.memo?.signature ? explorerTx(play.memo.signature) : null;
    return { enabled: civic.enabled, cluster: CLUSTER, play: { ...play, memo: play.memo ? { ...play.memo, explorerUrl: memoUrl } : null }, anchor: view.anchor };
  });

  // Civic signals, newest first, each with the transaction that published it.
  app.get<{ Querystring: { limit?: string } }>('/api/solana/signals', async (req) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30) || 30));
    const signals = await civic.store.signals(limit);
    const anchors = await Promise.all(signals.map((s) => (s.anchorId ? civic.store.anchor(s.anchorId) : null)));
    return {
      enabled: civic.enabled,
      cluster: CLUSTER,
      signals: signals.map((s, i) => ({ ...s, anchor: anchors[i] ? withExplorer(anchors[i]!) : null })),
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/solana/anchors', async (req) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
    return { enabled: civic.enabled, cluster: CLUSTER, anchors: (await civic.store.anchors(limit)).map(withExplorer) };
  });
}
