/** Default camera over Raleigh (downtown, looking toward Crabtree Creek). */
export const RALEIGH_CENTER: [number, number] = [-78.6382, 35.7796];
export const DEFAULT_PITCH = 55;
export const BEARING_STEP = 45;
export const TERRAIN_EXAGGERATION = 1.4;

/** Snap a bearing in degrees to the nearest step, normalized to (-180, 180]. */
export function snapBearing(bearing: number, step = BEARING_STEP): number {
  let b = Math.round(bearing / step) * step;
  b = ((b % 360) + 360) % 360;
  return b > 180 ? b - 360 : b;
}

export const M_PER_FT = 0.3048;
export const metersToFeet = (m: number) => m / M_PER_FT;
