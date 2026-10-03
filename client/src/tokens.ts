/** Read a design token from tokens.css so map colors share one source of truth. */
export function token(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  if (!v) throw new Error(`Missing design token --${name}`);
  return v;
}
