import type { Map as MaplibreMap, FlyToOptions } from "maplibre-gl";

let map: MaplibreMap | null = null;

/** Lets HUD components move the shared map camera. */
export const mapBus = {
  set(m: MaplibreMap | null) {
    map = m;
  },
  get() {
    return map;
  },
  flyTo(opts: FlyToOptions) {
    map?.flyTo({ essential: true, ...opts });
  },
};
