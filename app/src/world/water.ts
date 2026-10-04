// The flood water as one deck.gl layer (DESIGN.md "Water"), built once at load by the flood
// worker (world/flood.worker.ts). Everything that moves is a uniform from `frame` (state.ts):
//
// - Reveal: each fragment appears when its step's growth P passes its arrival delay, the same
//   formula FloodView used per part (P * GROW - delay * (GROW - PART)), plus a little noise in
//   meters so the edge creeps out irregularly. A foam band rides just behind the advancing edge.
// - Surface: three octaves of scrolling value noise in meters (detail fades out at low zoom),
//   a fresnel mix with the sky, the sun's highlight by day and the lightning flash at night.
// - Rain (R6): rings spread from a drop in every 5 m cell while the storm runs (street zoom only).
// - Ending (R6): as the storm clears the 3D water drains, the foam and the rain stop, and the
//   waves settle to a slow, flatter surface.
// - Colors: the flood inks, clean blue (no murky water): step 1 --flood-deep, step 3 --flood by
//   day and --storm-water at night, step 2 between; planning
//   keeps the faint --flood preview. Tilted, the surface rises to its depth after it arrives.
// - Overview (O3, z11-13, where players watch the storm): the channel deep and dark, lighter and
//   see-through toward the edges (the extent texture's distance to the edge), and a bright 1.5 px
//   line on the edge and on the advancing front, sized in screen pixels. From z13 to z14.5 it
//   hands over to the street-level look above.
import { Layer, picking, project32, type DefaultProps, type LayerProps, type UpdateParameters } from '@deck.gl/core';
import { Buffer, type Texture } from '@luma.gl/core';
import { Model } from '@luma.gl/engine';
import { tint, unit, type Tokens } from '../tokens';
import { CELL_M, RANGE_M, type FloodData } from './floodData';
import { NOISE_GLSL } from './glsl';
import { sunVector } from './lights';
import { TIER } from './quality';
import { frame } from './state';

/** Water depth in meters per step in 3D: the floodway is deepest (as map/flood.ts DEPTH_M). */
export const DEPTH_M = [6, 3, 1.5] as const;
/** A step grows in over GROW_MS; each point fades in over PART_MS after its delay (map/flood.ts). */
const GROW_MS = 1500;
const PART_MS = 600;
/** The surface takes this long to rise to its depth once the water has arrived. */
const RISE_MS = 1800;

const M_PER_DEG = 111_320;

type Vec3 = [number, number, number];

const uniformBlock = /* glsl */ `\
layout(std140) uniform waterUniforms {
  vec2 origin;
  vec2 cellDeg;
  vec2 gridSize;
  vec2 metersPerDeg;
  vec3 stepP;
  vec3 stepStart;
  vec3 depth;
  vec3 deepDay;
  vec3 deepNight;
  vec3 waterDay;
  vec3 waterNight;
  vec3 foam;
  vec3 skyDay;
  vec3 skyNight;
  vec3 previewDeep;
  vec3 preview;
  vec3 previewLight;
  vec3 glowDay;
  vec3 glowNight;
  vec3 sunDir;
  float clock;
  float time;
  float night;
  float level;
  float tilt;
  float ending;
  float flash;
  float zoom;
  float reduce;
} water;
`;

const waterModule = {
  name: 'water',
  vs: `${uniformBlock}\nuniform sampler2D water_arrival;\n`,
  fs: `${uniformBlock}\nuniform sampler2D water_arrival;\nuniform sampler2D water_extent;\n${NOISE_GLSL}`,
  uniformTypes: {
    origin: 'vec2<f32>',
    cellDeg: 'vec2<f32>',
    gridSize: 'vec2<f32>',
    metersPerDeg: 'vec2<f32>',
    stepP: 'vec3<f32>',
    stepStart: 'vec3<f32>',
    depth: 'vec3<f32>',
    deepDay: 'vec3<f32>',
    deepNight: 'vec3<f32>',
    waterDay: 'vec3<f32>',
    waterNight: 'vec3<f32>',
    foam: 'vec3<f32>',
    skyDay: 'vec3<f32>',
    skyNight: 'vec3<f32>',
    previewDeep: 'vec3<f32>',
    preview: 'vec3<f32>',
    previewLight: 'vec3<f32>',
    glowDay: 'vec3<f32>',
    glowNight: 'vec3<f32>',
    sunDir: 'vec3<f32>',
    clock: 'f32',
    time: 'f32',
    night: 'f32',
    level: 'f32',
    tilt: 'f32',
    ending: 'f32',
    flash: 'f32',
    zoom: 'f32',
    reduce: 'f32',
  },
} as const;

