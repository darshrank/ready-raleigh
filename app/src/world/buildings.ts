// The 3D city (tilted camera): every building from the OpenFreeMap tiles, lit by the world's
// lights, in the wall tokens. Replaces MapLibre's buildings-3d layer when REALISM is on.
//
// The geometry (roofs, walls, normals, wall coordinates) is built once per tile in a worker
// (world/solids.ts, world/tile.worker.ts); BuildingLayer only uploads it and draws it. Colors,
// the day/night mix, the zoom gate, the windows (windows.ts) and the flooded buildings' power
// (stains.ts) are uniforms, so nothing is re-uploaded per frame.
import { Layer, phongMaterial, picking, project32, type DefaultProps, type LayerProps, type UpdateParameters } from '@deck.gl/core';
import { _Tileset2D as Tileset2D } from '@deck.gl/geo-layers';
import { Buffer, type VertexArray } from '@luma.gl/core';
import { Model } from '@luma.gl/engine';
import { tint, unit, type RGB, type Tokens } from '../tokens';
import type { FloodData } from './floodData';
import type { Solids } from './solids';
import { sunVector } from './lights';
import { TIER } from './quality';
import { frame, WORLD_BEFORE } from './state';
import { stainBindings, stainModule, stainProps } from './stains';
import { windowsModule, windowsPaint } from './windows';
import { loadBuildings, TILE_MAX_ZOOM } from './tiles';

/** Buildings start at this zoom, like the basemap's footprints. */
export const BUILDINGS_MIN_ZOOM = 13;

type Vec3 = [number, number, number];
export interface BuildingPaint {
  wallDay: Vec3;
  wallNight: Vec3;
  roofDay: Vec3;
  roofNight: Vec3;
  shadowColor: Vec3;
  /** The ground shadow's strength by day (--shadow is drawn at about 25%). */
  shadowAlpha: number;
  windows: ReturnType<typeof windowsPaint>;
}

const uniformBlock = /* glsl */ `\
layout(std140) uniform buildingUniforms {
  vec3 wallDay;
  vec3 wallNight;
  vec3 roofDay;
  vec3 roofNight;
  vec3 shadowColor;
  vec3 sunDir;
  float shadowAlpha;
  float shadow;
  float night;
  float zoom;
  float minZoom;
  float farM;
} building;
`;

