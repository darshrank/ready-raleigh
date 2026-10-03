import { HeightToggle, Legend, NeighborhoodCard } from '../ui/MapRail';
import { MapScreen } from '../ui/MapScreen';

export function Solo() {
  return (
    <MapScreen
      title="Flood, solo"
      rail={({ data }) => (
        <>
          <HeightToggle />
          {data ? <NeighborhoodCard cells={data.cells} /> : <p className="text-15">Loading the map.</p>}
          <Legend />
        </>
      )}
    />
  );
}
