// Windows (R3): a grid of panes on every wall of the 3D city, drawn in the building shader from
// the wall coordinates (meters along, meters up, wall length, building seed), so there is no
// texture and nothing per frame.
//
// - By day the panes are --glass-day; at night about a third of them glow --window-lit (which ones
//   is a hash of the building, floor and column), the rest are --glass-night.
// - Too small to draw (a pixel covers more than about a meter and a half), the grid fades to its
//   average tone and glow, so distant walls never shimmer. The far glow is a little stronger than
//   the true average so a lit city still reads from the helicopter.
// - Flooded buildings go dark: once the water reaches a building, its lights go out a few seconds
//   later (stains.ts `stain_dark`), each building at its own moment.
import { unit, type Tokens } from '../tokens';
import { TIER } from './quality';

/** Meters between window columns (fitted to each wall's length) and between floors. */
const COLUMN_M = 3;
const FLOOR_M = 3.2;
/** Share of windows lit at night. */
const LIT_SHARE = 0.36;

const uniformBlock = /* glsl */ `\
layout(std140) uniform windowsUniforms {
  vec3 glassDay;
  vec3 glassNight;
  vec3 lit;
} windows;
`;

const fsCode = /* glsl */ `\
// The window at this wall point: .x the pane (0..1), .y its light at night (0..1). px = meters
// per pixel on the wall (taken by the caller in uniform control flow). Needs world_hash (glsl.ts,
// included by the stain module).
vec2 windows_at(vec4 wall, float px) {
  float len = wall.z;
  if (len < 2.0) return vec2(0.0);
  ${TIER.windowFade ? '' : `// Low quality tier: the grid's average only.
  return vec2(0.56 * 0.52, ${LIT_SHARE.toFixed(2)} * 1.6);`}
  float n = max(1.0, floor(len / ${COLUMN_M.toFixed(1)}));
  float colM = len / n;
  float u = wall.x / colM;
  float v = wall.y / ${FLOOR_M.toFixed(1)};
  vec2 f = fract(vec2(u, v));
  vec2 aa = vec2(px / colM, px / ${FLOOR_M.toFixed(1)});
  float across = smoothstep(0.22 - aa.x, 0.22 + aa.x, f.x) * (1.0 - smoothstep(0.78 - aa.x, 0.78 + aa.x, f.x));
  float up = smoothstep(0.3 - aa.y, 0.3 + aa.y, f.y) * (1.0 - smoothstep(0.82 - aa.y, 0.82 + aa.y, f.y));
  float h = world_hash(vec2(wall.w * 113.0 + floor(u) * 1.37, floor(v) * 7.31 + wall.w * 17.0));
  float glow = step(h, ${LIT_SHARE.toFixed(2)}) * (0.7 + 0.3 * fract(h * 41.0));
  // Far away: the grid's average pane and glow instead of sub-pixel detail.
  float detail = 1.0 - smoothstep(${(TIER.windowFade ?? [0.7, 1.6])[0].toFixed(2)}, ${(TIER.windowFade ?? [0.7, 1.6])[1].toFixed(2)}, px);
  return vec2(mix(0.56 * 0.52, across * up, detail), mix(${LIT_SHARE.toFixed(2)} * 1.6, glow, detail));
}
`;

export const windowsModule = {
  name: 'windows',
  vs: uniformBlock,
  fs: `${uniformBlock}\n${fsCode}`,
  uniformTypes: { glassDay: 'vec3<f32>', glassNight: 'vec3<f32>', lit: 'vec3<f32>' },
} as const;

/** The window colors from the tokens. */
export function windowsPaint({ rgb }: Tokens) {
  return { glassDay: unit(rgb['glass-day']), glassNight: unit(rgb['glass-night']), lit: unit(rgb['window-lit']) };
}
