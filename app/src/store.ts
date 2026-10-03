import { create } from 'zustand';
import type { HeightMetric } from './map/layers';

interface MapUi {
  metric: HeightMetric;
  selectedHood: string | null;
  setMetric: (m: HeightMetric) => void;
  selectHood: (hood: string | null) => void;
}

export const useMapUi = create<MapUi>((set) => ({
  metric: 'pop',
  selectedHood: null,
  setMetric: (metric) => set({ metric }),
  selectHood: (selectedHood) => set({ selectedHood }),
}));
