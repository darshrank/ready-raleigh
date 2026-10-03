// Color tokens for code that cannot use CSS (deck.gl, MapLibre styles).
// Read from the :root custom properties in styles.css, so the hex values live in one place.

export type RGB = [number, number, number];
export type TokenName = 'chalk' | 'bond' | 'ink' | 'flood' | 'alarm' | 'signal' | 'safe';
const NAMES: TokenName[] = ['chalk', 'bond', 'ink', 'flood', 'alarm', 'signal', 'safe'];

export interface Tokens {
  hex: Record<TokenName, string>;
  rgb: Record<TokenName, RGB>;
}

let cached: Tokens | null = null;

const toRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Read lazily (first call happens during render, after styles.css is applied). */
export function tokens(): Tokens {
  if (cached) return cached;
  const css = getComputedStyle(document.documentElement);
  const hex = {} as Record<TokenName, string>;
  const rgb = {} as Record<TokenName, RGB>;
  for (const name of NAMES) {
    const value = css.getPropertyValue(`--${name}`).trim();
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Color token --${name} is missing`);
    hex[name] = value;
    rgb[name] = toRgb(value);
  }
  cached = { hex, rgb };
  return cached;
}

/** Flat screen tint of `b` over `a` (t = 0 is a, t = 1 is b), like a print shop's percent tint. */
export const tint = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
