import { useMemo, useState } from 'react';
import { useMapData } from '../data';
import { BusDemandPanel, busDemandPegs, useBusDemand } from '../planner/BusDemand';
import { CivicSignalsPanel, signalPegs, useCivicSignals } from '../planner/CivicSignals';
import type { Focus } from '../planner/focus';
import { pegLayers } from '../planner/pegs';
import { TopActionsPanel, topPegs, usePlannerRanking } from '../planner/TopActions';
import { PeopleLayerControl, Legend } from '../ui/MapRail';
import { MapScreen } from '../ui/MapScreen';

/**
 * Where to act: the top places, what residents' plans revealed (civic signals on Solana) and where
 * they want bus pickups, each as pegs on the map and a list in the rail. Pointing at a row turns
 * its peg yellow.
 */
export function Planner() {
  const { data } = useMapData(); // the same cached load as the map's
  const demand = useBusDemand();
  const top = usePlannerRanking();
  const signals = useCivicSignals();
  const [focus, setFocus] = useState<Focus | null>(null);
  const layers = useMemo(() => {
    // One layer for every peg, so the one in focus always draws on top. Bus areas first, then the
    // top places, then the (smaller, nudged) signals.
    return pegLayers('planner', [...busDemandPegs(demand.report), ...topPegs(top.ranking), ...signalPegs(data, signals.signals)], focus?.key ?? null);
  }, [demand.report, top.ranking, data, signals.signals, focus]);
  return (
    <MapScreen
      title="Where to act"
      extraLayers={layers}
      rail={() => (
        <>
          <TopActionsPanel {...top} focus={focus} setFocus={setFocus} />
          <CivicSignalsPanel {...signals} focus={focus} setFocus={setFocus} />
          <BusDemandPanel {...demand} focus={focus} setFocus={setFocus} />
          <PeopleLayerControl />
          <Legend />
        </>
      )}
    />
  );
}
