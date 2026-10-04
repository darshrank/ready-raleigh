import { useMemo, useState } from 'react';
import { BusDemandPanel, useBusDemand, useBusDemandLayers } from '../planner/BusDemand';
import { CivicSignalsPanel } from '../planner/CivicSignals';
import { type Focus, focusLayers } from '../planner/focus';
import { TopActionsPanel, usePlannerRanking, useTopActionLayers } from '../planner/TopActions';
import { PeopleLayerControl, Legend } from '../ui/MapRail';
import { MapScreen } from '../ui/MapScreen';

/**
 * Where to act: the top places (numbered pegs on the map, ranked in the rail), what residents'
 * plans revealed (civic signals on Solana), and where they want bus pickups. Pointing at any row
 * rings its place on the map.
 */
export function Planner() {
  const demand = useBusDemand();
  const top = usePlannerRanking();
  const [focus, setFocus] = useState<Focus | null>(null);
  const demandLayers = useBusDemandLayers(demand.report);
  const pegs = useTopActionLayers(top.ranking, focus);
  // Demand hexagons, then the pegs, then the ring on top of everything.
  const layers = useMemo(() => [...demandLayers, ...pegs, ...focusLayers(focus)], [demandLayers, pegs, focus]);
  return (
    <MapScreen
      title="Where to act"
      extraLayers={layers}
      rail={({ data }) => (
        <>
          <TopActionsPanel {...top} focus={focus} setFocus={setFocus} />
          <CivicSignalsPanel data={data} focus={focus} setFocus={setFocus} />
          <BusDemandPanel {...demand} focus={focus} setFocus={setFocus} />
          <PeopleLayerControl />
          <Legend />
        </>
      )}
    />
  );
}
