import type { CityData } from "@/lib/data/city-data";
import { eventRuntime, type ResolvedEvents } from "./events";
import { buildFloodModel, closedAt, type FloodModel } from "./flood";
import type { SearchResult } from "./graph";
import { careNodes, type EnginePlan } from "./plan";
import { createRng, type Rng } from "./rng";

export const KIND = { car: 0, seek: 1, walk: 2, bus: 3, rescue: 4 } as const;
export const TRIP_REROUTED = 1;
export const TRIP_DELAYED = 2;

export type Fate = "protected" | "rescued" | "stranded" | "isolated" | "sheltering";

export interface AgentRecord {
  origin: number;
  zone: number;
  kind: 0 | 1 | 2;
  weight: number;
  depart: number;
  fate: Fate;
  /** Arrival hour if protected, hour stuck if stranded, isolation onset if isolated. */
  endHour: number;
  endNode: number;
  endLon: number;
  endLat: number;
  rescueHour: number;
  rerouted: boolean;
  delayed: boolean;
  shelter: number;
  s65: number;
  spov: number;
  blockedCrossing: number;
  trapped: boolean;
}

export interface Trip {
  path: number[];
  timestamps: number[];
  kind: number;
  flags: number;
  agent: number;
}

export interface SimEvent {
  hour: number;
  level: "info" | "warning" | "critical" | "success";
  title: string;
  detail: string;
  lon?: number;
  lat?: number;
  crossing?: number;
  zone?: number;
}

export interface GroupTally {
  total: number;
  protected: number;
}

export interface SimTotals {
  atRisk: number;
  protected: number;
  rescued: number;
  stranded: number;
  isolated: number;
  sheltering: number;
  g65: GroupTally;
  gPov: GroupTally;
  gNoCar: GroupTally;
  vuln: GroupTally;
}

export interface TimelineSample {
  hour: number;
  waiting: number;
  evacuating: number;
  protected: number;
  stranded: number;
  isolated: number;
}

export interface SimResult {
  seed: number;
  plan: EnginePlan;
  agents: AgentRecord[];
  trips: Trip[];
  events: SimEvent[];
  edgeClose: Float32Array;
  cellArrival: Float32Array;
  cellFire: Float32Array | null;
  shelterStats: { site: number; capacity: number; arrivals: [number, number][]; floodedAt: number; fullAt: number }[];
  busStats: { stop: number; served: number; capacity: number }[];
  rescueStats: { station: number; rescued: number }[];
  zoneAccess: { hours: number[]; share: Float32Array[] };
  hospitalAccessPeak: number;
  blockedBy: [number, number][];
  timeline: TimelineSample[];
  totals: SimTotals;
  blackout: { zones: number[]; hour: number } | null;
}

const B = 0.5;
const bucketEnd = (t: number) => (Math.floor(t / B) + 1) * B;

function sampleDelay(rng: Rng, cdf: [number, number][]): number {
  const u = rng.next();
  let prevH = 0;
  let prevP = 0;
  for (const [h, p] of cdf) {
    if (u <= p) return prevH + ((u - prevP) / (p - prevP)) * (h - prevH);
    prevH = h;
    prevP = p;
  }
  return prevH;
}

interface AgentSeed {
  origin: number;
  zone: number;
  kind: 0 | 1 | 2;
  weight: number;
  depart: number;
  s65: number;
  spov: number;
  trapped: boolean;
}

/** Representative agents split by car access and shelter need, plus any residents trapped by damage. Seeded. */
export function buildAgents(data: CityData, seed: number, trappedShare?: Float32Array | null): AgentSeed[] {
  const cfg = data.cfg;
  const rng = createRng(seed ^ 0x5bd1e995);
  const A = cfg.residentsPerAgent;
  const out: AgentSeed[] = [];
  data.origins.forEach((o, oi) => {
    const sh = data.zoneShares[o.z];
    const trapped = o.pop * (trappedShare?.[oi] ?? 0);
    const free = o.pop - trapped;
    // in heat mode the "car" group are residents who reach a cooler place on their own
    const carPop = cfg.everyoneWalks ? free * (cfg.hazard.heat?.selfCoolShare ?? 0) : free * (1 - sh.snv);
    const groups: [0 | 1 | 2, number, boolean][] = [
      [0, carPop * (1 - cfg.carShelterSeekingShare), false],
      [1, carPop * cfg.carShelterSeekingShare, false],
      [2, cfg.everyoneWalks ? free - carPop : free * sh.snv, false],
      [2, trapped, true],
    ];
    for (const [kind, total, isTrapped] of groups) {
      if (total < 5) continue;
      const k = Math.max(1, Math.round(total / A));
      const w = total / k;
      for (let j = 0; j < k; j++) {
        const older = rng.next() < sh.s65 ? cfg.olderAdultExtraDelayHours : 0;
        out.push({ origin: o.id, zone: o.z, kind, weight: w, depart: cfg.orderHour + sampleDelay(rng, cfg.departureDelayCdf) + older, s65: sh.s65, spov: sh.spov, trapped: isTrapped });
      }
    }
  });
  return out;
}

