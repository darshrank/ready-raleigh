// The city at night from the storm overview (DESIGN.md "The world"): thousands of glowing points,
// building lights and street lights (world/cityLightsData.ts, built once in the flood worker),
// drawn as one deck.gl layer of screen-sized points with additive blending.
//
// - Brightness follows the storm's night: zero by day, in planning and with no storm clock.
// - Sizes are screen pixels (1.5-3 px), so the city reads the same at every overview zoom; the
//   points fade out as the camera comes down to the street, where the windows take over.
// - Street lights are --window-lit; building lights a whiter tint of it, mostly dim with a few
//   bright ones. A faint flicker on some.
// - Blackout (O2): each light reads the arrival textures at its nearest zone cell
//   (cityLightsData.ts `ref`) and goes dark on the storm clock, in the city's hazard's character:
//   - flood: once the water reaches it, a flicker and out after a short random delay; lights
//     within NEAR_M follow a few seconds later, so neighborhoods go dark in a wave behind the water;
//   - quake: at each step its zones cut out almost at once with a brief flicker, as if lines
//     snapped; nearby blocks follow within a second or two;
//   - heat: rolling blackouts first (blocks of the hottest step's zones switch off and on in turns),
//     then each step's zones go dark for good as the grid fails (step 2 on).
//   Reduced motion: lights go out per step, at once, with no flicker or rolling.
// - Everything per frame is a uniform from `frame` (state.ts); the points never change.
import { Layer, picking, project32, type DefaultProps, type LayerProps, type UpdateParameters } from '@deck.gl/core';
import type { Buffer } from '@luma.gl/core';
import { Model } from '@luma.gl/engine';
import type { Hazard } from '../story';
import { tint, unit, type Tokens } from '../tokens';
import { NEAR_M, type LightsData } from './cityLightsData';
import { RANGE_M, type FloodData } from './floodData';
import { frame } from './state';
import { dryTexture, floodTextures, RISE_GLSL } from './water';

const HAZARD: Record<Hazard, number> = { flood: 0, quake: 1, heat: 2 };

const uniformBlock = /* glsl */ `\
layout(std140) uniform cityLightsUniforms {
  vec3 street;
  vec3 building;
  vec3 stepP;
  vec3 stepStart;
  vec2 gridSize;
  float brightness;
  float time;
  float zoom;
  float reduce;
  float clock;
  float hazard;
  float zones;
} cityLights;
`;

