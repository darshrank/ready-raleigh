import { useCallback, useMemo } from 'react';
import type { PickingInfo } from '@deck.gl/core';
import type { Cell, Site } from '@shared/types';
import type { MapData } from '../data';
import { useMapUi } from '../store';
import { dataPoints } from './frame';
import { halftoneDots } from './halftone';
import { cellsLayer, floodDotsLayer, hoodLayer, sitesLayer } from './layers';

/** Layers, framing points and click handling for the flood map, shared by every route that shows it. */
export function useFloodMap(data: MapData | null) {
  const metric = useMapUi((s) => s.metric);
  const showPeople = useMapUi((s) => s.showPeople);
  const selectedHood = useMapUi((s) => s.selectedHood);
  const selectHood = useMapUi((s) => s.selectHood);

  const frame = useMemo(() => (data ? dataPoints(data) : null), [data]);
  const dots = useMemo(() => floodDotsLayer(data ? halftoneDots(data.floodSteps) : []), [data]);
  const sites = useMemo(() => sitesLayer(data?.sites ?? []), [data]);

  // Order: invisible pick target / people fill, selected neighborhood, water, sites on top.
  const layers = useMemo(() => {
    if (!data) return [];
    return [cellsLayer(data.cells, metric, showPeople), hoodLayer(data.cells, selectedHood), dots, sites];
  }, [data, metric, showPeople, selectedHood, dots, sites]);

  const onClick = useCallback(
    (info: PickingInfo) => {
      if (!data) return;
      if (info.layer?.id === 'cells') selectHood((info.object as Cell).hood);
      else if (info.layer?.id === 'sites') selectHood(data.cells[(info.object as Site).cell]?.hood ?? null);
      else selectHood(null);
    },
    [data, selectHood],
  );

  return { layers, frame, onClick };
}
