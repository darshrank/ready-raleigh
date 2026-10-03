import { useCallback, useMemo } from 'react';
import type { PickingInfo } from '@deck.gl/core';
import type { Cell, Site } from '@shared/types';
import type { MapData } from '../data';
import { useMapUi } from '../store';
import { dataPoints } from './frame';
import { halftoneDots } from './halftone';
import { cellHeights, floodDotsLayer, hexLayer, sitesLayer } from './layers';

/** Layers, framing points and click handling for the flood map, shared by every route that shows it. */
export function useFloodMap(data: MapData | null) {
  const metric = useMapUi((s) => s.metric);
  const selectedHood = useMapUi((s) => s.selectedHood);
  const selectHood = useMapUi((s) => s.selectHood);

  const frame = useMemo(() => (data ? dataPoints(data) : null), [data]);
  const dots = useMemo(() => (data ? halftoneDots(data.floodSteps) : []), [data]);
  const heights = useMemo(() => cellHeights(data?.cells ?? [], metric), [data, metric]);

  const layers = useMemo(() => {
    if (!data) return [];
    return [
      hexLayer(data.cells, heights, metric, selectedHood),
      floodDotsLayer(dots, heights, metric),
      sitesLayer(data.sites, heights, metric),
    ];
  }, [data, dots, heights, metric, selectedHood]);

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
