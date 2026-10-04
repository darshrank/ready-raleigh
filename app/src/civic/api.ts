// The civic record and contribution cards (P16, server/src/solana and server/src/cards). Every call
// fails soft: null when the server or Solana is unavailable, and the game shows nothing extra.
import type { MerkleProof, PlayFingerprintInput } from '@shared/proof';

export interface Anchor {
  id: string;
  kind: 'plays' | 'signal';
  root: string;
  count: number;
  memo: string;
  status: 'pending' | 'confirmed' | 'failed';
  signature: string | null;
  slot: number | null;
  explorerUrl: string | null;
  createdAt: string;
}

export interface ProofView {
  enabled: boolean;
  cluster: string;
  play: {
    playId: string; input: PlayFingerprintInput; fingerprint: string; anchorId: string | null; proof: MerkleProof | null;
    /** The play's own memo: its decisions in words on Solana. */
    memo: { text: string; status: 'confirmed' | 'failed'; signature: string | null; explorerUrl: string | null } | null;
  };
  anchor: Anchor | null;
}

export interface CivicCard {
  id: string;
  kind: string;
  name: string;
  title: string;
  flavour: string;
  why: string;
  attributes: { key: string; value: string }[];
  art: 'pending' | 'gemini' | 'template';
  status: 'unclaimed' | 'minting' | 'minted';
  imageUrl: string;
  assetUrl: string | null;
  mintUrl: string | null;
  owner: string | null;
  /** Only for the card's own player. */
  claimCode?: string;
}

async function get<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const fetchProof = (playId: string) => get<ProofView>(`/api/solana/proof/${encodeURIComponent(playId)}`);
export const fetchStatus = () => get<{ enabled: boolean; authority: string | null; authorityLabel: string; explorerUrl: string | null }>('/api/solana/status');
export const fetchPlayCards = (playId: string, owner?: string | null) =>
  get<{ mintable: boolean; cards: CivicCard[] }>(`/api/cards?play=${encodeURIComponent(playId)}${owner ? `&owner=${encodeURIComponent(owner)}` : ''}`);
export const fetchCard = (id: string) => get<{ mintable: boolean; card: CivicCard }>(`/api/cards/${encodeURIComponent(id)}`);

/** Mints the card to `wallet`. Resolves to the card, or throws with the server's message. */
export async function claimCard(id: string, wallet: string, proof: { code?: string; owner?: string }): Promise<CivicCard> {
  const res = await fetch(`/api/cards/${encodeURIComponent(id)}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, ...proof }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = (await res.json().catch(() => ({}))) as { card?: CivicCard; error?: string };
  if (!res.ok || !body.card) throw new Error(body.error ?? 'The claim did not go through.');
  return body.card;
}

/** Phantom (or another wallet exposing window.solana): connect and return the address, or null. */
export async function connectWallet(): Promise<string | null> {
  const w = window as unknown as { phantom?: { solana?: SolWallet }; solana?: SolWallet };
  const provider = w.phantom?.solana ?? w.solana;
  if (!provider?.connect) return null;
  const { publicKey } = await provider.connect();
  return publicKey.toString();
}
interface SolWallet {
  connect(): Promise<{ publicKey: { toString(): string } }>;
}
export const hasWallet = () => {
  const w = window as unknown as { phantom?: { solana?: unknown }; solana?: unknown };
  return !!(w.phantom?.solana ?? w.solana);
};
