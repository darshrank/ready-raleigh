import type { AchillesScan } from "./achilles";
import type { BotPlayer } from "./bots";
import type { ResolvedEvents } from "./events";
import type { OptimizeStep } from "./optimize";
import type { EnginePlan } from "./plan";
import type { SimResult } from "./simulate";

interface Base {
  id: number;
  cityId: string;
  origin: string;
}

export type WorkerRequest =
  | (Base & { type: "simulate"; plan: EnginePlan; events: ResolvedEvents; recordTrips: boolean })
  | (Base & { type: "reference"; events: ResolvedEvents; playerCrossings: number[] })
  | (Base & { type: "bots"; events: ResolvedEvents });

export interface ReferenceResult {
  plan: EnginePlan;
  steps: OptimizeStep[];
  bestGainPerMillion: number;
  sim: SimResult;
  baseline: SimResult;
  achilles: AchillesScan;
}

export type BotResult = BotPlayer & { sim: SimResult };
