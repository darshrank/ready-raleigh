import { HeightToggle, Legend } from '../ui/MapRail';
import { MapScreen } from '../ui/MapScreen';

export function Planner() {
  return (
    <MapScreen
      title="Where to act"
      rail={() => (
        <>
          <p className="text-15">
            No plays yet. Sites ranked by where residents and the data agree appear here after the
            first round.
          </p>
          <HeightToggle />
          <Legend />
        </>
      )}
    />
  );
}