/**
 * GLSL: how far the water has risen at a point, 0..1, over RISE_MS after it arrives on the storm
 * clock (`start` = its step's start, `delay` = its arrival delay). With no storm clock, or with
 * reduced motion, a step is either all there or not yet.
 */
export const RISE_GLSL = /* glsl */ `\
const float GROW_MS = ${GROW_MS.toFixed(1)};
const float PART_MS = ${PART_MS.toFixed(1)};
const float RISE_MS = ${RISE_MS.toFixed(1)};
float flood_rise(float P, float start, float delay, float clock, float reduce) {
  if (clock < 0.0 || reduce > 0.5) return P >= 0.999 ? 1.0 : 0.0;
  float arrive = start + delay * (GROW_MS - PART_MS);
  return smoothstep(0.0, 1.0, (clock - arrive) / RISE_MS);
}
`;

/** GLSL shared by both stages: a point's arrival delay and how far it has risen. */
const ARRIVAL_GLSL = /* glsl */ `\
${RISE_GLSL}
float water_pick(vec3 v, float k) {
  return k < 1.5 ? v.x : k < 2.5 ? v.y : v.z;
}
// ms since the water reached this point (negative before), from the step's growth.
float water_since(float delay, float k, float jitter) {
  float P = water_pick(water.stepP, k);
  if (P >= 0.999) return 1.0e6;
  return P * GROW_MS - delay * (GROW_MS - PART_MS) + jitter;
}
float water_rise(float delay, float k) {
  return flood_rise(water_pick(water.stepP, k), water_pick(water.stepStart, k), delay, water.clock, water.reduce);
}
`;

/**
 * Rain on the water (R6): one drop per 5 m cell at a hashed spot and moment, every 0.9 s; its
 * ring spreads to 2 m and fades. It tilts the surface normal (so the sky and sun catch it) and
 * sets `ripple` for a faint highlight. Storm only, street zoom, gone under reduced motion and
 * as the storm clears.
 */
