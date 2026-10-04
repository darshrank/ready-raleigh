import { create } from 'zustand';
import type { SiteCardInfo } from './map/detail';
import type { PeopleMetric } from './map/layers';

const SATELLITE_KEY = 'ready-raleigh:satellite';

function initialSatellite(): boolean {
  try {
    return localStorage.getItem(SATELLITE_KEY) === 'on';
  } catch {
    return false;
  }
}

interface MapUi {
  /** "Who lives here" population fill. Off by default: the map comes first. */
  showPeople: boolean;
  metric: PeopleMetric;
  /** Tilted 3D camera. Off by default (top-down). */
  tilt: boolean;
  /** Satellite imagery under the streets and names instead of the printed land. Remembered. */
  satellite: boolean;
  selectedHood: string | null;
  /** Facilities layer: hospitals and shelter sites. On by default. */
  showFacilities: boolean;
  setShowFacilities: (on: boolean) => void;
  /** Map zoom, rounded to a quarter step, for layers that change with zoom (labels). */
  zoom: number;
  setZoom: (z: number) => void;
  setShowPeople: (on: boolean) => void;
  setMetric: (m: PeopleMetric) => void;
  setTilt: (on: boolean) => void;
  setSatellite: (on: boolean) => void;
  selectHood: (hood: string | null) => void;
  /** The shelter site building under the pointer or last tapped (z15+), for the site card. */
  siteCard: SiteCardInfo | null;
  setSiteCard: (card: SiteCardInfo | null) => void;
  /**
   * Planning targets show only while their piece is armed: shelter sites (useFloodMap) and the
   * existing bus stops (Solo). The detail layers (map/detail.ts) follow these.
   */
  siteTargets: boolean;
  stopTargets: boolean;
}

export const useMapUi = create<MapUi>((set) => ({
  showPeople: false,
  metric: 'pop',
  tilt: false,
  satellite: initialSatellite(),
  selectedHood: null,
  showFacilities: true,
  setShowFacilities: (showFacilities) => set({ showFacilities }),
  zoom: 11,
  setZoom: (z) => set({ zoom: Math.round(z * 4) / 4 }),
  setShowPeople: (showPeople) => set({ showPeople }),
  setMetric: (metric) => set({ metric }),
  setTilt: (tilt) => set({ tilt }),
  setSatellite: (satellite) => {
    set({ satellite });
    try {
      localStorage.setItem(SATELLITE_KEY, satellite ? 'on' : 'off');
    } catch {
      // Not remembered; still applies now.
    }
  },
  selectHood: (selectedHood) => set({ selectedHood }),
  siteCard: null,
  setSiteCard: (siteCard) => set({ siteCard }),
  siteTargets: false,
  stopTargets: false,
}));
