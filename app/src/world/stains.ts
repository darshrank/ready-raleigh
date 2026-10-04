// Flooded buildings lose their power (R3): once the water reaches a building, its lit windows
// flicker and go out a moment later. (The wet stains on walls that once lived here were removed.)
//
// A shader module for the building layers. The flood worker's textures say where each step's
// water reaches (extent, signed distance) and when (arrival delay). Everything per frame is a
// uniform.
import type { Layer } from '@deck.gl/core';
import type { Texture } from '@luma.gl/core';
import { RANGE_M, type FloodData } from './floodData';
import { NOISE_GLSL } from './glsl';
import { frame } from './state';
import { dryTexture, floodTextures, RISE_GLSL } from './water';

const uniformBlock = /* glsl */ `\
layout(std140) uniform stainUniforms {
  vec2 origin;
  vec2 cellDeg;
  vec2 gridSize;
  vec3 stepStart;
  float clock;
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
  stepStart: 'vec3<f32>',
  clock: 'f32',
  reduce: 'f32',
  on: 'f32',
} as const;

const fsCode = /* glsl */ `\
${NOISE_GLSL}
${RISE_GLSL}
// 1 once this building has lost its power, 0 before: the water reaches the point, then the lights
// flicker and go out a moment later (up to 4 s, a hash of the building's seed). Storm clock only.
float stain_dark(vec2 uv, float seed) {
  if (stain.on < 0.5 || stain.clock < 0.0) return 0.0;
  vec3 arr = texture(stain_arrival, uv).rgb;
  vec3 sd = (texture(stain_extent, uv).rgb * 255.0 - 128.0) / 127.0 * ${RANGE_M.toFixed(1)};
  float arrive = 1.0e9;
  for (int k = 0; k < 3; k++)
    if (sd[k] < 0.0) arrive = min(arrive, stain.stepStart[k] + arr[k] * (GROW_MS - PART_MS));
  float at = arrive + world_hash(vec2(seed * 71.3, 4.1)) * 4000.0;
  if (stain.clock < at) return 0.0;
  if (stain.reduce > 0.5 || stain.clock > at + 450.0) return 1.0;
  // The flicker: off and on twice before it stays off.
  return step(0.45, world_hash(vec2(floor(stain.clock / 70.0), seed * 13.0)));
}
`;

export const stainModule = {
  name: 'stain',
  vs: uniformBlock,
  fs: `${uniformBlock}\n${fsCode}`,
  uniformTypes,
} as const;

/** The flood textures to bind, or dry land until the flood worker is done. */
export function stainBindings(device: Layer['context']['device'], d: FloodData | null): { stain_arrival: Texture; stain_extent: Texture } {
  if (!d) {
    const t = dryTexture(device);
    return { stain_arrival: t, stain_extent: t };
  }
  const t = floodTextures(device, d);
  return { stain_arrival: t.arrival, stain_extent: t.extent };
}

/** This frame's uniforms (from `frame`). */
export function stainProps(d: FloodData | null) {
  const g = d?.grid;
  return {
    origin: g ? [Math.fround(g.lng0), Math.fround(g.lat0)] : [0, 0],
    cellDeg: g ? [g.dLng, g.dLat] : [1, 1],
    gridSize: g ? [g.w, g.h] : [1, 1],
    stepStart: frame.stepStart,
    clock: frame.clock,
    reduce: frame.reduce ? 1 : 0,
    on: d ? 1 : 0,
  };
}
