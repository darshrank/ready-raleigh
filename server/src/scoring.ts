// Deterministic scoring (PLAN.md §5). All numbers come from here; no AI involved.
import type { LngLat, ScoreBreakdown } from '@rr/shared';

export const MAX_SCORE = 5000;
export const LENS_FACTOR = 0.9;
export const TIME_BONUS_MAX = 0.05;

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function distanceM(a: LngLat, b: LngLat): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Pin: 5000·exp(−d/s), d = metres to the nearest truth point. */
export function pinBase(guess: LngLat, truth: LngLat[], s: number): { base: number; d: number } {
  if (!truth.length || s <= 0) throw new Error('pinBase: need truth points and s > 0');
  const d = Math.min(...truth.map((t) => distanceM(guess, t)));
  return { base: MAX_SCORE * Math.exp(-d / s), d };
}

/** Estimate: 5000·exp(−|guess − truth|/s). */
export function estimateBase(guess: number, truth: number, s: number): { base: number; err: number } {
  if (s <= 0) throw new Error('estimateBase: s must be > 0');
  const err = Math.abs(guess - truth);
  return { base: MAX_SCORE * Math.exp(-err / s), err };
}

/** Each lens used multiplies the score by 0.9. */
export function lensMultiplier(lensesUsed: number): number {
  return LENS_FACTOR ** Math.max(0, lensesUsed);
}

/** Up to +5% for locking in during the first third of the timer, falling linearly to 0 at T/3. */
export function timeBonus(msToLock: number, timerMs: number): number {
  const third = timerMs / 3;
  if (msToLock < 0 || msToLock >= third) return 0;
  return TIME_BONUS_MAX * (1 - msToLock / third);
}

/** Final round score: capped at 5000 (decision: the time bonus can't exceed the max). */
export function finalScore(base: number, lensesUsed: number, msToLock: number, timerMs: number) {
  const lm = lensMultiplier(lensesUsed);
  const tb = timeBonus(msToLock, timerMs);
  return { lensMultiplier: lm, timeBonus: tb, final: Math.min(MAX_SCORE, Math.round(base * lm * (1 + tb))) };
}

export function scoreRound(
  args:
    | { kind: 'pin'; guess: LngLat | null; truth: LngLat[]; s: number }
    | { kind: 'estimate'; guess: number | null; truth: number; s: number; units: string },
  lensesUsed: number,
  msToLock: number | null,
  timerMs: number,
): ScoreBreakdown {
  if (args.guess === null || msToLock === null) {
    return { base: 0, lensMultiplier: lensMultiplier(lensesUsed), timeBonus: 0, final: 0, error: null, errorUnits: args.kind === 'pin' ? 'm' : args.units };
  }
  const { base, error } =
    args.kind === 'pin'
      ? (({ base, d }) => ({ base, error: d }))(pinBase(args.guess, args.truth, args.s))
      : (({ base, err }) => ({ base, error: err }))(estimateBase(args.guess, args.truth, args.s));
  const f = finalScore(base, lensesUsed, msToLock, timerMs);
  return { base: Math.round(base), ...f, error, errorUnits: args.kind === 'pin' ? 'm' : args.units };
}

/** Seats ordered best-first. Ties on total score: the earlier total lock-in time wins. */
export function rankPlayers(players: { seat: number; total: number; lockMs: number }[]): number[] {
  return [...players].sort((a, b) => b.total - a.total || a.lockMs - b.lockMs || a.seat - b.seat).map((p) => p.seat);
}
