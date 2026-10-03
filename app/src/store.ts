import { create } from 'zustand';
import type { PeopleMetric } from './map/layers';

interface MapUi {
  /** "Who lives here" population fill. Off by default: the map comes first. */
  showPeople: boolean;
  metric: PeopleMetric;
  /** Tilted 3D camera. Off by default (top-down). */
  tilt: boolean;
  selectedHood: string | null;
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
  setShowPeople: (showPeople) => set({ showPeople }),
  setMetric: (metric) => set({ metric }),
  setTilt: (tilt) => set({ tilt }),
  selectHood: (selectedHood) => set({ selectedHood }),
}));
