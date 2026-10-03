export type RGBA = [number, number, number, number];

export const AGENT = {
  evacuating: [34, 211, 238] as [number, number, number],
  protected: [52, 211, 153] as [number, number, number],
  delayed: [250, 204, 21] as [number, number, number],
  rerouted: [251, 146, 60] as [number, number, number],
  stranded: [244, 63, 94] as [number, number, number],
  isolated: [168, 85, 247] as [number, number, number],
  bus: [253, 224, 71] as [number, number, number],
  rescue: [248, 250, 252] as [number, number, number],
};

export const FLOOD: Record<number, RGBA> = {
  1: [10, 104, 190, 205],
  2: [30, 144, 230, 175],
  3: [100, 190, 250, 140],
};

export const FLOOD_ZONE_FILL: Record<number, RGBA> = {
  1: [24, 120, 210, 110],
  2: [56, 160, 240, 70],
  3: [125, 200, 252, 45],
};

export const QUADRANT_COLOR: Record<string, RGBA> = {
  consensus: [52, 211, 153, 105],
  blindspot: [244, 63, 94, 115],
  signal: [250, 204, 21, 95],
  low: [71, 85, 105, 35],
};

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Blue ramp for the at-risk choropleth (0..1). */
export function riskRamp(t: number, alpha = 150): RGBA {
  const stops: [number, number, number][] = [
    [30, 41, 59],
    [56, 120, 190],
    [250, 204, 21],
    [251, 113, 60],
    [244, 63, 94],
  ];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, alpha];
}
