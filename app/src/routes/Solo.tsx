import { PeopleLayerControl, Legend, NeighborhoodCard } from '../ui/MapRail';
import { MapScreen } from '../ui/MapScreen';

export function Solo() {
  return (
    <MapScreen
      title="Flood, solo"
      rail={({ data }) => (
        <>
          <PeopleLayerControl />
          {data ? <NeighborhoodCard cells={data.cells} /> : <p className="text-15">Loading the map.</p>}
          <Legend />
        </>
      )}
    />
  );
}