export function planHazard(data: CityData, plan: EnginePlan, events: ResolvedEvents | null): FloodModel {
  const protectedEdges = new Set<number>();
  for (const c of plan.crossings) for (const e of data.crossings[c].edges) protectedEdges.add(e);
  const rt = events ? eventRuntime(data, events) : {};
  return buildFloodModel(data, { ...rt, protectedEdges, shields: plan.shields, protectedSites: new Set(plan.protectedSites) });
}

export function simulate(data: CityData, plan: EnginePlan, events: ResolvedEvents, opts: { recordTrips?: boolean } = {}): SimResult {
  const record = opts.recordTrips ?? true;
  const { graph, cfg } = data;
  const C = cfg.coverage;
  const H = cfg.hazard;
  const flood = planHazard(data, plan, events);
  const edgeClose = flood.edgeClose;
  const order = cfg.orderHour;
  const duration = cfg.durationHours;
  const care = careNodes(data.hospitals, data.shelters, plan);

  const blockedCache = new Map<number, Uint8Array>();
  const blockedAt = (h: number) => {
    const k = Math.round(h * 100);
    let m = blockedCache.get(k);
    if (!m) {
      m = closedAt(flood, h);
      blockedCache.set(k, m);
    }
    return m;
  };

  // ---- destinations
  const safeCache = new Map<number, SearchResult>();
  const safeTree = (t: number) => {
    const h = bucketEnd(t);
    let tr = safeCache.get(h);
    if (!tr) {
      tr = graph.search({ sources: data.safeNodes, direction: "reverse", cost: "time", blocked: blockedAt(h) });
      safeCache.set(h, tr);
    }
    return { tree: tr as SearchResult | null, destOf: () => -1 };
  };

  const shelters = plan.shelters.map((site) => ({
    site,
    node: data.shelters[site].n,
    capacity: C.shelterCapacity,
    reserved: 0,
    floodAt: flood.shelterFlood[site],
    fullAt: Infinity,
    arrivals: [] as [number, number][],
  }));
  let shelterVersion = 0;
  const shelterCache = new Map<string, { tree: SearchResult | null; idx: number[] }>();
  const shelterTree = (t: number) => {
    const h = bucketEnd(t);
    const key = `${h}|${shelterVersion}`;
    let entry = shelterCache.get(key);
    if (!entry) {
      const idx = shelters.map((_, i) => i).filter((i) => shelters[i].floodAt > h && shelters[i].reserved < shelters[i].capacity);
      const tree = idx.length
        ? graph.search({ sources: idx.map((i) => shelters[i].node), direction: "reverse", cost: "time", blocked: blockedAt(h), limit: 5400 })
        : null;
      entry = { tree, idx };
      shelterCache.set(key, entry);
    }
    const { tree, idx } = entry;
    return { tree, destOf: (root: number) => idx[root] };
  };
  const reserve = (s: number, w: number, hour: number) => {
    if (s < 0) return;
    shelters[s].reserved += w;
    if (shelters[s].reserved >= shelters[s].capacity && !Number.isFinite(shelters[s].fullAt)) {
      shelters[s].fullAt = hour;
      shelterVersion++;
    }
  };
  const release = (s: number, w: number) => {
    if (s < 0) return;
    const wasFull = shelters[s].reserved >= shelters[s].capacity;
    shelters[s].reserved -= w;
    if (wasFull && shelters[s].reserved < shelters[s].capacity) shelterVersion++;
  };

  const orderBlocked = blockedAt(order);
  const walkShelterTree = shelters.length
    ? graph.search({ sources: shelters.map((s) => s.node), direction: "walk", cost: "length", blocked: orderBlocked, limit: C.walkToShelterMeters })
    : null;
  const stops = plan.busStops.map((stop) => ({ stop, node: data.busStops[stop].n, capacity: C.busCapacity, served: 0, queue: [] as { agent: number; ready: number }[] }));
  const walkBusTree = stops.length
    ? graph.search({ sources: stops.map((s) => s.node), direction: "walk", cost: "length", blocked: orderBlocked, limit: C.busWalkMeters })
    : null;

  // ---- agents
  const seeds = buildAgents(data, events.seed, flood.originTrapped);
  const agents: AgentRecord[] = seeds.map((s) => {
    const o = data.origins[s.origin];
    return { ...s, fate: "sheltering", endHour: Infinity, endNode: o.n, endLon: o.lon, endLat: o.lat, rescueHour: Infinity, rerouted: false, delayed: false, shelter: -1, blockedCrossing: -1 };
  });
  const trips: Trip[] = [];
  const blockedBy = new Map<number, number>();
  const nodeLonLat = (n: number) => [graph.lon[n], graph.lat[n]] as const;

  const addEdge = (trip: Trip, e: number, from: number, t0: number, t1: number) => {
    const c = graph.edgeCoords(e, from);
    const nPts = c.length / 2;
    if (nPts < 2) return;
    let total = 0;
    const cum = new Float64Array(nPts);
    for (let k = 1; k < nPts; k++) {
      const dx = (c[2 * k] - c[2 * k - 2]) * Math.cos((c[2 * k + 1] * Math.PI) / 180);
      const dy = c[2 * k + 1] - c[2 * k - 1];
      total += Math.hypot(dx, dy);
      cum[k] = total;
    }
    for (let k = 1; k < nPts; k++) {
      trip.path.push(c[2 * k], c[2 * k + 1]);
      trip.timestamps.push((t0 + (t1 - t0) * (total > 0 ? cum[k] / total : k / (nPts - 1))) * 60);
    }
  };
  const newTrip = (kind: number, agent: number, node: number, hour: number): Trip | null => {
    if (!record) return null;
    const [lon, lat] = nodeLonLat(node);
    const trip: Trip = { path: [lon, lat], timestamps: [hour * 60], kind, flags: 0, agent };
    trips.push(trip);
    return trip;
  };

  type TreeGetter = (t: number) => { tree: SearchResult | null; destOf: (root: number) => number };
  const travel = (startNode: number, startHour: number, getTree: TreeGetter, mode: "car" | "walk", trip: Trip | null) => {
    let t = startHour;
    let cur = startNode;
    let reroutes = 0;
    let firstBlock = -1;
    let { tree, destOf } = getTree(t);
    if (!tree || !Number.isFinite(tree.dist[cur])) return { ok: false, node: cur, hour: t, dest: -1, reroutes, firstBlock };
    let dest = destOf(tree.root[cur]);
    let guard = 0;
    while (guard++ < 20000) {
      const e = tree.viaEdge[cur];
      if (e < 0) break;
      const next = tree.viaNode[cur];
      const dt = mode === "car" ? graph.tt[e] / 3600 : graph.len[e] / C.walkSpeedMps / 3600;
      if (edgeClose[e] < t + dt) {
        if (firstBlock < 0 && data.edgeCrossing[e] >= 0) firstBlock = data.edgeCrossing[e];
        reroutes++;
        if (mode === "walk" || reroutes > 5) return { ok: false, node: cur, hour: t, dest, reroutes, firstBlock };
        ({ tree, destOf } = getTree(Math.max(t + dt, edgeClose[e] + 1e-3)));
        if (!tree || !Number.isFinite(tree.dist[cur])) return { ok: false, node: cur, hour: t, dest, reroutes, firstBlock };
        dest = destOf(tree.root[cur]);
        continue;
      }
      if (trip) addEdge(trip, e, cur, t, t + dt);
      t += dt;
      cur = next;
    }
    return { ok: true, node: cur, hour: t, dest, reroutes, firstBlock };
  };

  const strand = (a: AgentRecord, node: number, hour: number) => {
    a.fate = "stranded";
    a.endNode = node;
    a.endHour = hour;
    [a.endLon, a.endLat] = nodeLonLat(node);
  };
  const stayHome = (a: AgentRecord) => {
    const fl = flood.originFlood[a.origin];
    if (fl <= duration) strand(a, data.origins[a.origin].n, Math.max(fl, a.depart));
    else a.fate = "sheltering";
  };
  const noteBlock = (a: AgentRecord, crossing: number) => {
    if (crossing < 0) return;
    a.blockedCrossing = crossing;
    blockedBy.set(crossing, (blockedBy.get(crossing) ?? 0) + a.weight);
  };
  /** Drive to a shelter; if it fails before arrival, try once more. Callers own the reservation. */
  const driveToShelter = (node: number, hour: number, trip: Trip | null) => {
    let res = travel(node, hour, shelterTree, "car", trip);
    if (res.ok && res.dest >= 0 && shelters[res.dest].floodAt < res.hour) {
      const again = travel(res.node, res.hour, shelterTree, "car", trip);
      again.reroutes += res.reroutes + 1;
      if (again.firstBlock < 0) again.firstBlock = res.firstBlock;
      res = again;
    }
    return res;
  };

  // ---- event loop
  type Ev = { t: number; type: 0 | 1; ref: number };
  const queue: Ev[] = agents.map((a, i) => ({ t: a.depart, type: 0 as const, ref: i }));
  stops.forEach((_, si) => {
    for (let t = order + 1; t <= C.busServiceEndsHour + 1e-6; t += C.busHeadwayMinutes / 60) queue.push({ t, type: 1, ref: si });
  });
  queue.sort((a, b) => a.t - b.t || a.type - b.type);

  for (const ev of queue) {
    if (ev.type === 1) {
      const s = stops[ev.ref];
      const remaining = s.capacity - s.served;
      if (remaining <= 0) continue;
      const riders: number[] = [];
      let load = 0;
      s.queue = s.queue.filter((q) => {
        if (q.ready <= ev.t && (load === 0 || load + agents[q.agent].weight <= remaining)) {
          riders.push(q.agent);
          load += agents[q.agent].weight;
          return false;
        }
        return true;
      });
      if (!riders.length) continue;
      s.served += load;
      // heat: the bus is itself the cooling space
      if (cfg.everyoneWalks) {
        for (const r of riders) {
          const a = agents[r];
          a.fate = "protected";
          a.endHour = ev.t;
          a.endNode = s.node;
          [a.endLon, a.endLat] = nodeLonLat(s.node);
        }
        continue;
      }
      // buses go to the nearest shelter with space, or out of the hazard area if none is close
      const { tree, destOf } = shelterTree(ev.t);
      const toShelter = !!tree && tree.dist[s.node] <= C.busToShelterMaxMinutes * 60;
      const firstDest = toShelter ? destOf(tree!.root[s.node]) : -1;
      if (toShelter) reserve(firstDest, load, ev.t);
      const trip = newTrip(KIND.bus, riders[0], s.node, ev.t);
      const res = toShelter ? driveToShelter(s.node, ev.t, trip) : travel(s.node, ev.t, safeTree, "car", trip);
      if (toShelter && !res.ok) release(firstDest, load);
      else if (toShelter && res.dest !== firstDest) {
        release(firstDest, load);
        reserve(res.dest, load, res.hour);
      }
      for (const r of riders) {
        const a = agents[r];
        if (res.ok) {
          a.fate = "protected";
          a.endHour = res.hour;
          a.endNode = res.node;
          [a.endLon, a.endLat] = nodeLonLat(res.node);
          a.shelter = res.dest;
          a.rerouted = res.reroutes > 0;
          if (res.dest >= 0) shelters[res.dest].arrivals.push([res.hour, a.weight]);
        } else {
          strand(a, res.node, res.hour);
          noteBlock(a, res.firstBlock);
        }
      }
      if (trip && res.reroutes > 0) trip.flags |= TRIP_REROUTED;
      continue;
    }

    const ai = ev.ref;
    const a = agents[ai];
    const o = data.origins[a.origin];
    if (a.trapped) {
      strand(a, o.n, (H.quake?.damageHour ?? order) + 0.05);
      continue;
    }
    if (flood.originFlood[a.origin] <= a.depart) {
      strand(a, o.n, flood.originFlood[a.origin]);
      continue;
    }

    if (a.kind === KIND.car) {
      const trip = newTrip(KIND.car, ai, o.n, a.depart);
      const res = travel(o.n, a.depart, safeTree, "car", trip);
      const freeFlow = (safeTree(a.depart).tree?.dist[o.n] ?? 0) / 3600;
      if (res.ok) {
        a.fate = "protected";
        a.endHour = res.hour;
        a.endNode = res.node;
        [a.endLon, a.endLat] = nodeLonLat(res.node);
      } else if (res.reroutes === 0 && res.node === o.n) {
        if (trip) trips.pop();
        stayHome(a);
      } else {
        strand(a, res.node, res.hour);
      }
      noteBlock(a, res.firstBlock);
      a.rerouted = res.reroutes > 0;
      a.delayed = a.depart > order + 6 || (res.ok && res.hour - a.depart > Math.max(0.25, freeFlow * 1.8));
      if (trip) trip.flags = (a.rerouted ? TRIP_REROUTED : 0) | (a.delayed ? TRIP_DELAYED : 0);
      continue;
    }

    if (a.kind === KIND.seek) {
      const { tree, destOf } = shelterTree(a.depart);
      if (!tree || !(tree.dist[o.n] <= C.shelterDriveMinutes * 60)) {
        stayHome(a);
        continue;
      }
      const first = destOf(tree.root[o.n]);
      reserve(first, a.weight, a.depart);
      const trip = newTrip(KIND.seek, ai, o.n, a.depart);
      const res = driveToShelter(o.n, a.depart, trip);
      if (res.ok && res.dest !== first) {
        release(first, a.weight);
        reserve(res.dest, a.weight, res.hour);
      }
      if (res.ok) {
        a.fate = "protected";
        a.endHour = res.hour;
        a.endNode = res.node;
        [a.endLon, a.endLat] = nodeLonLat(res.node);
        a.shelter = res.dest;
        if (res.dest >= 0) shelters[res.dest].arrivals.push([res.hour, a.weight]);
      } else {
        release(first, a.weight);
        strand(a, res.node, res.hour);
      }
      noteBlock(a, res.firstBlock);
      a.rerouted = res.reroutes > 0;
      a.delayed = a.depart > order + 6;
      if (trip) trip.flags = (a.rerouted ? TRIP_REROUTED : 0) | (a.delayed ? TRIP_DELAYED : 0);
      continue;
    }

    // walkers: a shelter within walking distance, else a bus pickup
    if (walkShelterTree && Number.isFinite(walkShelterTree.dist[o.n])) {
      const si = walkShelterTree.root[o.n];
      if (shelters[si].reserved < shelters[si].capacity && shelters[si].floodAt > a.depart) {
        reserve(si, a.weight, a.depart);
        const trip = newTrip(KIND.walk, ai, o.n, a.depart);
        const res = travel(o.n, a.depart, () => ({ tree: walkShelterTree, destOf: () => si }), "walk", trip);
        if (res.ok && shelters[si].floodAt > res.hour) {
          a.fate = "protected";
          a.endHour = res.hour;
          a.endNode = res.node;
          [a.endLon, a.endLat] = nodeLonLat(res.node);
          a.shelter = si;
          shelters[si].arrivals.push([res.hour, a.weight]);
        } else {
          release(si, a.weight);
          if (res.ok && cfg.everyoneWalks) stayHome(a);
          else {
            strand(a, res.node, res.hour);
            noteBlock(a, res.firstBlock);
          }
        }
        continue;
      }
    }
    if (walkBusTree && Number.isFinite(walkBusTree.dist[o.n])) {
      const si = walkBusTree.root[o.n];
      const trip = newTrip(KIND.walk, ai, o.n, a.depart);
      const res = travel(o.n, a.depart, () => ({ tree: walkBusTree, destOf: () => si }), "walk", trip);
      if (res.ok) {
        stops[si].queue.push({ agent: ai, ready: res.hour });
        a.endNode = res.node;
        [a.endLon, a.endLat] = nodeLonLat(res.node);
        a.fate = "stranded";
        a.endHour = Infinity;
      } else {
        strand(a, res.node, res.hour);
        noteBlock(a, res.firstBlock);
      }
      continue;
    }
    stayHome(a);
  }
  for (const s of stops) {
    for (const q of s.queue) {
      const a = agents[q.agent];
      if (cfg.everyoneWalks) {
        const fl = flood.originFlood[a.origin];
        if (fl <= duration) strand(a, s.node, Math.max(q.ready, fl));
        else a.fate = "sheltering";
      } else strand(a, s.node, Math.max(q.ready, C.busServiceEndsHour));
    }
    s.queue = [];
  }

  // ---- rescue teams (high water, wellness checks, search and rescue)
  const rescueStats = plan.rescue.map((station) => ({ station, rescued: 0 }));
  if (plan.rescue.length) {
    const mid = C.rescueStartsHour + 6;
    const blocked = new Uint8Array(graph.m);
    const extra = eventRuntime(data, events).extraClosures ?? new Map();
    for (let e = 0; e < graph.m; e++) blocked[e] = edgeClose[e] <= mid && (graph.fcls[e] === 1 || extra.has(e)) && H.type !== "heat" ? 1 : 0;
    const strandedIdx = agents
      .map((_, i) => i)
      .filter((i) => agents[i].fate === "stranded" && Number.isFinite(agents[i].endHour))
      .sort((x, y) => agents[x].endHour - agents[y].endHour);
    plan.rescue.forEach((station, ti) => {
      const node = data.fire[station].n;
      const tree = graph.search({ sources: [node], direction: "forward", cost: "time", blocked, limit: C.rescueReachMinutes * 60 });
      let clock = C.rescueStartsHour;
      for (const i of strandedIdx) {
        const a = agents[i];
        if (a.fate !== "stranded") continue;
        if (rescueStats[ti].rescued + a.weight > C.rescueCapacity) continue;
        const d = tree.dist[a.endNode];
        if (!(d <= C.rescueReachMinutes * 60)) continue;
        const start = Math.max(clock, a.endHour);
        if (start > duration - 1) continue;
        const arrive = start + d / 3600;
        a.fate = "rescued";
        a.rescueHour = arrive;
        rescueStats[ti].rescued += a.weight;
        clock = arrive + d / 3600 + 0.25;
        if (record) {
          const { edges, nodes } = graph.pathToRoot(tree, a.endNode);
          const trip = newTrip(KIND.rescue, i, node, start);
          if (trip) {
            let t = start;
            for (let k = edges.length - 1; k >= 0; k--) {
              const e = edges[k];
              const dt = graph.tt[e] / 3600;
              addEdge(trip, e, nodes[k + 1], t, t + dt);
              t += dt;
            }
          }
        }
      }
    });
  }

  // ---- access to essential services through time
  const hours: number[] = [];
  for (let h = 0; h <= duration; h += 2) hours.push(h);
  const essential = (h: number) => {
    const open = shelters.filter((s) => s.floodAt > h).map((s) => s.node);
    return [...care, ...(cfg.everyoneWalks ? [] : data.safeNodes), ...open];
  };
  const accessTrees: SearchResult[] = [];
  let lastSig = "";
  let lastTree: SearchResult | null = null;
  const limitS = C.hospitalAccessMinutes * 60;
  for (const h of hours) {
    const blocked = blockedAt(h);
    let closedCount = 0;
    for (let e = 0; e < blocked.length; e++) closedCount += blocked[e];
    const sig = `${closedCount}|${shelters.filter((s) => s.floodAt > h).length}`;
    if (sig !== lastSig || !lastTree) {
      lastTree = graph.search({ sources: essential(h), direction: "reverse", cost: "time", blocked, limit: limitS });
      lastSig = sig;
    }
    accessTrees.push(lastTree);
  }
  const zonePop = new Float64Array(data.zones.length);
  for (const an of data.anchors) zonePop[an.z] += an.pop;
  const zoneShare = accessTrees.map((tree) => {
    const acc = new Float64Array(data.zones.length);
    for (const an of data.anchors) if (tree.dist[an.n] <= limitS) acc[an.z] += an.pop;
    return Float32Array.from(acc, (v, z) => (zonePop[z] > 0 ? v / zonePop[z] : 1));
  });
  const peakIdx = Math.min(hours.length - 1, Math.round(H.peakHour / 2));
  const hospTree = graph.search({ sources: care, direction: "reverse", cost: "time", blocked: blockedAt(H.peakHour), limit: limitS });
  let accPop = 0;
  let allPop = 0;
  for (const an of data.anchors) {
    allPop += an.pop;
    if (hospTree.dist[an.n] <= limitS) accPop += an.pop;
  }
  for (const a of agents) {
    if (a.fate !== "sheltering") continue;
    const n = data.origins[a.origin].n;
    if (accessTrees[peakIdx].dist[n] > limitS) {
      a.fate = "isolated";
      const k = accessTrees.findIndex((t) => t.dist[n] > limitS);
      a.endHour = hours[Math.max(0, k)];
    }
  }

  // ---- totals
  const totals: SimTotals = {
    atRisk: 0, protected: 0, rescued: 0, stranded: 0, isolated: 0, sheltering: 0,
    g65: { total: 0, protected: 0 }, gPov: { total: 0, protected: 0 }, gNoCar: { total: 0, protected: 0 }, vuln: { total: 0, protected: 0 },
  };
  for (const a of agents) {
    const w = a.weight;
    const ok = a.fate === "protected" || a.fate === "rescued";
    totals.atRisk += w;
    totals[a.fate] += w;
    totals.g65.total += w * a.s65;
    totals.gPov.total += w * a.spov;
    const noCar = cfg.everyoneWalks ? data.zoneShares[a.zone].snv : a.kind === KIND.walk ? 1 : 0;
    totals.gNoCar.total += w * noCar;
    if (ok) {
      totals.g65.protected += w * a.s65;
      totals.gPov.protected += w * a.spov;
      totals.gNoCar.protected += w * noCar;
    }
  }
  totals.vuln.total = totals.g65.total + totals.gPov.total + totals.gNoCar.total;
  totals.vuln.protected = totals.g65.protected + totals.gPov.protected + totals.gNoCar.protected;

  // ---- timeline
  const timeline: TimelineSample[] = [];
  for (let h = 0; h <= duration + 1e-6; h += 0.25) {
    const s: TimelineSample = { hour: h, waiting: 0, evacuating: 0, protected: 0, stranded: 0, isolated: 0 };
    for (const a of agents) {
      const w = a.weight;
      if (a.fate === "rescued") {
        if (h >= a.rescueHour) s.protected += w;
        else if (h >= a.endHour) s.stranded += w;
        else if (h >= a.depart) s.evacuating += w;
        else s.waiting += w;
      } else if (a.fate === "protected") {
        if (h >= a.endHour) s.protected += w;
        else if (h >= a.depart) s.evacuating += w;
        else s.waiting += w;
      } else if (a.fate === "stranded") {
        if (h >= a.endHour) s.stranded += w;
        else if (h >= a.depart && !a.trapped) s.evacuating += w;
        else s.waiting += w;
      } else if (a.fate === "isolated") {
        if (h >= a.endHour) s.isolated += w;
        else s.waiting += w;
      } else s.waiting += w;
    }
    timeline.push(s);
  }

  const events_ = eventFeed(data, plan, events, { shelters, blockedBy, rescueStats, zoneShare, hours, totals, edgeClose });
  return {
    seed: events.seed,
    plan,
    agents,
    trips,
    events: events_,
    edgeClose,
    cellArrival: flood.cellArrival,
    cellFire: flood.cellFire,
    shelterStats: shelters.map((s) => ({ site: s.site, capacity: s.capacity, arrivals: s.arrivals.sort((x, y) => x[0] - y[0]), floodedAt: s.floodAt, fullAt: s.fullAt })),
    busStats: stops.map((s) => ({ stop: s.stop, served: s.served, capacity: s.capacity })),
    rescueStats,
    zoneAccess: { hours, share: zoneShare },
    hospitalAccessPeak: allPop > 0 ? accPop / allPop : 1,
    blockedBy: [...blockedBy.entries()],
    timeline,
    totals,
    blackout: events.blackout,
  };
}

