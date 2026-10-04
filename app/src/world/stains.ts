// Wet stains (R5): walls that stood in the flood stay dark below the highest water line after
// the water drains, with a ragged edge where the wet wicked up and a darker tide line.
//
// A shader module for the building layers. The flood worker's textures say where each step's
// water reaches (extent, signed distance) and when (arrival delay); the stain's height is the
// water's depth there times how far it has risen. The rise never goes back down (the ending only
// drains the water surface), so the stain keeps the peak. Everything per frame is a uniform.
import type { Layer } from '@deck.gl/core';
import type { Texture } from '@luma.gl/core';
import { unit, type Tokens } from '../tokens';
import { RANGE_M, type FloodData } from './floodData';
import { NOISE_GLSL } from './glsl';
import { frame } from './state';
import { DEPTH_M, dryTexture, floodTextures, RISE_GLSL } from './water';

const uniformBlock = /* glsl */ `\
layout(std140) uniform stainUniforms {
  vec2 origin;
  vec2 cellDeg;
  vec2 gridSize;
  vec3 stepP;
  vec3 stepStart;
  vec3 depth;
  vec3 stainDay;
  vec3 stainNight;
  float clock;
  float level;
  float reduce;
  float on;
} stain;
uniform sampler2D stain_arrival;
uniform sampler2D stain_extent;
`;

const uniformTypes = {
  origin: 'vec2<f32>',
  cellDeg: 'vec2<f32>',
  gridSize: 'vec2<f32>',
  stepP: 'vec3<f32>',
  stepStart: 'vec3<f32>',
  depth: 'vec3<f32>',
  stainDay: 'vec3<f32>',
  stainNight: 'vec3<f32>',
  clock: 'f32',
  level: 'f32',
  reduce: 'f32',
  on: 'f32',
} as const;

const fsCode = /* glsl */ `\
${NOISE_GLSL}
${RISE_GLSL}
// The flood grid's texture coordinate of a fp64-split longitude/latitude.
vec2 stain_uv(vec2 lngLat, vec2 low) {
  return ((lngLat - stain.origin) + low) / stain.cellDeg / stain.gridSize;
}
// The highest the water has stood at this point so far (meters above the ground, 0 if dry).
// Near a step's edge the water is shallow (the ground rises), so its depth tapers off there.
float stain_peak(vec2 uv) {
  vec3 arr = texture(stain_arrival, uv).rgb;
  vec3 sd = (texture(stain_extent, uv).rgb * 255.0 - 128.0) / 127.0 * ${RANGE_M.toFixed(1)};
  float h = 0.0;
  for (int k = 0; k < 3; k++) {
    float taper = 1.0 - smoothstep(-20.0, 12.0, sd[k]);
    if (taper <= 0.0) continue;
    h = max(h, stain.depth[k] * taper * flood_rise(stain.stepP[k], stain.stepStart[k], arr[k], stain.clock, stain.reduce));
  }
  return h;
}
// The wall's base color with the stain: wall = (meters along, meters up, length, seed), aa =
// fwidth(wall.y) (taken by the caller in uniform control flow).
vec3 stain_apply(vec3 base, vec2 uv, vec4 wall, float night, float aa) {
  if (stain.on < 0.5 || stain.level <= 0.0) return base;
  float peak = stain_peak(uv);
  if (peak < 0.02) return base;
  // The wet wicks up a little above the water line, unevenly along the wall.
  float wick = smoothstep(0.0, 0.6, peak) * (0.22 + (world_noise(vec2(wall.x / 1.4, wall.w * 97.0)) - 0.5) * 0.3);
  float top = peak + wick + (world_noise(vec2(wall.x / 0.35, wall.w * 31.0)) - 0.5) * 0.06;
  float up = wall.y;
  float wet = 1.0 - smoothstep(top - aa, top + aa, up);
  if (wet <= 0.0) return base;
  vec3 color = mix(stain.stainDay, stain.stainNight, night);
  // Darkest at the foot of the wall, lighter toward the top as it dries.
  float strength = mix(0.92, 0.68, clamp(up / max(top, 0.5), 0.0, 1.0));
  vec3 stained = mix(base, color, strength);
  // The tide line: a darker band just under the top, where the water stood longest.
  float rim = smoothstep(top - 0.24, top - 0.1, up) * (1.0 - smoothstep(top - 0.1, top - 0.02, up));
  stained = mix(stained, color * 0.82, rim * 0.6);
  return mix(base, stained, wet * stain.level);
}
`;

export const stainModule = {
  name: 'stain',
  vs: uniformBlock,
  fs: `${uniformBlock}\n${fsCode}`,
  uniformTypes,
} as const;

/** The stain colors from the tokens. */
export function stainPaint({ rgb }: Tokens) {
  return { stainDay: unit(rgb['wet-stain-day']), stainNight: unit(rgb['wet-stain-night']) };
}

/** The flood textures to bind, or dry land until the flood worker is done. */
export function stainBindings(device: Layer['context']['device'], d: FloodData | null): { stain_arrival: Texture; stain_extent: Texture } {
  if (!d) {
    const t = dryTexture(device);
    return { stain_arrival: t, stain_extent: t };
  }
  const t = floodTextures(device, d);
  return { stain_arrival: t.arrival, stain_extent: t.extent };
}

/** This frame's stain uniforms (from `frame`). */
export function stainProps(d: FloodData | null, colors: ReturnType<typeof stainPaint>) {
  const g = d?.grid;
  return {
    ...colors,
    origin: g ? [Math.fround(g.lng0), Math.fround(g.lat0)] : [0, 0],
    cellDeg: g ? [g.dLng, g.dLat] : [1, 1],
    gridSize: g ? [g.w, g.h] : [1, 1],
    stepP: frame.stepP,
    stepStart: frame.stepStart,
    depth: [...DEPTH_M],
    clock: frame.clock,
    level: frame.level,
    reduce: frame.reduce ? 1 : 0,
    on: d ? 1 : 0,
  };
}