const cityLightsModule = {
  name: 'cityLights',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    street: 'vec3<f32>',
    building: 'vec3<f32>',
    stepP: 'vec3<f32>',
    stepStart: 'vec3<f32>',
    gridSize: 'vec2<f32>',
    brightness: 'f32',
    time: 'f32',
    zoom: 'f32',
    reduce: 'f32',
    clock: 'f32',
    hazard: 'f32',
    zones: 'f32',
  },
} as const;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME world-city-lights-vs
in vec2 positions;
in vec2 positions64Low;
in vec2 info;
in vec3 ref;
out vec3 vColor;
uniform sampler2D lights_arrival;
uniform sampler2D lights_extent;
${RISE_GLSL}
float lights_hash(float x) {
  return fract(sin(x * 91.17) * 43758.5453);
}
float lights_pick(vec3 v, int k) {
  return k == 0 ? v.x : k == 1 ? v.y : v.z;
}
// A light's power on the storm clock: 1 lit, 0 out (flickering in between moments).
float lights_power(float seed) {
  float dist = ref.z;
  if (cityLights.zones < 0.5 || dist < 0.0 || cityLights.clock < 0.0) return 1.0;
  // The zone at the reference cell: the first step whose extent covers it, and when it arrives.
  vec3 sd = (texture(lights_extent, ref.xy).rgb * 255.0 - 128.0) / 127.0 * ${RANGE_M.toFixed(1)};
  int k = sd.x < 0.0 ? 0 : sd.y < 0.0 ? 1 : 2;
  float delay = lights_pick(texture(lights_arrival, ref.xy).rgb, k);
  float start = lights_pick(cityLights.stepStart, k);
  float clock = cityLights.clock;
  float h = lights_hash(seed * 11.0 + 0.37);
  float near = clamp(dist / ${NEAR_M.toFixed(1)}, 0.0, 1.0);
  bool inside = dist <= 0.0;
  int hz = int(cityLights.hazard + 0.5);

  if (cityLights.reduce > 0.5) {
    // Per step, at once: the step that darkens this light has begun.
    if (hz == 2 && !inside) return 1.0;
    int kd = hz == 2 ? max(k, 1) : k;
    return lights_pick(cityLights.stepP, kd) >= 0.999 ? 0.0 : 1.0;
  }

  float at;
  float flick;
  if (hz == 0) {
    // Flood: out a moment after the water arrives; near the water a few seconds later.
    float arrive = start + delay * (GROW_MS - PART_MS);
    at = inside ? arrive + h * 1500.0 : arrive + 2500.0 + near * 2500.0 + h * 1200.0;
    flick = 600.0;
  } else if (hz == 1) {
    // Quake: the zone's lines snap at the step's start; nearby blocks within a second or two.
    at = inside ? start + h * 250.0 : start + 400.0 + near * 1400.0 + h * 300.0;
    flick = 220.0;
  } else {
    // Heat: only the zones lose power. The grid fails from step 2: each zone for good, as it spreads.
    if (!inside) return 1.0;
    float fail = max(start, cityLights.stepStart.y) + delay * (GROW_MS - PART_MS);
    at = fail + h * 1500.0;
    flick = 300.0;
    // Before that, rolling blackouts in the hottest step's zones: blocks of ~400 m take turns.
    float roll = start + delay * (GROW_MS - PART_MS);
    if (k == 0 && clock >= roll && clock < at) {
      vec2 block = floor(ref.xy * cityLights.gridSize / 13.0);
      float phase = fract(sin(dot(block, vec2(12.9898, 78.233))) * 43758.5453);
      float cycle = fract((clock - roll) / 3600.0 + phase);
      return cycle < 0.34 ? 0.0 : 1.0;
    }
  }
  if (clock < at - flick) return 1.0;
  if (clock >= at) return 0.0;
  // The flicker: on and off a few times before it stays off.
  return step(0.5, lights_hash(floor(clock / 60.0) + seed * 97.0));
}
void main(void) {
  float street = info.x;
  float seed = info.y;
  // Overview to street level: full up to z14.5, gone by z15.5 (the windows take over there).
  float zoomFade = 1.0 - smoothstep(14.5, 15.5, cityLights.zoom);
  // Denser on screen when far: a little dimmer, so the city does not wash out.
  float density = mix(0.5, 0.95, smoothstep(10.5, 13.0, cityLights.zoom));
  float b = cityLights.brightness * zoomFade * density * lights_power(seed);
  // A faint flicker on about a third of the lights (none under reduced motion).
  float flick = 1.0;
  if (cityLights.reduce < 0.5 && lights_hash(seed * 7.0) < 0.33)
    flick -= 0.22 * (0.5 + 0.5 * sin(cityLights.time * (2.0 + 6.0 * seed) + seed * 60.0));
  // Most building lights are dim, a few bright (a lit lobby, a sign); street lamps are even.
  float h = lights_hash(seed * 3.0);
  b *= flick * (street > 0.5 ? mix(0.7, 0.9, h) : 0.22 + 0.78 * h * h * h);
  if (b <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  geometry.worldPosition = vec3(positions, 0.0);
  vec4 posCommon;
  gl_Position = project_position_to_clipspace(vec3(positions, 0.0), vec3(positions64Low, 0.0), vec3(0.0), posCommon);
  geometry.position = posCommon;
  // 1.5-3 CSS px: street lights the smaller ones. One more pixel for the soft edge.
  float px = street > 0.5 ? mix(1.5, 2.2, lights_hash(seed * 5.0)) : mix(2.0, 3.0, lights_hash(seed * 5.0));
  gl_PointSize = (px + 1.0) * project.devicePixelRatio;
  vColor = (street > 0.5 ? cityLights.street : cityLights.building) * b;
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME world-city-lights-fs
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main(void) {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  // A bright core with a soft falloff; added to what is under it (additive blending).
  float glow = exp(-r2 * 3.0);
  fragColor = vec4(vColor * glow, 0.0);
}
`;

/** Street lights in --window-lit, building lights a whiter tint of it. */
function paint({ rgb }: Tokens) {
  return { street: unit(rgb['window-lit']), building: unit(tint(rgb['window-lit'], rgb.bond, 0.3)) };
}

/** Additive: the lights add to the night under them and never touch the canvas alpha or depth. */
const ADDITIVE = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'zero',
  blendAlphaDstFactor: 'one',
  depthWriteEnabled: false,
  depthCompare: 'always',
} as const;

type CityLightsProps = { lights: LightsData | null; tokens: Tokens | null; flood: FloodData | null; hazard: Hazard };

export class CityLightsLayer extends Layer<CityLightsProps & LayerProps> {
  static layerName = 'WorldCityLightsLayer';
  static defaultProps = {
    lights: { type: 'object', value: null, compare: true },
    tokens: { type: 'object', value: null, compare: false },
    flood: { type: 'object', value: null, compare: true },
    hazard: { type: 'string', value: 'flood' },
    parameters: { type: 'object', value: ADDITIVE, compare: false },
  } as unknown as DefaultProps<CityLightsProps & LayerProps>;

  declare state: { model: Model | null; buffers: Buffer[]; paint: ReturnType<typeof paint> | null };

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, picking, cityLightsModule] });
  }

  initializeState() {
    this.state = { model: null, buffers: [], paint: null };
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    if (params.props.lights !== params.oldProps.lights || params.props.flood !== params.oldProps.flood) this.upload();
  }

  private upload() {
    this.free();
    const d = this.props.lights;
    if (!d || !d.count || !this.props.tokens) return;
    const device = this.context.device;
    const attributes = {
      positions: device.createBuffer({ data: d.positions }),
      positions64Low: device.createBuffer({ data: d.positions64Low }),
      info: device.createBuffer({ data: d.info }),
      ref: device.createBuffer({ data: d.ref }),
    };
    const model = new Model(device, {
      ...this.getShaders(),
      id: this.props.id,
      topology: 'point-list',
      bufferLayout: [
        { name: 'positions', format: 'float32x2' },
        { name: 'positions64Low', format: 'float32x2' },
        { name: 'info', format: 'float32x2' },
        { name: 'ref', format: 'float32x3' },
      ],
      attributes,
      vertexCount: d.count,
      disableWarnings: true,
    });
    // The hazard's arrival textures (shared with the water and the buildings), or dry land without them.
    const flood = this.props.flood;
    const t = flood ? floodTextures(device, flood) : null;
    const dry = dryTexture(device);
    model.setBindings({ lights_arrival: t?.arrival ?? dry, lights_extent: t?.extent ?? dry });
    this.setState({ model, buffers: Object.values(attributes), paint: paint(this.props.tokens) });
  }

  private free() {
    this.state.model?.destroy();
    for (const b of this.state.buffers) b.destroy();
    this.state.model = null;
    this.state.buffers = [];
  }

  draw() {
    const { model, paint: colors } = this.state;
    if (!model || !colors) return;
    // Lit only in the storm's night: never by day, in planning, or with no storm clock.
    const brightness = frame.clock >= 0 ? frame.night * frame.level : 0;
    if (brightness <= 0.002) return;
    const g = this.props.flood?.grid;
    model.shaderInputs.setProps({
      cityLights: {
        ...colors,
        brightness,
        time: (frame.now / 1000) % 3600,
        zoom: this.context.viewport.zoom,
        reduce: frame.reduce ? 1 : 0,
        stepP: frame.stepP,
        stepStart: frame.stepStart,
        gridSize: g ? [g.w, g.h] : [1, 1],
        clock: frame.clock,
        hazard: HAZARD[this.props.hazard],
        zones: g ? 1 : 0,
      },
    });
    model.draw(this.context.renderPass);
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]) {
    super.finalizeState(context);
    this.free();
  }
}
