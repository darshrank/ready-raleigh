// The facts the news desk sends to POST /api/news: the storm's helicopter stops and the platforms
// of the mayors in it, all computed here from the engine's storm. Gemini only phrases them.
import { engineIndex } from '@shared/engine';
import type { MayorPlatform, NewsFacts } from '@shared/news';
import type { Placement } from '@shared/types';
import type { MapData } from '../data';
import { aboutEn, aboutHi } from '../news';
import { roadLabel } from '../plan/targets';
import type { Story } from '../story';
import { clockLabel, stormHour } from './clock';
import { templateReport } from './NewsDesk';
import type { Storm } from './sim';

/** A candidate in a room, for the rivals' platforms. */
export interface Mayor {
  name: string;
  placements: Placement[];
}

const uniq = (xs: string[]) => [...new Set(xs)];

/** "Enloe High School (Five Points)". */
function siteLabel(data: MapData, site: { name: string; cell: number }): string {
  const hood = data.cells[site.cell]?.hood;
  return hood ? `${site.name} (${hood})` : site.name;
}

export function platform(data: MapData, name: string | null, placements: Placement[]): MayorPlatform {
  const idx = engineIndex(data);
  const shelters: string[] = [];
  const busPickups: string[] = [];
  const roads: string[] = [];
  for (const p of placements) {
    if (p.type === 'shelter' && p.siteId !== undefined) {
      const site = idx.sites.get(p.siteId);
      if (site) shelters.push(siteLabel(data, site));
    } else if (p.type === 'bus_pickup' && p.cell !== undefined) {
      const hood = data.cells[p.cell]?.hood;
      if (hood) busPickups.push(hood);
    } else if (p.type === 'road_protection' && p.roadId !== undefined) {
      const road = idx.roads.get(p.roadId);
      if (road) roads.push(roadLabel(data, road));
    }
  }
  return { name, shelters, busPickups: uniq(busPickups), roads };
}

export function newsFacts(storm: Storm, data: MapData, story: Story, placements: Placement[], mayor: string | null, rivals: Mayor[] = []): NewsFacts {
  const idx = engineIndex(data);
  const mine = platform(data, mayor, placements);
  const shelterSites = placements.flatMap((p) => {
    const site = p.type === 'shelter' && p.siteId !== undefined ? idx.sites.get(p.siteId) : undefined;
    return site ? [site] : [];
  });
  return {
    city: story.name,
    hazard: story.hazard,
    mayor: mine,
    rivals: rivals.map((r) => platform(data, r.name, r.placements)),
    reports: storm.events.map((e, k) => {
      const step = storm.timeline.find((s) => s.step === e.step);
      const stranded = step ? Math.round(step.strandedPeople) : 0;
      return {
        what: e.about.kind,
        name: e.about.name,
        time: clockLabel(stormHour(e.fly)),
        // Lower case: the count usually sits mid-sentence ("... leaving about 1,200 stranded").
        stranded: stranded > 0 ? { en: aboutEn(stranded).replace(/^About/, 'about'), hi: aboutHi(stranded) } : null,
        heldRoads: uniq((step?.heldRoadIds ?? []).flatMap((id) => {
          const r = idx.roads.get(id);
          return r ? [roadLabel(data, r)] : [];
        })),
        sheltersOpen: shelterSites
          .filter((s) => s.floodStep === null || s.floodStep > e.step)
          .map((s) => siteLabel(data, s)),
        plain: { en: templateReport(storm, story, 'en', k), hi: templateReport(storm, story, 'hi', k) },
      };
    }),
  };
}
