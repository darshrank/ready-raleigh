/** $10M, $2.5M, $250K. */
export function money(dollars: number): string {
  if (dollars >= 1_000_000) return `$${+(dollars / 1_000_000).toFixed(2)}M`;
  return `$${Math.round(dollars / 1000)}K`;
}

/** 180 -> 3:00 */
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
