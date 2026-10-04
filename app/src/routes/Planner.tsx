import { useMemo, useState } from 'react';
import { BusDemandPanel, useBusDemand, useBusDemandLayers } from '../planner/BusDemand';
import { CivicSignalsPanel } from '../planner/CivicSignals';
import { TopActionsPanel, usePlannerRanking, useTopActionLayers } from '../planner/TopActions';
import { PeopleLayerControl, Legend } from '../ui/MapRail';
import { MapScreen } from '../ui/MapScreen';

/**
 * Where to act: the top places (numbered pegs on the map, ranked in the rail), what residents'
 * plans revealed (civic signals on Solana), and where they want bus pickups.
 */
export function Planner() {
  const demand = useBusDemand();
  const top = usePlannerRanking();
  const [active, setActive] = useState<number | null>(null);
  const demandLayers = useBusDemandLayers(demand.report);
  const pegs = useTopActionLayers(top.ranking, active);
  // Pegs above the demand hexagons.
  const layers = useMemo(() => [...demandLayers, ...pegs], [demandLayers, pegs]);
  return (
    <MapScreen
      title="Where to act"
      extraLayers={layers}
      rail={() => (
        <>
          <TopActionsPanel {...top} active={active} setActive={setActive} />
          <CivicSignalsPanel />
          <BusDemandPanel {...demand} />
          <PeopleLayerControl />
          <Legend />
        </>
      )}
    />
  );
}
