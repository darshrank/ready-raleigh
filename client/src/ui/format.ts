export const fmtInt = new Intl.NumberFormat('en-US');
export const fmtScore = (n: number) => fmtInt.format(Math.round(n));
export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
export function fmtValue(v: number, units: string): string {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return units === '%' ? `${s}%` : `${s} ${units}`;
}
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