const RIPPLES_GLSL = /* glsl */ `
  float rain = (water.clock >= 0.0 && !calm ? 1.0 : 0.0) * (1.0 - water.ending) * water.level
    * clamp((water.zoom - 14.5) / 1.5, 0.0, 1.0);
  if (rain > 0.0) {
    vec2 cell = vMeters / 5.0;
    vec2 ci = floor(cell);
    vec2 drop = ci + 0.2 + 0.6 * vec2(world_hash(ci), world_hash(ci + 17.3));
    float ph = fract(water.time / 0.9 + world_hash(ci + 5.1));
    vec2 d = cell - drop;
    float r = length(d);
    float ring = (1.0 - smoothstep(0.0, 0.05, abs(r - ph * 0.4))) * (1.0 - ph) * rain;
    grad += (r > 1e-4 ? d / r : vec2(0.0)) * ring * 0.35;
    ripple = ring;
  }
`;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME world-water-vs
in vec3 positions;
in vec3 positions64Low;
in vec4 info;
in float steps;
out vec3 vCommon;
out vec3 vCamera;
out vec2 vMeters;
out vec2 vUv;
out float vStep;
out float vSide;
out vec2 vSideNormal;
${ARRIVAL_GLSL}
void main(void) {
  geometry.worldPosition = positions;
  vec2 rel = (positions.xy - water.origin) + positions64Low.xy;
  vUv = rel / water.cellDeg / water.gridSize;
  vMeters = rel * water.metersPerDeg;
  vStep = steps;
  vSide = info.z;
  vSideNormal = info.xy;
  float delay = water_pick(texture(water_arrival, vUv).rgb, steps);
  // Tilted, the surface rises to its depth after the water arrives, and drains at the end.
  float h = water_pick(water.depth, steps) * water_rise(delay, steps) * water.tilt * (1.0 - water.ending);
  float z = info.w > 0.5 ? h : 0.0;
  vec4 posCommon;
  gl_Position = project_position_to_clipspace(vec3(positions.xy, z), positions64Low, vec3(0.0), posCommon);
  geometry.position = posCommon;
  vCommon = posCommon.xyz;
  vCamera = project.cameraPosition;
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME world-water-fs
precision highp float;
in vec3 vCommon;
in vec3 vCamera;
in vec2 vMeters;
in vec2 vUv;
in float vStep;
in float vSide;
in vec2 vSideNormal;
out vec4 fragColor;
${ARRIVAL_GLSL}
void main(void) {
  float k = vStep;
  bool calm = water.reduce > 0.5;
  vec4 arr = texture(water_arrival, vUv);
  float delay = water_pick(arr.rgb, k);

  // Reveal: the edge creeps out of the earlier water, irregular by ~noise meters.
  float jitter = calm ? 0.0 : (world_noise(vMeters / 70.0) - 0.5) * 380.0 + (world_noise(vMeters / 19.0) - 0.5) * 120.0;
  float since = water_since(delay, k, jitter);
  float v = since / PART_MS;
  float aa = max(fwidth(v), 1e-4);
  // Overview: meters per screen pixel and the distance to the visible water's edge, taken here in
  // uniform control flow. The edge is the outer edge of every step that has begun (the bands of
  // steps <= M are one body of water, so the edges between them do not count).
  float mpp = max(length(fwidth(vMeters)) * 0.7071, 1e-3);
  vec3 sdv = (texture(water_extent, vUv).rgb * 255.0 - 128.0) / 127.0 * ${RANGE_M.toFixed(1)};
  float sd = water.stepP.z > 0.0 ? sdv.z : water.stepP.y > 0.0 ? sdv.y : sdv.x;
  float shown = calm ? step(0.0, v) : smoothstep(-aa, aa, v);
  if (shown <= 0.001) discard;

  // Colors: deep for the floodway, regular for the 500-year band, day to night.
  float deepness = clamp((3.0 - k) / 2.0, 0.0, 1.0);
  vec3 deep = mix(water.deepDay, water.deepNight, water.night);
  vec3 reg = mix(water.waterDay, water.waterNight, water.night);
  vec3 base = mix(reg, deep, deepness);
  vec3 sky = mix(water.skyDay, water.skyNight, water.night);

  // Surface: up to three octaves of scrolling noise in meters (the quality tier's count); the fine
  // ones fade out at low zoom.
  // The waves settle as the storm clears: slower and flatter.
  float settle = 1.0 - 0.6 * water.ending;
  float t = calm ? 0.0 : water.time * mix(1.0, 0.4, water.ending);
  float fine = clamp((water.zoom - 12.5) / 2.5, 0.0, 1.0);
  float finer = clamp((water.zoom - 14.5) / 2.0, 0.0, 1.0);
  vec3 n1 = world_noised(vMeters / 42.0 + t * vec2(0.035, 0.021));
  vec3 n2 = ${TIER.octaves >= 2 ? 'world_noised(vMeters / 13.0 + t * vec2(-0.06, 0.045)) * fine' : 'vec3(0.0)'};
  vec3 n3 = ${TIER.octaves >= 3 ? 'world_noised(vMeters / 4.2 + t * vec2(0.11, -0.08)) * finer' : 'vec3(0.0)'};
  vec2 grad = (n1.yz / 42.0 * 1.6 + n2.yz / 13.0 * 0.9 + n3.yz / 4.2 * 0.35) * settle;
  float ripple = 0.0;
  ${TIER.ripples ? RIPPLES_GLSL : ''}
  vec3 N = normalize(vec3(-grad * 9.0, 1.0));
  if (vSide > 0.5) N = normalize(vec3(vSideNormal, 0.25));
  vec3 V = normalize(vCamera - vCommon);
  float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 color = mix(base, sky, clamp(fresnel, 0.0, 0.7) * 0.75);
  float day = 1.0 - water.night;
  vec3 L = normalize(water.sunDir);
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 90.0);
  color += water.foam * spec * day * 0.55;
  // Each ring catches a little light, so the rain reads even from straight above.
  color = mix(color, water.foam, ripple * 0.18);
  color = mix(color, water.foam, water.flash * water.night * 0.45);
  if (vSide > 0.5) color *= 0.82;

  // Foam rides just behind the advancing edge, broken up by noise (not on the low tier).
  if (!calm && ${TIER.foam}) {
    float band = 1.0 - smoothstep(0.0, 0.45, v);
    float froth = smoothstep(0.35, 0.75, world_noise(vMeters / 3.5 + t * 0.2) * 0.6 + world_noise(vMeters / 11.0) * 0.6);
    // Foam is a street-level detail: at the city view it would only speckle the creeks.
    float near = clamp((water.zoom - 13.0) / 1.5, 0.0, 1.0);
    color = mix(color, water.foam, band * froth * (1.0 - water.ending) * 0.85 * near);
  }

  // Planning: the faint printed preview in the --flood inks, by step.
  vec3 pv = k < 1.5 ? water.previewDeep : k < 2.5 ? water.preview : water.previewLight;
  float pa = k < 1.5 ? 0.45 : k < 2.5 ? 0.36 : 0.27;
  float fa = vSide > 0.5 ? 0.78 : 0.88;
  vec3 rgb = mix(pv, color, water.level);
  float a = mix(pa, fa, water.level) * shown;

  // Overview (z11-13, storm only): deep and dark in the channel, lighter and see-through toward
  // the edges, and a bright 1.5 px line on the edge and on the advancing front.
  float ov = (1.0 - smoothstep(13.0, 14.5, water.zoom)) * water.level;
  if (ov > 0.0) {
    float inward = smoothstep(0.0, 90.0, -sd);
    vec3 channel = deep * 0.7;
    vec3 shallow = mix(reg, sky, 0.45);
    vec3 body = mix(shallow, channel, inward);
    float bodyA = mix(0.42, 0.94, inward) * shown;
    float edgePx = sd >= 0.0 ? 0.0 : -sd / mpp;
    if (!calm && water_pick(water.stepP, k) < 0.999) edgePx = min(edgePx, max(v, 0.0) / aa);
    float line = 1.0 - smoothstep(1.0, 1.75, edgePx);
    vec3 glow = mix(water.glowDay, water.glowNight, water.night);
    rgb = mix(rgb, mix(body, glow, line), ov);
    a = mix(a, max(bodyA, line * shown), ov);
  }
  fragColor = vec4(rgb, a);
}
`;

/** Every color of the water, from the tokens. */
function paint({ rgb }: Tokens) {
  return {
    deepDay: unit(rgb['flood-deep']),
    deepNight: unit(rgb['flood-deep']),
    waterDay: unit(rgb.flood),
    waterNight: unit(rgb['storm-water']),
    foam: unit(rgb.foam),
    skyDay: unit(rgb['sky-day']),
    skyNight: unit(rgb['sky-night']),
    previewDeep: unit(rgb['flood-deep']),
    preview: unit(rgb.flood),
    previewLight: unit(tint(rgb.flood, rgb.bond, 0.25)),
    glowDay: unit(rgb.foam),
    glowNight: unit(rgb['storm-glow']),
  };
}

// The flood textures, shared by the water, the flooded buildings (stains.ts) and the city lights. One set per
// device: a new map (leaving /solo and coming back) has a new GL context.
type FloodTextures = { arrival: Texture; extent: Texture };
const textures = new WeakMap<object, FloodTextures>();
const SAMPLER = { minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' } as const;
export function floodTextures(device: Layer['context']['device'], d: FloodData): FloodTextures {
  let t = textures.get(device);
  if (t) return t;
  const make = (data: Uint8Array) => device.createTexture({ data, width: d.grid.w, height: d.grid.h, format: 'rgba8unorm', sampler: SAMPLER });
  t = { arrival: make(d.arrival), extent: make(d.extent) };
  textures.set(device, t);
  return t;
}

// Before the flood worker is done: one texel of dry land (as far from the water as the extent
// texture reaches), so layers that sample the flood can draw.
const dry = new WeakMap<object, Texture>();
export function dryTexture(device: Layer['context']['device']): Texture {
  let t = dry.get(device);
  if (!t) dry.set(device, (t = device.createTexture({ data: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1, format: 'rgba8unorm', sampler: SAMPLER })));
  return t;
}

type WaterProps = { flood: FloodData | null; tokens: Tokens | null };

export class WaterLayer extends Layer<WaterProps & LayerProps> {
  static layerName = 'WorldWaterLayer';
  static defaultProps = {
    flood: { type: 'object', value: null, compare: true },
    tokens: { type: 'object', value: null, compare: false },
  } as unknown as DefaultProps<WaterProps & LayerProps>;

  declare state: { model: Model | null; buffers: Buffer[]; paint: ReturnType<typeof paint> | null };

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, picking, waterModule] });
  }

  initializeState() {
    this.state = { model: null, buffers: [], paint: null };
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    if (params.props.flood !== params.oldProps.flood) this.upload();
  }

  private upload() {
    this.free();
    const d = this.props.flood;
    if (!d || !this.props.tokens) return;
    const device = this.context.device;
    const attributes = {
      positions: device.createBuffer({ data: d.positions }),
      positions64Low: device.createBuffer({ data: d.positions64Low }),
      info: device.createBuffer({ data: d.info }),
      steps: device.createBuffer({ data: d.steps }),
    };
    const indexBuffer = device.createBuffer({ usage: Buffer.INDEX, indexType: 'uint32', data: d.indices });
    const model = new Model(device, {
      ...this.getShaders(),
      id: this.props.id,
      topology: 'triangle-list',
      bufferLayout: [
        { name: 'positions', format: 'float32x3' },
        { name: 'positions64Low', format: 'float32x3' },
        { name: 'info', format: 'snorm8x4' },
        { name: 'steps', format: 'float32' },
      ],
      attributes,
      indexBuffer,
      vertexCount: d.indices.length,
      disableWarnings: true,
    });
    const t = floodTextures(device, d);
    model.setBindings({ water_arrival: t.arrival, water_extent: t.extent });
    this.setState({ model, buffers: [...Object.values(attributes), indexBuffer], paint: paint(this.props.tokens) });
  }

  private free() {
    this.state.model?.destroy();
    for (const b of this.state.buffers) b.destroy();
    this.state.model = null;
    this.state.buffers = [];
  }

  draw() {
    const { model, paint: colors } = this.state;
    const d = this.props.flood;
    if (!model || !d || !colors) return;
    const lat = d.grid.lat0 + (d.grid.h * d.grid.dLat) / 2;
    model.shaderInputs.setProps({
      water: {
        ...colors,
        origin: [Math.fround(d.grid.lng0), Math.fround(d.grid.lat0)],
        cellDeg: [d.grid.dLng, d.grid.dLat],
        gridSize: [d.grid.w, d.grid.h],
        metersPerDeg: [M_PER_DEG * Math.cos((lat * Math.PI) / 180), M_PER_DEG],
        stepP: frame.stepP,
        stepStart: frame.stepStart,
        depth: [...DEPTH_M],
        sunDir: sunVector(),
        clock: frame.clock,
        time: (frame.now / 1000) % 3600,
        night: frame.night,
        level: frame.level,
        tilt: frame.tilt,
        ending: frame.ending,
        flash: frame.flash,
        zoom: this.context.viewport.zoom,
        reduce: frame.reduce ? 1 : 0,
      },
    });
    model.draw(this.context.renderPass);
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]) {
    super.finalizeState(context);
    this.free();
  }
}

/** Meters per texture cell (the flood worker's grid). */
export const FLOOD_CELL_M = CELL_M;
