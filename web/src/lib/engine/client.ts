import type { ResolvedEvents } from "./events";
import type { EnginePlan } from "./plan";
import type { SimResult } from "./simulate";
import type { BotResult, ReferenceResult, WorkerRequest } from "./worker-types";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "Engine worker failed"));
    pending.clear();
  };
  return worker;
}

type RequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id" | "origin"> : never) : never;

function call<T>(body: RequestBody): Promise<T> {
  const id = ++seq;
  const w = getWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...body, id, origin: window.location.origin });
  });
}

export const engine = {
  simulate: (cityId: string, plan: EnginePlan, events: ResolvedEvents, recordTrips = true) =>
    call<SimResult>({ type: "simulate", cityId, plan, events, recordTrips }),
  reference: (cityId: string, events: ResolvedEvents, playerCrossings: number[]) =>
    call<ReferenceResult>({ type: "reference", cityId, events, playerCrossings }),
  bots: (cityId: string, events: ResolvedEvents) => call<BotResult[]>({ type: "bots", cityId, events }),
};
