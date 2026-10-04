import { describe, expect, it } from 'vitest';
import { canonicalJson, merkleTree, playFingerprint, sha256Hex, verifyProof, type PlayFingerprintInput } from './proof';

const play: PlayFingerprintInput = {
  playId: '0b5c', city: 'raleigh', mode: 'flood', roomCode: 'SOLO', createdAt: '2026-10-04T05:00:00.000Z',
  dataBuild: '2026-10-03', placements: [{ type: 'shelter', siteId: 's1' }, { type: 'bus_pickup', cell: 12 }], score: 61.23456,
};

describe('civic proofs', () => {
  it('writes canonical JSON with sorted keys and no undefined fields', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: undefined }], c: 'z' } })).toBe('{"a":{"c":"z","d":[2,{"y":1}]},"b":1}');
  });

  it('hashes SHA-256 like everyone else', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('gives a play the same fingerprint whatever the key order or extra placement fields', async () => {
    const shuffled = { ...play, placements: [{ siteId: 's1', type: 'shelter', id: 'p1' } as never, { cell: 12, type: 'bus_pickup' }] };
    expect(await playFingerprint(shuffled)).toBe(await playFingerprint(play));
    expect(await playFingerprint({ ...play, score: 61 })).not.toBe(await playFingerprint(play));
  });

  it('proves every leaf into the root, for odd and even trees, and refuses a tampered leaf', async () => {
    for (const n of [1, 2, 3, 5, 8, 13]) {
      const leaves = await Promise.all(Array.from({ length: n }, (_, i) => sha256Hex(`play ${i}`)));
      const { root, proofs } = await merkleTree(leaves);
      for (let i = 0; i < n; i++) expect(await verifyProof(leaves[i]!, proofs[i]!, root)).toBe(true);
      if (n > 1) expect(await verifyProof(await sha256Hex('forged'), proofs[0]!, root)).toBe(false);
    }
  });

  it('has a one-leaf tree whose root is the leaf', async () => {
    const leaf = await sha256Hex('only');
    expect(await merkleTree([leaf])).toEqual({ root: leaf, proofs: [[]] });
  });
});

describe('play memo', () => {
  it('writes decisions in words after the fingerprint and stays under the memo limit', async () => {
    const { playMemo, MEMO_MAX_BYTES } = await import('./proof');
    const fp = 'a'.repeat(64);
    const memo = playMemo({ city: 'raleigh', mode: 'flood', roomCode: 'ABCD', score: 58.34 }, fp, ['Shelter: Enloe High School (Five Points)', 'Protect: Capital Boulevard']);
    expect(memo).toBe(`ready-raleigh:v1:play:raleigh:flood:ABCD:score=58.3:${fp} | Shelter: Enloe High School (Five Points); Protect: Capital Boulevard`);
    const long = playMemo({ city: 'raleigh', mode: 'flood', roomCode: 'ABCD', score: 1 }, fp, Array.from({ length: 30 }, (_, i) => `Bus pickup: a rather long neighborhood name number ${i}`));
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(MEMO_MAX_BYTES);
    expect(long).toMatch(/\+\d+ more$/);
    expect(playMemo({ city: 'raleigh', mode: 'flood', roomCode: 'SOLO', score: 0 }, fp, [])).toMatch(/no pieces placed$/);
  });
});