const buildingModule = {
  name: 'building',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    wallDay: 'vec3<f32>',
    wallNight: 'vec3<f32>',
    roofDay: 'vec3<f32>',
    roofNight: 'vec3<f32>',
    shadowColor: 'vec3<f32>',
    sunDir: 'vec3<f32>',
    shadowAlpha: 'f32',
    shadow: 'f32',
    night: 'f32',
    zoom: 'f32',
    minZoom: 'f32',
    farM: 'f32',
  },
} as const;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME world-building-vs
in vec3 positions;
in vec3 positions64Low;
in vec4 normals;
in vec4 walls;
out vec3 vCommon;
out vec3 vNormal;
out vec4 vWall;
out float vSide;
out vec3 vCamera;
out vec2 vFloodUv;
void main(void) {
  geometry.worldPosition = positions;
  vFloodUv = ((positions.xy - stain.origin) + positions64Low.xy) / stain.cellDeg / stain.gridSize;
  // Below minZoom the layer draws nothing (like a MapLibre layer's minzoom).
  if (building.zoom < building.minZoom) {
    gl_Position = vec4(0.0);
    return;
  }
  // Far away (toward the horizon), buildings sink into the ground: few pixels, no popping.
  vec4 posCommon = vec4(project_position(positions, positions64Low), 1.0);
  float distM = length(posCommon.xy) / project.commonUnitsPerMeter.x;
  posCommon.z *= 1.0 - smoothstep(building.farM * 0.7, building.farM, distM);
  // The shadow pass (R2): every roof and wall point slides down the sun's ray to just above the
  // ground, so the projected walls and roof cover exactly the building's shadow.
  if (building.shadow > 0.5) {
    posCommon.xy -= posCommon.z * building.sunDir.xy / building.sunDir.z;
    posCommon.z = 0.05 * project.commonUnitsPerMeter.z;
  }
  gl_Position = project_common_position_to_clipspace(posCommon);
  geometry.position = posCommon;
  vCommon = posCommon.xyz;
  vNormal = project_normal(normals.xyz);
  vSide = normals.w;
  vWall = walls;
  vCamera = project.cameraPosition;
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME world-building-fs
precision highp float;
in vec3 vCommon;
in vec3 vNormal;
in vec4 vWall;
in float vSide;
in vec3 vCamera;
in vec2 vFloodUv;
out vec4 fragColor;
void main(void) {
  if (building.shadow > 0.5) {
    // Overlapping shadow triangles interpolate depths that differ by rounding noise, so "less"
    // let some through twice (a darker hatch). Snapped to a coarse step, rounded away from the
    // camera, they agree, and a shadow never lands in front of a wall's foot.
    gl_FragDepth = ceil(gl_FragCoord.z * 16384.0) / 16384.0;
    // Flat --shadow; the moon's is fainter. deck.gl blends premultiplied colors.
    float a = building.shadowAlpha * (1.0 - 0.7 * building.night);
    fragColor = vec4(building.shadowColor * a, a);
    return;
  }
  vec3 wallColor = mix(building.wallDay, building.wallNight, building.night);
  vec3 roofColor = mix(building.roofDay, building.roofNight, building.night);
  vec3 base = mix(roofColor, wallColor, vSide);
  // Meters per pixel on the wall, for the window grid's edges and its fade with distance.
  float px = max(max(fwidth(vWall.x), fwidth(vWall.y)), 1e-3);
  float glow = 0.0;
  if (vSide > 0.5) {
    // Windows (windows.ts): glass panes, a third of them lit at night until the power goes out.
    vec2 w = windows_at(vWall, px);
    // By day the glass also takes some of the sky's light, so it reads lighter than the token.
    base = mix(base, mix(windows.glassDay, windows.glassNight, building.night), w.x * mix(0.7, 1.0, building.night));
    glow = w.x * w.y * building.night * (1.0 - stain_dark(vFloodUv, vWall.w));
  }
  vec3 lit = lighting_getLightColor(base, vCamera, vCommon, normalize(vNormal));
  // Lit windows give their own light: not shaded by the sun or the moon.
  fragColor = vec4(mix(lit, windows.lit, glow), 1.0);
}
`;

type Material = { ambient: number; diffuse: number; shininess: number; specularColor: RGB };

const BUFFER_LAYOUT = [
  { name: 'positions', format: 'float32x3' },
  { name: 'positions64Low', format: 'float32x3' },
  { name: 'normals', format: 'snorm8x4' },
  { name: 'walls', format: 'float32x4' },
] as const;

const SUN = sunVector();

/** Buildings sink away beyond about this many screen pixels from the view's center. */
const FAR_PX = TIER.farPx;
/** Meters from the view's center where buildings have sunk into the ground. */
function farMeters(viewport: Layer['context']['viewport']): number {
  return FAR_PX * viewport.metersPerPixel;
}

/** One Solids set on the GPU. */
interface Gpu {
  attributes: Record<'positions' | 'positions64Low' | 'normals' | 'walls', Buffer>;
  index: Buffer;
  count: number;
  /** This set's own vertex array, made the first time it is drawn after another set. */
  vao?: VertexArray;
}

function upload(device: Layer['context']['device'], s: Solids): Gpu {
  return {
    attributes: {
      positions: device.createBuffer({ data: s.positions }),
      positions64Low: device.createBuffer({ data: s.positions64Low }),
      normals: device.createBuffer({ data: s.normals }),
      walls: device.createBuffer({ data: s.walls }),
    },
    index: device.createBuffer({ usage: Buffer.INDEX, indexType: 'uint32', data: s.indices }),
    count: s.indices.length,
  };
}

function free(g: Gpu | null | undefined) {
  if (!g) return;
  g.vao?.destroy();
  for (const b of Object.values(g.attributes)) b.destroy();
  g.index.destroy();
}

/**
 * Shared by both building layers: one Model; each draw binds a Solids set's buffers and draws it,
 * so many tiles cost one set of uniform updates per frame, not one per tile.
 */
type SolidsProps = { paint: BuildingPaint; minZoom: number; material: Material; flood: FloodData | null };
abstract class SolidsLayer<P> extends Layer<P & SolidsProps & LayerProps> {
  static layerName = 'WorldSolidsLayer';
  declare state: { model: Model | null; stainOf?: FloodData | null } & Record<string, unknown>;

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, picking, phongMaterial, buildingModule, stainModule, windowsModule] });
  }

  protected model(): Model {
    if (this.state.model) return this.state.model;
    const model = new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      topology: 'triangle-list',
      bufferLayout: [...BUFFER_LAYOUT],
      vertexCount: 0,
      // deck.gl hands every layer the props of every lighting module; this one uses Phong only.
      disableWarnings: true,
    });
    this.state.model = model;
    return model;
  }

  getModels() {
    return this.state.model ? [this.state.model] : [];
  }

  /**
   * The first set draws through luma.gl (program, uniform blocks, textures, state); the others
   * reuse all of that and only bind their own vertex array: luma.gl re-resolves every uniform
   * block on each draw, which cost about 0.3 ms per tile on a throttled phone.
   */
  protected drawSets(sets: Gpu[]) {
    if (!sets.length) return;
    const model = this.model();
    const { windows, ...paint } = this.props.paint;
    const flood = this.props.flood;
    // The flood textures, once the flood worker is done (dry land until then).
    if (this.state.stainOf !== flood) {
      this.state.stainOf = flood;
      model.setBindings(stainBindings(this.context.device, flood));
    }
    const building = {
      ...paint,
      sunDir: SUN,
      night: frame.night,
      zoom: this.context.viewport.zoom,
      minZoom: this.props.minZoom,
      farM: farMeters(this.context.viewport),
    };
    // Ground shadows first (R2): the same triangles projected along the sun, blended at --shadow's
    // strength with deck.gl's blending. Depth "less" (instead of deck.gl's "less-equal") at one
    // ground height lets each pixel take one shadow, never two. The model keeps no parameters of
    // its own: changing them rebuilds its pipeline and replaced deck.gl's blend state.
    if (TIER.shadows) {
      const gl = (this.context.device as unknown as { gl: WebGL2RenderingContext }).gl;
      model.shaderInputs.setProps({ building: { ...building, shadow: 1 }, stain: stainProps(flood), windows });
      gl.depthFunc(gl.LESS);
      this.drawAll(model, sets);
      gl.depthFunc(gl.LEQUAL);
    }
    model.shaderInputs.setProps({ building: { ...building, shadow: 0 }, stain: stainProps(flood), windows });
    this.drawAll(model, sets);
  }

  /** Draws every set with the model's current uniforms and parameters. */
  private drawAll(model: Model, sets: Gpu[]) {
    const [first, ...rest] = sets;
    model.setAttributes(first!.attributes);
    model.setIndexBuffer(first!.index);
    model.setVertexCount(first!.count);
    model.draw(this.context.renderPass);
    if (!rest.length) return;
    const device = this.context.device as unknown as { gl: WebGL2RenderingContext; createVertexArray: (p: object) => VertexArray };
    const gl = device.gl;
    const pipeline = (model as unknown as { pipeline: { handle: WebGLProgram; shaderLayout: { attributes: { name: string; location: number }[] } } }).pipeline;
    gl.useProgram(pipeline.handle);
    for (const g of rest) {
      if (!g.vao) {
        const vao = device.createVertexArray({ shaderLayout: pipeline.shaderLayout, bufferLayout: [...BUFFER_LAYOUT] });
        for (const a of pipeline.shaderLayout.attributes) {
          const buffer = g.attributes[a.name as keyof Gpu['attributes']];
          if (buffer) vao.setBuffer(a.location, buffer);
        }
        vao.setIndexBuffer(g.index);
        g.vao = vao;
      }
      gl.bindVertexArray((g.vao as unknown as { handle: WebGLVertexArrayObject }).handle);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]) {
    super.finalizeState(context);
    this.state.model?.destroy();
    this.state.model = null;
  }
}

const solidsDefaults = {
  paint: { type: 'object', value: null, compare: false },
  minZoom: 0,
  material: { type: 'object', value: null, compare: false },
  flood: { type: 'object', value: null, compare: true },
};

/** Draws one fixed Solids set (the shelter sites). */
export class BuildingLayer extends SolidsLayer<{ solids: Solids | null }> {
  static layerName = 'WorldBuildingLayer';
  static defaultProps = { ...solidsDefaults, solids: { type: 'object', value: null, compare: true } } as unknown as DefaultProps<
    { solids: Solids | null } & LayerProps
  >;
  declare state: { model: Model | null; gpu: Gpu | null };

  initializeState() {
    this.state = { model: null, gpu: null };
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    if (params.props.solids === params.oldProps.solids) return;
    free(this.state.gpu);
    const s = params.props.solids;
    this.state.gpu = s && s.indices.length ? upload(this.context.device, s) : null;
  }

  draw() {
    if (this.state.gpu) this.drawSets([this.state.gpu]);
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]) {
    super.finalizeState(context);
    free(this.state.gpu);
    this.state.gpu = null;
  }
}

type CityProps = { templates: string[]; extent: [number, number, number, number] };
type TileHeader = { index: { x: number; y: number; z: number }; bbox: unknown; content: Solids | null; isVisible: boolean; userData?: { gpu?: Gpu } };

/**
 * The tiled city as one layer: deck.gl's Tileset2D picks and loads the tiles (in the tile
 * workers), and every visible tile is drawn through the one Model.
 */
export class CityLayer extends SolidsLayer<CityProps> {
  static layerName = 'WorldCityLayer';
  static defaultProps = {
    ...solidsDefaults,
    templates: { type: 'array', value: [], compare: true },
    extent: { type: 'array', value: null, compare: true },
  } as unknown as DefaultProps<CityProps & LayerProps>;
  declare state: { model: Model | null; tileset: InstanceType<typeof Tileset2D> | null };

  initializeState() {
    const tileset = new Tileset2D({
      getTileData: ({ index, signal }: { index: TileHeader['index']; signal?: AbortSignal }) => {
        const tpl = this.props.templates[(index.x + index.y) % Math.max(1, this.props.templates.length)];
        const url = tpl?.replace('{x}', String(index.x)).replace('{y}', String(index.y)).replace('{z}', String(index.z));
        return loadBuildings(url, index, signal);
      },
      // One tile zoom only (the tiles' last): switching levels mid-flight reloaded the city.
      minZoom: TILE_MAX_ZOOM,
      maxZoom: TILE_MAX_ZOOM,
      extent: this.props.extent,
      maxCacheSize: 32,
      maxRequests: 4,
      refinementStrategy: 'best-available',
      onTileLoad: () => this.setNeedsUpdate(),
      onTileUnload: (tile: TileHeader) => {
        free(tile.userData?.gpu);
        if (tile.userData) tile.userData.gpu = undefined;
      },
      onTileError: (e: unknown) => console.warn('Building tile:', e),
    } as never);
    this.state = { model: null, tileset };
  }

  shouldUpdateState({ changeFlags }: UpdateParameters<this>) {
    return changeFlags.somethingChanged;
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    // Hidden or zoomed out: nothing to load (a tileset keeps loading as long as it is updated).
    if (!this.props.visible || this.context.viewport.zoom < this.props.minZoom) return;
    this.state.tileset?.update(this.context.viewport, { zRange: null, modelMatrix: null });
  }

  draw() {
    const tiles = this.state.tileset?.tiles as TileHeader[] | undefined;
    if (!tiles) return;
    const device = this.context.device;
    const vp = this.context.viewport;
    const far = farMeters(vp);
    const { longitude: cx, latitude: cy } = vp as unknown as { longitude: number; latitude: number };
    const kx = 111_320 * Math.cos((cy * Math.PI) / 180);
    const sets: Gpu[] = [];
    for (const tile of tiles) {
      if (!tile.isVisible || !tile.content) continue;
      // Wholly beyond the sinking distance: nothing left to see.
      const b = tile.bbox as { west: number; south: number; east: number; north: number };
      const dx = Math.max(b.west - cx, 0, cx - b.east) * kx;
      const dy = Math.max(b.south - cy, 0, cy - b.north) * 111_320;
      if (Math.hypot(dx, dy) > far) continue;
      tile.userData ??= {};
      tile.userData.gpu ??= upload(device, tile.content);
      sets.push(tile.userData.gpu);
    }
    this.drawSets(sets);
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]) {
    super.finalizeState(context);
    for (const tile of (this.state.tileset?.tiles ?? []) as TileHeader[]) free(tile.userData?.gpu);
    this.state.tileset?.finalize();
  }
}

/** Wall and roof colors from the tokens: roofs a touch darker than the walls by day. */
export function buildingPaint(t: Tokens, walls?: { day: RGB; night: RGB }): BuildingPaint {
  const { rgb } = t;
  const day = walls?.day ?? rgb['wall-day'];
  const night = walls?.night ?? rgb['wall-night'];
  return {
    wallDay: unit(day),
    wallNight: unit(night),
    roofDay: unit(tint(day, rgb.shadow, 0.06)),
    roofNight: unit(tint(night, rgb.bond, 0.06)),
    shadowColor: unit(rgb.shadow),
    shadowAlpha: 0.25,
    windows: windowsPaint(t),
  };
}

/** Lit buildings: a faint warm sheen whose color comes from the foam token. */
export function buildingMaterial({ rgb }: Tokens): Material {
  const s = rgb.foam.map((v) => Math.round(v * 0.12)) as RGB;
  return { ambient: 0.74, diffuse: 0.5, shininess: 12, specularColor: s };
}

/** The tiled 3D city, inside `extent` ([w, s, e, n], the study area). */
export function buildingsLayer(templates: string[], t: Tokens, extent: [number, number, number, number], flood: FloodData | null): CityLayer {
  return new CityLayer({
    id: 'world-buildings',
    templates,
    flood,
    extent,
    paint: buildingPaint(t),
    material: buildingMaterial(t),
    minZoom: BUILDINGS_MIN_ZOOM,
    ...{ beforeId: WORLD_BEFORE }, // @deck.gl/mapbox interleaving prop
  });
}
