// The world's deck.gl layers and lights, owned by FloodView (map/flood.ts). MapView draws
// `layers()` under its route's layers and passes `lights.effect` to deck.gl.
//
// Layer instances are made once and cloned only when a prop really changes (the camera tilts,
// a site's height is found); per-frame changes go through `frame` (state.ts) into uniforms.
import type { Layer } from '@deck.gl/core';
import { earcut } from '@math.gl/polygon';
import { loadMapData } from '../data';
import { onSiteSolids, type SiteSolid } from '../map/detail';
import { siteTints } from '../map/basemap';
import type { Tokens } from '../tokens';
import { BuildingLayer, buildingMaterial, buildingPaint, buildingsLayer, BUILDINGS_MIN_ZOOM } from './buildings';
import { buildSolids, seedOf, type SolidPart } from './solids';
import { WorldLights } from './lights';
import { WORLD_BEFORE } from './state';
import { tileTemplates } from './tiles';

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
  private buildings: Layer | null = null;
  private sites: Layer[] = [];
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
        this.buildings = buildingsLayer(templates, t, [w - m, s - m, e + m, n + m]).clone({ visible: false });
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
    this.current = [...(this.buildings ? [this.buildings] : []), ...this.sites];
    for (const cb of this.listeners) cb(this.current);
  }
}
