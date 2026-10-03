export const money = (n: number) =>
  Math.abs(n) > 0 && Math.abs(n) < 1e6 ? `$${Math.round(n / 1e3)}K` : `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : n % 1e5 === 0 ? 1 : 2)}M`;
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
export const int = (n: number) => Math.round(n).toLocaleString();