// ---------------------------------------------------------------- event feed

interface FeedCtx {
  shelters: { site: number; floodAt: number; fullAt: number }[];
  blockedBy: Map<number, number>;
  rescueStats: { station: number; rescued: number }[];
  zoneShare: Float32Array[];
  hours: number[];
  totals: SimTotals;
  edgeClose: Float32Array;
}

function eventFeed(data: CityData, plan: EnginePlan, events: ResolvedEvents, x: FeedCtx): SimEvent[] {
  const { cfg } = data;
  const H = cfg.hazard;
  const evs: SimEvent[] = [];
  const atRisk = Math.round(x.totals.atRisk).toLocaleString();
  const zoneName = (z: number) => data.zones[z]?.name ?? "a neighborhood";

  if (H.type === "flood") {
    evs.push({ hour: 0, level: "info", title: "Rain bands arrive over the Triangle", detail: "Rainfall rates climb across Wake County." });
    evs.push({ hour: cfg.orderHour, level: "warning", title: "Evacuation order issued", detail: `${atRisk} residents in the flood hazard area are told to leave.` });
  } else if (H.type === "coastal") {
    evs.push({ hour: 0, level: "info", title: "Hurricane outer bands reach Miami", detail: "Tropical-storm-force winds and heavy rain spread over Biscayne Bay." });
    evs.push({ hour: cfg.orderHour, level: "warning", title: "Evacuation order for surge zones", detail: `${atRisk} residents in surge and flood zones are told to leave.` });
    evs.push({ hour: (H.sources[1]?.t0[1] ?? 10) - (events.surgeEarly?.hours ?? 0), level: "critical", title: "Storm surge reaches the shoreline", detail: "Water pushes in from Biscayne Bay. Coastal streets go first." });
    if (events.surgeEarly) evs.push({ hour: events.surgeEarly.hour, level: "warning", title: "Surge arriving early", detail: `Forecasters move surge arrival up by ${events.surgeEarly.hours} hours.` });
  } else if (H.type === "heat") {
    evs.push({ hour: 0, level: "info", title: "Heat dome settles over the city", detail: "Heat index forecast above 105°F in Harlem and the South Bronx." });
    evs.push({ hour: cfg.orderHour, level: "warning", title: "Heat emergency declared", detail: `${atRisk} heat-vulnerable residents lack reliable cooling.` });
    evs.push({ hour: H.heat!.dangerStart, level: "critical", title: "Hottest blocks reach dangerous heat", detail: "Blocks with little shade and dense buildings heat first." });
    if (events.blackout) {
      const b = events.blackout;
      const z0 = data.zones[b.zones[0]];
      evs.push({ hour: b.hour, level: "critical", title: `Blackout across ${b.zones.length} neighborhoods`, detail: `Grid failure around ${zoneName(b.zones[0])}. Air conditioning and unprotected cooling centers lose power.`, lon: z0?.lon, lat: z0?.lat, zone: b.zones[0] });
    }
  } else {
    const q = H.quake!;
    evs.push({ hour: 0, level: "critical", title: "M7.8 earthquake on the San Andreas Fault", detail: "Strong to violent shaking (MMI VIII–IX) across San Francisco.", lon: q.epicenter[0], lat: q.epicenter[1] });
    const liqZones = data.zones.filter((z) => z.floodShare > 0.25).sort((a, b) => b.floodShare - a.floodShare).slice(0, 3);
    if (liqZones.length) evs.push({ hour: q.damageHour + 0.05, level: "critical", title: "Liquefaction on filled land", detail: `Ground fails in ${liqZones.map((z) => z.name).join(", ")}. Roads buckle and buildings tilt.`, lon: liqZones[0].lon, lat: liqZones[0].lat });
    for (const c of events.ignitions) {
      const z = data.cells.zone[c];
      evs.push({ hour: q.fire.startHour, level: "critical", title: `Fire reported near ${zoneName(z)}`, detail: "Broken gas lines ignite. Water pressure is low.", lon: data.cells.lon[c], lat: data.cells.lat[c] });
    }
    if (events.aftershock) evs.push({ hour: events.aftershock.hour, level: "warning", title: "M6.1 aftershock", detail: "Damaged roads on soft ground close." });
  }

  if (events.creekSurge) {
    const name = data.featureNames[events.creekSurge.sid] ?? "A creek";
    evs.push(
      H.type === "coastal"
        ? { hour: events.creekSurge.hour, level: "warning", title: `Pump failure on ${name}`, detail: `Canal water rises about ${events.creekSurge.hours} hours early along ${name}.` }
        : { hour: events.creekSurge.hour, level: "warning", title: `${name} rising faster than forecast`, detail: `Water arrives about ${events.creekSurge.hours} hours earlier along ${name}.` },
    );
  }
  if (events.culvert) {
    const c = data.crossings[events.culvert.crossing];
    const held = plan.crossings.includes(c.id);
    evs.push({
      hour: events.culvert.hour,
      level: held ? "success" : "critical",
      title: held ? `Protected crossing held: ${c.label}` : H.type === "coastal" ? `Canal bridge closed: ${c.label}` : `Culvert overtopped: ${c.label}`,
      detail: held ? "Your road protection kept this crossing open." : "A road outside the mapped hazard is suddenly impassable.",
      lon: c.lon,
      lat: c.lat,
      crossing: c.id,
    });
  }

  if (H.type !== "heat") {
    const crossingClose = data.crossings.map((c) => Math.min(...c.edges.map((e) => x.edgeClose[e])));
    const closed = data.crossings.filter((c) => Number.isFinite(crossingClose[c.id]) && c.id !== events.culvert?.crossing);
    // a quake closes everything at once, so list the worst few and summarize the rest
    const shown = H.type === "quake" ? 4 : 14;
    closed
      .map((c) => ({ c, impact: x.blockedBy.get(c.id) ?? 0 }))
      .filter((v) => v.impact > 0 || (v.c.cls <= 2 && !v.c.label.startsWith("Unnamed")))
      .sort((a, b) => b.impact - a.impact)
      .slice(0, shown)
      .forEach(({ c, impact }) => {
        evs.push({
          hour: crossingClose[c.id],
          level: impact > 300 ? "critical" : "warning",
          title: `${c.label} ${H.type === "quake" ? "impassable" : "no longer passable"}`,
          detail: impact > 0 ? `${Math.round(impact).toLocaleString()} evacuating residents had to reroute or stopped here.` : H.type === "quake" ? "Pavement buckled on liquefied ground." : "Water is over the roadway.",
          lon: c.lon,
          lat: c.lat,
          crossing: c.id,
        });
      });
    if (H.type === "quake" && closed.length > shown) {
      evs.push({
        hour: Math.min(...closed.map((c) => crossingClose[c.id])) + 0.01,
        level: "warning",
        title: `${closed.length - shown} more road segments impassable`,
        detail: "Pavement buckled across the liquefaction zones. Drivers detour or stop.",
      });
    }
  }

  for (const s of x.shelters) {
    const site = data.shelters[s.site];
    const generator = plan.protectedSites.includes(s.site);
    if (H.type === "heat" && events.blackout && generator) {
      const z = site.cell !== undefined && site.cell >= 0 ? data.cells.zone[site.cell] : -1;
      if (events.blackout.zones.includes(z)) evs.push({ hour: events.blackout.hour + 0.05, level: "success", title: `${site.name} running on backup power`, detail: "The generator kept this cooling center open through the blackout.", lon: site.lon, lat: site.lat });
    }
    if (s.floodAt <= cfg.durationHours) {
      const what = H.type === "heat" ? "lost power" : H.type === "quake" ? "is damaged and closes" : "flooded";
      evs.push({ hour: s.floodAt, level: "critical", title: `${site.name} ${what}`, detail: H.type === "heat" ? "The cooling center goes dark. People inside must move." : "The site closes to new arrivals.", lon: site.lon, lat: site.lat });
    }
    if (Number.isFinite(s.fullAt)) evs.push({ hour: s.fullAt, level: "warning", title: `${site.name} at capacity`, detail: `${cfg.coverage.shelterCapacity.toLocaleString()} spaces committed. Others are redirected.`, lon: site.lon, lat: site.lat });
  }
  for (const [ti, r] of x.rescueStats.entries()) {
    if (r.rescued > 0) {
      const st = data.fire[plan.rescue[ti]];
      const team = H.type === "heat" ? "Wellness teams" : H.type === "quake" ? "Search-and-rescue team" : "Rescue team";
      evs.push({ hour: cfg.coverage.rescueStartsHour, level: "success", title: `${team} from ${st.name} deployed`, detail: `${Math.round(r.rescued).toLocaleString()} ${cfg.terms.strandedVerb} residents reached.`, lon: st.lon, lat: st.lat });
    }
  }
  if (H.type !== "heat") {
    const isolated: SimEvent[] = [];
    data.zones.forEach((z, zi) => {
      const k = x.zoneShare.findIndex((s) => s[zi] < 0.5);
      if (k >= 0 && x.hours[k] > 0) {
        isolated.push({ hour: x.hours[k], level: "critical", title: `${z.name} functionally isolated`, detail: `Most of its ${z.pop.toLocaleString()} residents can no longer reach a hospital, shelter or safe ground within 30 minutes.`, lon: z.lon, lat: z.lat, zone: zi });
      }
    });
    const pop = (e: SimEvent) => data.zones[e.zone!].pop;
    evs.push(...isolated.sort((a, b) => pop(b) - pop(a)).slice(0, 6));
    if (isolated.length > 6) {
      const first = Math.min(...isolated.map((e) => e.hour));
      evs.push({ hour: first, level: "critical", title: `${isolated.length} neighborhoods losing access`, detail: "Purple neighborhoods can no longer reach a hospital, shelter or safe ground within 30 minutes." });
    }
  }
  const peakTitle = H.type === "heat" ? "Heat index peaks" : H.type === "quake" ? "Fires at their largest extent" : H.type === "coastal" ? "Surge and rain peak together" : "Flood peak";
  evs.push({ hour: H.peakHour, level: "info", title: peakTitle, detail: H.type === "heat" ? "The city stays hot well into the night." : "The hazard reaches its maximum extent." });
  return evs.sort((a, b) => a.hour - b.hour);
}
