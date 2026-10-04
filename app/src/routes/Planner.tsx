import { BusDemandPanel, useBusDemand, useBusDemandLayers } from '../planner/BusDemand';
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
          <BusDemandPanel {...demand} />
          <PeopleLayerControl />
          <Legend />
        </>
      )}
    />
  );
}
