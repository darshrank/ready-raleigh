// Location packs (pipeline/out/<area>/). The server only loads them and does cheap lookups.
import fs from 'node:fs';
import path from 'node:path';
import type { PublicRound, Truth } from '@rr/shared';
import { PACKS_DIR } from './app.ts';
import { GameError } from './rooms.ts';

export interface PackRound extends PublicRound {
  truth: Truth;
  clues: string[];
  explanation: string;
  interest: number;
}

interface RoundsFile {
  pack_version: string;
  rounds: PackRound[];
}

const cache = new Map<string, RoundsFile>();

export function loadRounds(area: string, dir = PACKS_DIR): RoundsFile {
  if (!/^[a-z0-9_-]+$/.test(area)) throw new GameError('Unknown map.');
  const hit = cache.get(area);
  if (hit) return hit;
  const file = path.join(dir, area, 'rounds.json');
  if (!fs.existsSync(file)) throw new GameError(`Map "${area}" isn't built yet.`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as RoundsFile;
  if (!data.rounds?.length) throw new GameError(`Map "${area}" has no rounds.`);
  cache.set(area, data);
  return data;
}

/** Strip everything a player must not see before the reveal. */
export function publicRound(r: PackRound): PublicRound {
  const { truth: _t, clues: _c, explanation: _e, interest: _i, ...pub } = r;
  return pub;
}

/** Mulberry32: tiny seeded PRNG so a seed (e.g. the Daily Challenge date) gives the same game. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw `n` rounds alternating A, B, A, B, … (Build rounds join in M5), never repeating a kind
 * back-to-back when avoidable and keeping consecutive rounds at least ~1 km apart.
 */
export function drawRounds(bank: PackRound[], n: number, random: () => number = Math.random): PackRound[] {
  const pool = { A: shuffle(bank.filter((r) => r.type === 'A'), random), B: shuffle(bank.filter((r) => r.type === 'B'), random) };
  const out: PackRound[] = [];
  for (let i = 0; i < n; i++) {
    const want: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';
    const list = pool[want].length ? pool[want] : pool[want === 'A' ? 'B' : 'A'];
    if (!list.length) break;
    const prev = out.at(-1);
    let k = list.findIndex((r) => !prev || (r.kind !== prev.kind && far(r, prev)));
    if (k < 0) k = 0;
    out.push(list.splice(k, 1)[0]!);
  }
  return out;
}

function far(a: PublicRound, b: PublicRound): boolean {
  const [x1, y1] = a.camera.center;
  const [x2, y2] = b.camera.center;
  return Math.hypot((x1 - x2) * 90000, (y1 - y2) * 111000) > 1000;
}

function shuffle<T>(arr: T[], random: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
