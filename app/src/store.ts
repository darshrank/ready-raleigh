import { create } from 'zustand';
import type { PeopleMetric } from './map/layers';

interface MapUi {
  /** "Who lives here" population fill. Off by default: the map comes first. */
  showPeople: boolean;
  metric: PeopleMetric;
  /** Tilted 3D camera. Off by default (top-down). */
  tilt: boolean;
  selectedHood: string | null;
  /** Facilities layer: hospitals and shelter sites. On by default. */
  showFacilities: boolean;
  setShowFacilities: (on: boolean) => void;
  setShowPeople: (on: boolean) => void;
  setMetric: (m: PeopleMetric) => void;
  setTilt: (on: boolean) => void;
  selectHood: (hood: string | null) => void;
}

export const useMapUi = create<MapUi>((set) => ({
  showPeople: false,
  metric: 'pop',
  tilt: false,
  selectedHood: null,
  showFacilities: true,
  setShowFacilities: (showFacilities) => set({ showFacilities }),
  setShowPeople: (showPeople) => set({ showPeople }),
  setMetric: (metric) => set({ metric }),
  setTilt: (tilt) => set({ tilt }),
  selectHood: (selectedHood) => set({ selectedHood }),
}));
