import { BusDemandPanel, useBusDemand, useBusDemandLayers } from '../planner/BusDemand';
import { CivicSignalsPanel } from '../planner/CivicSignals';
import { PeopleLayerControl, Legend } from '../ui/MapRail';
import { MapScreen } from '../ui/MapScreen';

export function Planner() {
  const demand = useBusDemand();
  const layers = useBusDemandLayers(demand.report);
  return (
    <MapScreen
      title="Where to act"
      extraLayers={layers}
      rail={() => (
        <>
          <CivicSignalsPanel />
          <BusDemandPanel {...demand} />
          <PeopleLayerControl />
          <Legend />
        </>
      )}
    />
  );
}
