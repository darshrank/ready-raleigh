// The world's deck.gl layers and lights, owned by FloodView (map/flood.ts). MapView draws
// `layers()` under its route's layers and passes `lights.effect` to deck.gl.
//
// Layer instances are made once and cloned only when a prop really changes (the camera tilts,
// a site's height is found); per-frame changes go through `frame` (state.ts) into uniforms.
import type { Layer } from '@deck.gl/core';
import type { FeatureCollection } from 'geojson';
import { earcut } from '@math.gl/polygon';
import { loadMapData } from '../data';
import { onSiteSolids, type SiteSolid } from '../map/detail';
import { siteTints } from '../map/basemap';
import type { Hazard } from '../story';
import type { Tokens } from '../tokens';
import { BuildingLayer, buildingMaterial, CityLayer, buildingPaint, buildingsLayer, BUILDINGS_MIN_ZOOM } from './buildings';
import { CityLightsLayer } from './cityLights';
import type { LightsData } from './cityLightsData';
import { buildSolids, seedOf, type SolidPart } from './solids';
import { WorldLights } from './lights';
import { WORLD_BEFORE } from './state';
import { tileTemplates } from './tiles';
import type { FloodData } from './floodData';
import { submergedLayers } from './submerged';
import { WaterLayer } from './water';

/** Shelter site footprints (lng/lat polygons) as solid parts, roofs triangulated here (216 sites). */
function* siteParts(solids: SiteSolid[]): Generator<SolidPart> {
  for (const s of solids) {
    const rings = s.polygon.map((ring) => ring.flat());
    const flat = rings.flat();
    const holes: number[] = [];
    let n = 0;
    for (const r of rings.slice(0, -1)) holes.push((n += r.length / 2));
    yield { rings, triangles: earcut(flat, holes, 2), height: s.height, seed: seedOf(flat[0]!, flat[1]!) };
  }
}

export class World {
  readonly lights: WorldLights;
  private threeD = false;
  private buildings: CityLayer | null = null;
  private sites: BuildingLayer[] = [];
  private water: Layer | null = null;
  /** The flood worker's data: the water, and the buildings' wet stains. */
  private flood: FloodData | null = null;
  private submerged: Layer[] = [];
  /** The city's lights at night (cityLights.ts). */
  private cityLights: Layer | null = null;
  private current: Layer[] = [];
  private listeners = new Set<(layers: Layer[]) => void>();
  private stop: (() => void)[] = [];

  constructor(private t: Tokens) {
    this.lights = new WorldLights(t);
    // The study area: the shelter sites' extent and 2 km around it.
    Promise.all([tileTemplates(), loadMapData()]).then(
      ([templates, data]) => {
        let [w, s, e, n] = [180, 90, -180, -90];
        for (const p of data.sites) [w, s, e, n] = [Math.min(w, p.lon), Math.min(s, p.lat), Math.max(e, p.lon), Math.max(n, p.lat)];
        const m = 0.02;
        this.buildings = buildingsLayer(templates, t, [w - m, s - m, e + m, n + m], this.flood).clone({ visible: false });
        this.emit();
      },
      (e: unknown) => console.warn('3D buildings did not load:', e),
    );
    this.stop.push(onSiteSolids((s) => this.setSites(s)));
  }

  destroy() {
    for (const f of this.stop) f();
    this.listeners.clear();
  }

  /** The world's layers, in draw order (all in the WORLD_BEFORE slot). */
  layers(): Layer[] {
    return this.current;
  }

  /** Called with the new layer list whenever it changes (not per frame). */
  onLayers(cb: (layers: Layer[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** The camera tilted past TILT_3D (3D city on) or back to top-down. */
  setThreeD(on: boolean) {
    if (on === this.threeD) return;
    this.threeD = on;
    this.sites = this.sites.map((l) => l.clone({ visible: on }));
    this.emit();
  }

  /** The storm water (world/water.ts), once the flood worker has built it. */
  setWater(data: FloodData) {
    this.flood = data;
    this.water = new WaterLayer({ id: 'world-water', flood: data, tokens: this.t, ...{ beforeId: WORLD_BEFORE } });
    // Walls that stand in the water keep a wet stain (world/stains.ts).
    this.buildings = this.buildings?.clone({ flood: data }) ?? null;
    this.sites = this.sites.map((l) => l.clone({ flood: data }));
    this.emit();
  }

  /**
   * The city's lights at night, once the flood worker has built them (every city); they go dark
   * as the hazard's zones (`zones`, the same arrival textures as the water) reach them.
   */
  setLights(data: LightsData, zones: FloodData, hazard: Hazard) {
    this.cityLights = new CityLightsLayer({ id: 'world-city-lights', lights: data, flood: zones, hazard, tokens: this.t, ...{ beforeId: WORLD_BEFORE } });
    this.emit();
  }

  /** The streets under water up to step `k`, as clipped from the loaded tiles (not per frame). */
  setSubmerged(runs: FeatureCollection, k: number) {
    this.submerged = submergedLayers(runs, k, this.t);
    this.emit();
  }

  /** Shelter sites stand out in 3D (F1): their own building in the site tint by day. */
  private setSites(solids: SiteSolid[]) {
    const { rgb } = this.t;
    const tints = siteTints(rgb);
    const material = buildingMaterial(this.t);
    this.sites = (['dry', 'floods'] as const).map(
      (kind) =>
        new BuildingLayer({
          id: `world-sites-${kind}`,
          solids: buildSolids(siteParts(solids.filter((s) => s.floods === (kind === 'floods')))),
          material,
          // In the storm they turn to the night wall color with every other building.
          paint: buildingPaint(this.t, { day: tints[kind], night: rgb['wall-night'] }),
          visible: this.threeD,
          flood: this.flood,
          minZoom: BUILDINGS_MIN_ZOOM,
          ...{ beforeId: WORLD_BEFORE }, // @deck.gl/mapbox interleaving prop
        }),
    );
    this.emit();
  }

  private emit() {
    // Dev: ?nocity leaves the tiled city out (frame-time comparisons).
    const city = this.threeD && !(import.meta.env.DEV && /[?&]nocity\b/.test(location.search));
    if (this.buildings && this.buildings.props.visible !== city) this.buildings = this.buildings.clone({ visible: city });
    // Draw order: the water, the streets under it, then the buildings (which hide what is behind
    // them), then the lights, added over everything (they glow over the roofs from the overview).
    this.current = [
      ...(this.water ? [this.water] : []),
      ...this.submerged,
      ...(this.buildings ? [this.buildings] : []),
      ...this.sites,
      ...(this.cityLights ? [this.cityLights] : []),
    ];
    for (const cb of this.listeners) cb(this.current);
  }
}
