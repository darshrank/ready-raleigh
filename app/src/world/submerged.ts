// Streets under water (DESIGN.md "Water", flooded roads) for the realistic water: a dark band on
// the street with a flowing dash along its direction, drawn above the water and below labels.
// The streets come from FloodView's clipping of the loaded tiles (map/flood.ts clipStreets), set
// when a step's water arrives or new street tiles load, never per frame. The dash flows and the
// day/night colors change through uniforms (FlowExtension).
import { LayerExtension, type Layer, type UpdateParameters } from '@deck.gl/core';
import { PathLayer } from '@deck.gl/layers';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import { unit, type RGB, type Tokens } from '../tokens';
import { frame, WORLD_BEFORE } from './state';

type Vec3 = [number, number, number];
interface FlowOpts {
  day: Vec3;
  night: Vec3;
  /** 0: a solid band; else dashes this many line widths long, flowing. */
  dash: number;
}

const flowBlock = /* glsl */ `\
layout(std140) uniform flowUniforms {
  vec3 day;
  vec3 night;
  float mixNight;
  float time;
  float dash;
  float calm;
} flow;
`;

const flowModule = {
  name: 'flow',
  vs: flowBlock,
  fs: flowBlock,
  uniformTypes: { day: 'vec3<f32>', night: 'vec3<f32>', mixNight: 'f32', time: 'f32', dash: 'f32', calm: 'f32' },
} as const;

const inject = {
  'fs:DECKGL_FILTER_COLOR': /* glsl */ `
  color.rgb = mix(flow.day, flow.night, flow.mixNight);
  if (flow.dash > 0.0) {
    // geometry.uv.y runs along the street in line widths; the dashes slide that way.
    float period = flow.dash * 3.0;
    float at = mod(geometry.uv.y - (flow.calm > 0.5 ? 0.0 : flow.time * 2.2), period);
    float aa = max(fwidth(geometry.uv.y), 1e-3);
    color.a *= smoothstep(0.0, aa, at) * (1.0 - smoothstep(flow.dash - aa, flow.dash, at));
  }
`,
};

class FlowExtension extends LayerExtension<FlowOpts> {
  static extensionName = 'FlowExtension';
  getShaders() {
    return { modules: [flowModule], inject };
  }
  draw(this: Layer, _params: unknown, ext: FlowExtension) {
    const o = ext.opts;
    this.setShaderModuleProps({
      flow: { day: o.day, night: o.night, mixNight: frame.night, time: (frame.now / 1000) % 3600, dash: o.dash, calm: frame.reduce ? 1 : 0 },
    });
  }
}

interface Run {
  path: number[][];
  step: number;
}

/** The submerged street runs up to step `k` as two path layers: the band and its flowing dashes. */
export function submergedLayers(runs: FeatureCollection, k: number, t: Tokens): Layer[] {
  const { rgb } = t;
  const data: Run[] = (runs.features as Feature<LineString, { step: number }>[])
    .filter((f) => f.properties.step > 0 && f.properties.step <= k)
    .map((f) => ({ path: f.geometry.coordinates, step: f.properties.step }));
  const band = (a: RGB, b: RGB, s: number): Vec3 => unit([0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * s)) as RGB);
  const common = {
    data,
    getPath: (d: Run) => d.path,
    widthUnits: 'meters' as const,
    capRounded: false,
    jointRounded: true,
    getColor: [255, 255, 255, 255] as [number, number, number, number],
    parameters: { depthCompare: 'always' as const },
    beforeId: WORLD_BEFORE,
    visible: data.length > 0,
  };
  return [
    new PathLayer<Run>({
      ...common,
      id: 'world-submerged',
      getWidth: 9,
      widthMinPixels: 1.6,
      widthMaxPixels: 18,
      opacity: 0.85,
      extensions: [new FlowExtension({ day: band(rgb['water-day-deep'], rgb.shadow, 0.35), night: band(rgb['water-night-deep'], rgb.shadow, 0.3), dash: 0 })],
    } as never),
    new PathLayer<Run>({
      ...common,
      id: 'world-submerged-flow',
      getWidth: 3,
      widthMinPixels: 0.8,
      widthMaxPixels: 5.5,
      // Day: --bond dashes; night: --storm-glow (DESIGN.md flooded roads).
      extensions: [new FlowExtension({ day: unit(rgb.bond), night: unit(rgb['storm-glow']), dash: 2 })],
    } as never),
  ] as unknown as Layer[];
}

export type { UpdateParameters };
