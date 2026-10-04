// Color tokens for code that cannot use CSS (deck.gl, MapLibre styles).
// Read from the :root custom properties in styles.css, so the hex values live in one place.

export type RGB = [number, number, number];
const NAMES = [
  'chalk',
  'bond',
  'ink',
  'flood',
  'flood-deep',
  'alarm',
  'signal',
  'safe',
  // Night storm palette (basemap only).
  'storm-land',
  'storm-street',
  'storm-building',
  'storm-label',
  'storm-water',
  'storm-glow',
  // The world: realistic city and storm water (3D buildings, shadows, windows, murky water).
  'foam',
  'sky-day',
  'sky-night',
  'wall-day',
  'wall-night',
  'glass-day',
  'glass-night',
  'window-lit',
  'shadow',
] as const;
export type TokenName = (typeof NAMES)[number];

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

/** CSS rgba() of a token color at alpha `a`, for MapLibre paint values. */
export const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${+a.toFixed(3)})`;

/** A token color as 0..1 floats, for shader uniforms. */
export const unit = ([r, g, b]: RGB): [number, number, number] => [r / 255, g / 255, b / 255];

/** Flat screen tint of `b` over `a` (t = 0 is a, t = 1 is b), like a print shop's percent tint. */
export const tint = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
