import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PickingInfo } from '@deck.gl/core';
import type { Cell, Site } from '@shared/types';
import type { MapData } from '../data';
import { useMapUi } from '../store';
import { SITE_BUILDING_ZOOM, loadSiteBuildings } from './detail';
import { dataPoints } from './frame';
import { HOSPITAL_LABEL_ZOOM, cellsLayer, existingSheltersLayers, hexFade, hoodLayer, hospitalLayers, sitesLayer } from './layers';

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
  const nameZoom = useMapUi((s) => s.zoom >= 12);
  const selectedHood = useMapUi((s) => s.selectedHood);
  const selectHood = useMapUi((s) => s.selectHood);
  const fade = useMapUi((s) => hexFade(s.zoom));

  const frame = useMemo(() => (data ? dataPoints(data) : null), [data]);
  // From z15 a site with a real building draws as that building (map/detail.ts); its square hides.
  const closeUp = useMapUi((s) => s.zoom >= SITE_BUILDING_ZOOM);
  const [outlined, setOutlined] = useState<Set<string> | null>(null);
  useEffect(() => {
    let live = true;
    loadSiteBuildings().then(
      (b) => live && setOutlined(new Set(b.map((x) => x.id))),
      () => {}, // detail.ts warns; every site keeps its square
    );
    return () => {
      live = false;
    };
  }, []);
  // Candidate sites are the shelter targets: they show only while a shelter is being placed, and
  // only the ones that stay dry (a shelter in a building that floods helps no one).
  useEffect(() => useMapUi.setState({ siteTargets: targetingSites }), [targetingSites]);
  const sites = useMemo(() => {
    const dry = (data?.sites ?? []).filter((s) => s.floodStep === null || s.floodStep > 3);
    const shown = closeUp && outlined ? dry.filter((s) => !outlined.has(s.id)) : dry;
    return sitesLayer(shown, { targeting: targetingSites, visible: targetingSites });
  }, [data, targetingSites, closeUp, outlined]);
  const hospitals = useMemo(
    () => hospitalLayers(data?.hospitals ?? [], showFacilities, labelZoom ? HOSPITAL_LABEL_ZOOM : 0, night),
    [data, showFacilities, labelZoom, night],
  );

  // Order: invisible pick target / people fill, selected neighborhood. The water is part of the
  // basemap style (map/flood.ts), under every deck.gl layer.
  const under = useMemo(() => {
    if (!data) return [];
    return [cellsLayer(data.cells, metric, showPeople, fade), hoodLayer(data.cells, selectedHood, fade)];
  }, [data, metric, showPeople, selectedHood, fade]);
  const base = under;

  // Registered shelters already in place: always shown, they are part of the city's answer.
  const existing = useMemo(() => existingSheltersLayers(data?.existingShelters ?? [], nameZoom ? 12 : 0), [data, nameZoom]);

  // Facilities on top: hospitals, existing shelters, then sites.
  const layers = useMemo(() => (data ? [...base, ...hospitals, ...existing, sites] : []), [data, base, hospitals, existing, sites]);

  const onClick = useCallback(
    (info: PickingInfo) => {
      if (!data) return;
      if (info.layer?.id === 'cells') selectHood((info.object as Cell).hood);
      else if (info.layer?.id === 'sites' || info.layer?.id === 'existing-shelters') selectHood(data.cells[(info.object as Site).cell]?.hood ?? null);
      else selectHood(null);
    },
    [data, selectHood],
  );

  return { layers, base, under, hospitals, existing, sites, frame, onClick };
}
