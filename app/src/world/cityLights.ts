// The city at night from the storm overview (DESIGN.md "The world"): thousands of glowing points,
// building lights and street lights (world/cityLightsData.ts, built once in the flood worker),
// drawn as one deck.gl layer of screen-sized points with additive blending.
//
// - Brightness follows the storm's night: zero by day, in planning and with no storm clock.
// - Sizes are screen pixels (1.5-3 px), so the city reads the same at every overview zoom; the
//   points fade out as the camera comes down to the street, where the windows take over.
// - Street lights are --window-lit; building lights a whiter tint of it, mostly dim with a few
//   bright ones. A faint flicker on some.
// - Everything per frame is a uniform from `frame` (state.ts); the points never change.
import { Layer, picking, project32, type DefaultProps, type LayerProps, type UpdateParameters } from '@deck.gl/core';
import type { Buffer } from '@luma.gl/core';
import { Model } from '@luma.gl/engine';
import { tint, unit, type Tokens } from '../tokens';
import type { LightsData } from './cityLightsData';
import { frame } from './state';

const uniformBlock = /* glsl */ `\
layout(std140) uniform cityLightsUniforms {
  vec3 street;
  vec3 building;
  float brightness;
  float time;
  float zoom;
  float reduce;
} cityLights;
`;

const cityLightsModule = {
  name: 'cityLights',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    street: 'vec3<f32>',
    building: 'vec3<f32>',
    brightness: 'f32',
    time: 'f32',
    zoom: 'f32',
    reduce: 'f32',
  },
} as const;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME world-city-lights-vs
in vec2 positions;
in vec2 positions64Low;
in vec2 info;
out vec3 vColor;
float lights_hash(float x) {
  return fract(sin(x * 91.17) * 43758.5453);
}
void main(void) {
  float street = info.x;
  float seed = info.y;
  // Overview to street level: full up to z14.5, gone by z15.5 (the windows take over there).
  float zoomFade = 1.0 - smoothstep(14.5, 15.5, cityLights.zoom);
  // Denser on screen when far: a little dimmer, so the city does not wash out.
  float density = mix(0.5, 0.95, smoothstep(10.5, 13.0, cityLights.zoom));
  float b = cityLights.brightness * zoomFade * density;
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

type CityLightsProps = { lights: LightsData | null; tokens: Tokens | null };

export class CityLightsLayer extends Layer<CityLightsProps & LayerProps> {
  static layerName = 'WorldCityLightsLayer';
  static defaultProps = {
    lights: { type: 'object', value: null, compare: true },
    tokens: { type: 'object', value: null, compare: false },
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
    if (params.props.lights !== params.oldProps.lights) this.upload();
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
    };
    const model = new Model(device, {
      ...this.getShaders(),
      id: this.props.id,
      topology: 'point-list',
      bufferLayout: [
        { name: 'positions', format: 'float32x2' },
        { name: 'positions64Low', format: 'float32x2' },
        { name: 'info', format: 'float32x2' },
      ],
      attributes,
      vertexCount: d.count,
      disableWarnings: true,
    });
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
    model.shaderInputs.setProps({
      cityLights: {
        ...colors,
        brightness,
        time: (frame.now / 1000) % 3600,
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
