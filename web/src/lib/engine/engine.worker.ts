/// <reference lib="webworker" />
import { CITY_PACKS } from "@/cities";
import { loadCityData, type CityData } from "@/lib/data/city-data";
import type { CityId } from "@/types";
import { scanAchilles } from "./achilles";
import { makeBots } from "./bots";
import { createCoverageContext, type CoverageContext } from "./coverage";
import type { ResolvedEvents } from "./events";
import { optimizePlan } from "./optimize";
import { EMPTY_PLAN, type EnginePlan } from "./plan";
import { simulate } from "./simulate";
import type { WorkerRequest } from "./worker-types";

const cache = new Map<string, { data: CityData; ctx: CoverageContext }>();

async function ensure(cityId: CityId, origin: string) {
  let hit = cache.get(cityId);
  if (!hit) {
    const data = await loadCityData(cityId, `${origin}/data`);
    hit = { data, ctx: createCoverageContext(data) };
    cache.set(cityId, hit);
  }
  return hit;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    const { data, ctx } = await ensure(msg.cityId as CityId, msg.origin);
    let result: unknown;
    if (msg.type === "simulate") {
      result = simulate(data, msg.plan as EnginePlan, msg.events, { recordTrips: msg.recordTrips });
    } else if (msg.type === "reference") {
      const achilles = scanAchilles(data, ctx.flood, []);
      const opt = optimizePlan(ctx, achilles);
      result = {
        plan: opt.plan,
        steps: opt.steps,
        bestGainPerMillion: opt.bestGainPerMillion,
        sim: simulate(data, opt.plan, msg.events as ResolvedEvents, { recordTrips: true }),
        baseline: simulate(data, EMPTY_PLAN, msg.events as ResolvedEvents, { recordTrips: false }),
        achilles,
      };
    } else if (msg.type === "bots") {
      const center = CITY_PACKS[data.cityId].center;
      result = makeBots(data, ctx.flood, msg.events.seed, center).map((b) => ({ ...b, sim: simulate(data, b.plan, msg.events, { recordTrips: false }) }));
    }
    (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
