/**
 * Turns an evaluated plan into an animation timeline for deck.gl:
 * water rising stage by stage, roads closing as water reaches them,
 * residents (one dot per CONFIG.simulation.peoplePerDot people) travelling
 * real road routes to their shelter, and stranded residents turning red.
 */
import { CONFIG } from '../config'
import type { Placement } from '../shared/types'
import { pathTo, type Tree } from './dijkstra'
import type { Evaluation, FloodModel } from './flood'
import { edgeCoords } from './world'

export interface Trip {
  path: [number, number][]
  timestamps: number[]
  mode: 'car' | 'walk' | 'bus'
  people: number
  arrive: number
  shelter: number
}

export interface StrandDot {
  position: [number, number]
  time: number
  people: number
  nocar: boolean
}

export interface SimRoad {
  edge: number
  path: [number, number][]
  closeLevel: number
  protected: boolean
}

export interface Simulation {
  duration: number
  stageStart: number[]
  levels: number[]
  trips: Trip[]
  strands: StrandDot[]
  roads: SimRoad[]
  /** cumulative people protected / stranded by time (sorted by time) */
  arrivals: { time: number; people: number }[]
  strandEvents: { time: number; people: number }[]
  shelters: { position: [number, number]; capacity: number; label?: string }[]
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function levelAt(sim: Simulation, t: number): number {
  const { stageStart, levels } = sim
  const sps = CONFIG.simulation.secondsPerStage
  for (let k = levels.length - 1; k >= 0; k--) {
    if (t >= stageStart[k]) {
      const prev = k === 0 ? 0 : levels[k - 1]
      const f = Math.min(1, (t - stageStart[k]) / sps)
      return prev + (levels[k] - prev) * f
    }
  }
  return 0
}

export function countsAt(sim: Simulation, t: number) {
  let protectedN = 0
  let strandedN = 0
  for (const a of sim.arrivals) {
    if (a.time > t) break
    protectedN += a.people
  }
  for (const s of sim.strandEvents) {
    if (s.time > t) break
    strandedN += s.people
  }
  return { protected: protectedN, stranded: strandedN }
}

export function buildSimulation(model: FloodModel, placements: Placement[], ev: Evaluation, seed = 7): Simulation {
  const { world, levels } = model
  const g = world.graph
  const { hex } = world
  const S = CONFIG.simulation
  const K = levels.length
  const stageStart = levels.map((_, k) => 1 + k * S.secondsPerStage)
  const lim = model.limits
  const prot = new Set(placements.filter((p) => p.kind === 'road' && p.road !== undefined).map((p) => p.road!))
  const rand = mulberry32(seed)

  const treeCache = new Map<string, Tree>()
  const tree = (mode: 'drive' | 'walk', src: number, k: number, limit: number) => {
    const key = `${mode}|${src}|${k}`
    let t = treeCache.get(key)
    if (!t) {
      t = model.tree(mode, src, model.evacLevel(k), prot, limit)
      treeCache.set(key, t)
    }
    return t
  }
  const route = (t: Tree, from: number): [number, number][] | null => {
    const p = pathTo(g, t, from)
    if (!p) return null
    const out: [number, number][] = []
    for (let i = 0; i < p.edges.length; i++) {
      const c = edgeCoords(g, p.edges[i], p.nodes[i])
      out.push(...(out.length ? c.slice(1) : c))
    }
    return out
  }

  const totalPeople = ev.allocations.reduce((s, a) => s + a.people, 0) + ev.strands.reduce((s, x) => s + x.people, 0)
  const perDot = Math.max(S.peoplePerDot, totalPeople / S.maxDots)
  const jitter = (lon: number, lat: number, m: number): [number, number] => [
    lon + ((rand() - 0.5) * 2 * m) / (111320 * Math.cos((lat * Math.PI) / 180)),
    lat + ((rand() - 0.5) * 2 * m) / 110574,
  ]
  const dotsFor = (people: number) => {
    const n = people / perDot
    return Math.floor(n) + (rand() < n - Math.floor(n) ? 1 : 0)
  }

  const shelterP = ev.shelters.map((s) => s.placement)
  const busP = ev.buses.map((b) => b.placement)
  const trips: Trip[] = []
  const arrivals: { time: number; people: number }[] = []
  const driveLimit = Math.max(lim.drive, lim.ride)
  const travelToSim = (sec: number) => (sec / 60) * S.secondsPerTravelMinute

  for (const a of ev.allocations) {
    const u = model.units[a.unit]
    const k = u.stage
    const node = hex.node[u.hex]
    const shelter = shelterP[a.shelter]
    let path: [number, number][] | null
    let legSplit = 0
    if (a.mode === 'car') path = route(tree('drive', shelter.node!, k, driveLimit), node)
    else if (a.mode === 'walk') path = route(tree('walk', shelter.node!, k, lim.walk), node)
    else {
      const stop = busP[a.bus]
      const walk = route(tree('walk', stop.node!, k, lim.walk), node)
      const ride = route(tree('drive', shelter.node!, k, driveLimit), stop.node!)
      path = walk && ride ? [...walk, ...ride.slice(1)] : null
      legSplit = walk ? walk.length : 0
    }
    const n = dotsFor(a.people)
    const share = n ? a.people / n : 0
    if (!n) {
      // too few people for a dot: still count them, at a typical arrival time
      arrivals.push({ time: stageStart[k] + S.secondsPerStage * 0.35 + Math.max(0.6, travelToSim(a.time)), people: a.people })
    }
    for (let d = 0; d < n; d++) {
      const depart = stageStart[k] + rand() * S.secondsPerStage * 0.7
      const travel = Math.max(0.6, travelToSim(a.time))
      const start = jitter(hex.lon[u.hex], hex.lat[u.hex], 120)
      const p: [number, number][] = path && path.length ? [start, ...path] : [start, [shelter.lon, shelter.lat]]
      // timestamps proportional to distance; bus legs move 3x faster than the walk to the stop
      const seg: number[] = [0]
      for (let i = 1; i < p.length; i++) {
        const dx = (p[i][0] - p[i - 1][0]) * Math.cos((p[i][1] * Math.PI) / 180)
        const dy = p[i][1] - p[i - 1][1]
        const w = a.mode === 'bus' && i > legSplit ? 1 / 3 : 1
        seg.push(seg[i - 1] + Math.sqrt(dx * dx + dy * dy) * w)
      }
      const total = seg[seg.length - 1] || 1
      const timestamps = seg.map((s) => depart + (s / total) * travel)
      trips.push({ path: p, timestamps, mode: a.mode, people: share, arrive: depart + travel, shelter: a.shelter })
      arrivals.push({ time: depart + travel, people: share })
    }
  }

  const strands: StrandDot[] = []
  const strandEvents: { time: number; people: number }[] = []
  for (const s of ev.strands) {
    const u = model.units[s.unit]
    const n = dotsFor(s.people)
    const share = n ? s.people / n : 0
    if (!n) strandEvents.push({ time: stageStart[u.stage] + S.secondsPerStage * 0.75, people: s.people })
    for (let d = 0; d < n; d++) {
      // stranded residents are revealed as the water reaches their homes
      const time = stageStart[u.stage] + S.secondsPerStage * (0.5 + rand() * 0.5)
      strands.push({ position: jitter(hex.lon[u.hex], hex.lat[u.hex], 140), time, people: share, nocar: s.nocar })
      strandEvents.push({ time, people: share })
    }
  }
  arrivals.sort((a, b) => a.time - b.time)
  strandEvents.sort((a, b) => a.time - b.time)

  const peak = model.peakLevel()
  const roads: SimRoad[] = []
  for (let e = 0; e < g.nEdges; e++) {
    const cl = model.edgeCloseLevel(e)
    if (cl > peak) continue
    roads.push({ edge: e, path: edgeCoords(g, e), closeLevel: cl, protected: prot.has(g.grp[e]) })
  }

  const lastArrive = trips.reduce((m, t) => Math.max(m, t.arrive), 0)
  const duration = Math.max(stageStart[K - 1] + S.secondsPerStage + 2, lastArrive + 1.5)
  return {
    duration,
    stageStart,
    levels,
    trips,
    strands,
    roads,
    arrivals,
    strandEvents,
    shelters: ev.shelters.map((s) => ({ position: [s.placement.lon, s.placement.lat], capacity: s.capacity, label: s.placement.label })),
  }
}
