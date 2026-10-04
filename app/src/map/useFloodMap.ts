import { useCallback, useMemo } from 'react';
import type { PickingInfo } from '@deck.gl/core';
import type { Cell, Site } from '@shared/types';
import type { MapData } from '../data';
import { useMapUi } from '../store';
import { dataPoints } from './frame';
import { HOSPITAL_LABEL_ZOOM, cellsLayer, hoodLayer, hospitalLayers, sitesLayer } from './layers';

/**
 * Layers, framing points and click handling for the flood map, shared by every route that shows it.
 * `layers` is the full stack; routes that add their own layers (the planning phase) take the parts.
 * `night` names hospitals in the night label colors (the Dark map).
 */
export function useFloodMap(data: MapData | null, { targetingSites = false, night = false } = {}) {
  const metric = useMapUi((s) => s.metric);
  const showPeople = useMapUi((s) => s.showPeople);
  const showFacilities = useMapUi((s) => s.showFacilities);
  const labelZoom = useMapUi((s) => s.zoom >= HOSPITAL_LABEL_ZOOM);
  const selectedHood = useMapUi((s) => s.selectedHood);
  const selectHood = useMapUi((s) => s.selectHood);

  const frame = useMemo(() => (data ? dataPoints(data) : null), [data]);
  // Sites are the shelter targets, so they show while a shelter is being placed even with the
  // Facilities layer off.
  const sites = useMemo(
    () => sitesLayer(data?.sites ?? [], { targeting: targetingSites, visible: showFacilities || targetingSites }),
    [data, showFacilities, targetingSites],
  );
  const hospitals = useMemo(
    () => hospitalLayers(data?.hospitals ?? [], showFacilities, labelZoom ? HOSPITAL_LABEL_ZOOM : 0, night),
    [data, showFacilities, labelZoom, night],
  );

  // Order: invisible pick target / people fill, selected neighborhood. The water is part of the
  // basemap style (map/flood.ts), under every deck.gl layer.
  const under = useMemo(() => {
    if (!data) return [];
    return [cellsLayer(data.cells, metric, showPeople), hoodLayer(data.cells, selectedHood)];
  }, [data, metric, showPeople, selectedHood]);
  const base = under;

  // Facilities on top: hospitals, then sites.
  const layers = useMemo(() => (data ? [...base, ...hospitals, sites] : []), [data, base, hospitals, sites]);

  const onClick = useCallback(
    (info: PickingInfo) => {
      if (!data) return;
      if (info.layer?.id === 'cells') selectHood((info.object as Cell).hood);
      else if (info.layer?.id === 'sites') selectHood(data.cells[(info.object as Site).cell]?.hood ?? null);
      else selectHood(null);
    },
    [data, selectHood],
  );

  return { layers, base, under, hospitals, sites, frame, onClick };
}
