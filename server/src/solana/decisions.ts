// A play's decisions in plain words, for its own memo on Solana (readable in Explorer):
// "Shelter: Enloe High School (Five Points)", "Protect: Capital Boulevard", "Bus pickup: GoRaleigh stop
// New Bern Ave & Raleigh Blvd". Ids stand in when the data is not loaded.
import { type DataBundle, type Placement, engineIndex } from '@shared';

const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function decisionWords(placements: Placement[], data: DataBundle | null): string[] {
  const idx = data ? engineIndex(data) : null;
  const hood = (cell: number | undefined) => (cell !== undefined ? data?.cells[cell]?.hood : undefined);
  return placements.map((p) => {
    if (p.type === 'shelter' && p.siteId !== undefined) {
      const site = idx?.sites.get(p.siteId);
      const h = hood(site?.cell);
      return `Shelter: ${clip(site ? `${site.name}${h ? ` (${h})` : ''}` : p.siteId)}`;
    }
    if (p.type === 'road_protection' && p.roadId !== undefined) {
      const road = idx?.roads.get(p.roadId);
      return `Protect: ${clip(road && !/^unnamed road/i.test(road.name) ? road.name : p.roadId)}`;
    }
    if (p.type === 'bus_pickup') {
      const stop = p.stopId !== undefined ? idx?.stops.get(p.stopId)?.stop : undefined;
      if (stop) return `Bus pickup: ${clip(`${stop.agency} stop ${stop.name}`)}`;
      const h = hood(p.cell);
      return `Bus pickup: ${h ? `new stop in ${clip(h)}` : `cell ${p.cell}`}`;
    }
    return `${p.type}: ${p.siteId ?? p.roadId ?? p.cell}`;
  });
}
