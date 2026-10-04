// The civic record (P16, docs/SOLANA.md): every stored play gets a fingerprint, plays are anchored
// on Solana in batches as the root of a Merkle tree, and each play keeps the proof that it is in the
// tree. Pure functions on Web Crypto, so the server builds the trees and any browser can check them.

/** What a play's fingerprint covers. No names: player ids stay off it. */
export interface PlayFingerprintInput {
  playId: string;
  city: string;
  mode: string;
  roomCode: string;
  /** ISO time the server stored the play. */
  createdAt: string;
  /** The data the play was scored on (meta.json buildDate). */
  dataBuild: string;
  placements: { type: string; cell?: number; siteId?: string; roadId?: string; stopId?: string }[];
  score: number;
}

/** One step of a Merkle proof: the sibling hash. Pairs are hashed in sorted order, so no side is needed. */
export type MerkleProof = string[];

/** JSON with object keys sorted at every level, so the same value always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

/** The play's fingerprint: SHA-256 of its canonical JSON (placements keep only what places them). */
export function playFingerprint(p: PlayFingerprintInput): Promise<string> {
  const placements = p.placements.map(({ type, cell, siteId, roadId, stopId }) => ({ type, cell, siteId, roadId, stopId }));
  return sha256Hex(canonicalJson({ ...p, placements, score: Math.round(p.score * 1000) / 1000 }));
}

/** The parent of two nodes: the hash of both, smaller first (so a proof needs no left/right flags). */
async function parent(a: string, b: string): Promise<string> {
  const [x, y] = a < b ? [a, b] : [b, a];
  const both = new Uint8Array(64);
  both.set(unhex(x), 0);
  both.set(unhex(y), 32);
  return sha256Hex(both);
}

/** Every level of the tree, leaves first. An odd node out moves up unchanged. */
async function levels(leaves: string[]): Promise<string[][]> {
  if (leaves.length === 0) throw new Error('a Merkle tree needs at least one leaf');
  const out = [leaves];
  while (out.at(-1)!.length > 1) {
    const level = out.at(-1)!;
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? await parent(level[i]!, level[i + 1]!) : level[i]!);
    out.push(next);
  }
  return out;
}

/** The root over `leaves` (hex SHA-256 fingerprints) and each leaf's proof, in the same order. */
export async function merkleTree(leaves: string[]): Promise<{ root: string; proofs: MerkleProof[] }> {
  const tree = await levels(leaves);
  const proofs = leaves.map((_, leaf) => {
    const proof: string[] = [];
    let i = leaf;
    for (const level of tree.slice(0, -1)) {
      const sibling = i % 2 === 0 ? i + 1 : i - 1;
      if (sibling < level.length) proof.push(level[sibling]!);
      i = Math.floor(i / 2);
    }
    return proof;
  });
  return { root: tree.at(-1)![0]!, proofs };
}

/** Whether `leaf` with `proof` leads to `root`. */
export async function verifyProof(leaf: string, proof: MerkleProof, root: string): Promise<boolean> {
  let node = leaf;
  for (const sibling of proof) node = await parent(node, sibling);
  return node === root;
}

/** The memo written for a batch of plays (docs/SOLANA.md): one Memo transaction per batch. */
export const playsMemo = (city: string, root: string, count: number, dataBuild: string) =>
  `ready-raleigh:v1:plays:${city}:${root}:${count}:${dataBuild}`;

/** The memo written when a civic signal changes state. */
export const signalMemo = (city: string, type: string, spot: string, state: string, evidenceRoot: string) =>
  `ready-raleigh:v1:signal:${city}:${type}:${spot}:${state}:${evidenceRoot}`;

/** The Memo program's limit is 566 bytes; stay under it with room to spare. */
export const MEMO_MAX_BYTES = 560;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * `head | item; item; ...` within `maxBytes` (UTF-8). Items that do not fit are counted ("+2 more");
 * the head always stays whole.
 */
export function fitMemo(head: string, items: string[], maxBytes = MEMO_MAX_BYTES, empty = 'no pieces placed'): string {
  if (items.length === 0) return `${head} | ${empty}`;
  let memo = `${head} |`;
  for (const [i, d] of items.entries()) {
    const rest = items.length - i - 1;
    const next = `${memo}${i ? ';' : ''} ${d}`;
    if (bytes(next + (rest ? `; +${rest} more` : '')) > maxBytes) return `${memo}${i ? ';' : ''} +${items.length - i} more`;
    memo = next;
  }
  return memo;
}

/**
 * One play's own memo: its decisions in words, readable in Solana Explorer, plus the fingerprint
 * that ties them to the play. No names of players.
 *   ready-raleigh:v1:play:raleigh:flood:ABCD:score=58.3:<fingerprint> | Shelter: Enloe High School (Five Points); Protect: Capital Boulevard
 * Decisions that do not fit are counted ("+2 more"); the fingerprint always fits.
 */
export function playMemo(input: Pick<PlayFingerprintInput, 'city' | 'mode' | 'roomCode' | 'score'>, fingerprint: string, decisions: string[]): string {
  return fitMemo(`ready-raleigh:v1:play:${input.city}:${input.mode}:${input.roomCode}:score=${Math.round(input.score * 10) / 10}:${fingerprint}`, decisions);
}

/** The decisions part of a play memo ("Shelter: ...; Protect: ..."), as a list. */
export const memoDecisions = (memo: string): string[] => {
  const tail = memo.slice(memo.indexOf(' | ') + 3);
  return memo.includes(' | ') && tail !== 'no pieces placed' ? tail.split('; ').filter((d) => !/^\+\d+ more$/.test(d)) : [];
};
