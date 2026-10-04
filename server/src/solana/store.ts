// Where the civic record lives (P16): anchors (Memo transactions), each play's fingerprint and
// proof, civic signals and contribution cards. Tiger Data when the database is up (tables civic_*,
// one jsonb document per row), else memory. Same interface, like db/store.ts.
import type pg from 'pg';
import type { MerkleProof, PlayFingerprintInput } from '@shared';

export type AnchorKind = 'plays' | 'signal';

export interface Anchor {
  id: string;
  kind: AnchorKind;
  city: string;
  createdAt: string;
  /** Merkle root (plays) or the evidence root (signal). */
  root: string;
  count: number;
  memo: string;
  status: 'pending' | 'confirmed' | 'failed';
  signature: string | null;
  slot: number | null;
  error?: string;
}

export interface PlayProof {
  playId: string;
  /** The player's anonymous id: only used to hand them their own cards. Never on chain. */
  playerId: string;
  input: PlayFingerprintInput;
  fingerprint: string;
  anchorId: string | null;
  proof: MerkleProof | null;
}

export type SignalType = 'new_best' | 'consensus' | 'blind_spot';

export interface Signal {
  id: string;
  city: string;
  mode: string;
  type: SignalType;
  /** Planner target ('site:<id>', 'road:<id>', 'cell:<i>') or 'city' for a city-wide signal. */
  spot: string;
  /** Plain words for the spot: "Enloe High School (Five Points)". */
  label: string;
  state: 'on' | 'off';
  /** Numbers behind it, computed by the server. */
  evidence: Record<string, number | string>;
  /** Plays that produced it (ids; their fingerprints form the evidence root). */
  playIds: string[];
  evidenceRoot: string;
  anchorId: string | null;
  createdAt: string;
}

export type CardKind = 'mayor_elect' | 'blind_spot' | 'consensus' | 'new_best' | 'civic_planner';

export interface Card {
  id: string;
  kind: CardKind;
  playId: string;
  playerId: string;
  city: string;
  createdAt: string;
  /** Words (Gemini, else template). */
  title: string;
  flavour: string;
  why: string;
  /** Facts from code, also the asset's on-chain attributes. */
  attributes: { key: string; value: string }[];
  signalId: string | null;
  art: 'pending' | 'gemini' | 'template';
  /** SHA-256 of the claim code; the code itself is shown once, to the player. */
  claimHash: string;
  status: 'unclaimed' | 'minting' | 'minted';
  asset: string | null;
  owner: string | null;
  mintSignature: string | null;
}

export interface CivicStore {
  readonly kind: 'tiger' | 'memory';
  saveAnchor(a: Anchor): Promise<void>;
  anchors(limit: number): Promise<Anchor[]>;
  anchor(id: string): Promise<Anchor | null>;
  savePlay(p: PlayProof): Promise<void>;
  play(playId: string): Promise<PlayProof | null>;
  /** Plays not anchored yet (after a restart, the next batch picks them up). */
  unanchored(limit: number): Promise<PlayProof[]>;
  saveSignal(s: Signal): Promise<void>;
  signals(limit: number): Promise<Signal[]>;
  saveCard(c: Card): Promise<void>;
  card(id: string): Promise<Card | null>;
  cardsForPlay(playId: string): Promise<Card[]>;
}

const newest = <T extends { createdAt: string }>(xs: Iterable<T>, limit: number) =>
  [...xs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);

export class MemoryCivicStore implements CivicStore {
  readonly kind = 'memory';
  private readonly a = new Map<string, Anchor>();
  private readonly p = new Map<string, PlayProof>();
  private readonly s = new Map<string, Signal>();
  private readonly c = new Map<string, Card>();
  async saveAnchor(x: Anchor) { this.a.set(x.id, structuredClone(x)); }
  async anchors(limit: number) { return newest(this.a.values(), limit).map((x) => structuredClone(x)); }
  async anchor(id: string) { return structuredClone(this.a.get(id) ?? null); }
  async savePlay(x: PlayProof) { this.p.set(x.playId, structuredClone(x)); }
  async play(id: string) { return structuredClone(this.p.get(id) ?? null); }
  async unanchored(limit: number) {
    return [...this.p.values()].filter((x) => !x.anchorId).sort((a, b) => a.input.createdAt.localeCompare(b.input.createdAt)).slice(0, limit).map((x) => structuredClone(x));
  }
  async saveSignal(x: Signal) { this.s.set(x.id, structuredClone(x)); }
  async signals(limit: number) { return newest(this.s.values(), limit).map((x) => structuredClone(x)); }
  async saveCard(x: Card) { this.c.set(x.id, structuredClone(x)); }
  async card(id: string) { return structuredClone(this.c.get(id) ?? null); }
  async cardsForPlay(playId: string) { return [...this.c.values()].filter((x) => x.playId === playId).map((x) => structuredClone(x)); }
}

/** Tiger Data: the civic_* tables in db/schema.sql, one jsonb document per row. */
export class TigerCivicStore implements CivicStore {
  readonly kind = 'tiger';
  constructor(private readonly pool: pg.Pool) {}

  private async put(table: string, id: string, createdAt: string, doc: object, extra: Record<string, string | null> = {}) {
    const cols = ['id', 'created_at', 'doc', ...Object.keys(extra)];
    const vals = [id, createdAt, JSON.stringify(doc), ...Object.values(extra)];
    const sets = cols.slice(2).map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await this.pool.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (id) DO UPDATE SET ${sets}`, vals);
  }
  private async rows<T>(sql: string, args: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<{ doc: T }>(sql, args)).rows.map((r) => r.doc);
  }

  saveAnchor(a: Anchor) { return this.put('civic_anchors', a.id, a.createdAt, a); }
  anchors(limit: number) { return this.rows<Anchor>('SELECT doc FROM civic_anchors ORDER BY created_at DESC LIMIT $1', [limit]); }
  async anchor(id: string) { return (await this.rows<Anchor>('SELECT doc FROM civic_anchors WHERE id = $1', [id]))[0] ?? null; }
  savePlay(p: PlayProof) { return this.put('civic_plays', p.playId, p.input.createdAt, p, { anchor_id: p.anchorId }); }
  async play(id: string) { return (await this.rows<PlayProof>('SELECT doc FROM civic_plays WHERE id = $1', [id]))[0] ?? null; }
  unanchored(limit: number) { return this.rows<PlayProof>('SELECT doc FROM civic_plays WHERE anchor_id IS NULL ORDER BY created_at LIMIT $1', [limit]); }
  saveSignal(s: Signal) { return this.put('civic_signals', s.id, s.createdAt, s); }
  signals(limit: number) { return this.rows<Signal>('SELECT doc FROM civic_signals ORDER BY created_at DESC LIMIT $1', [limit]); }
  saveCard(c: Card) { return this.put('civic_cards', c.id, c.createdAt, c, { play_id: c.playId }); }
  async card(id: string) { return (await this.rows<Card>('SELECT doc FROM civic_cards WHERE id = $1', [id]))[0] ?? null; }
  cardsForPlay(playId: string) { return this.rows<Card>('SELECT doc FROM civic_cards WHERE play_id = $1 ORDER BY created_at', [playId]); }
}
