/**
 * Flood scenario engine.
 *
 * Water rises through CONFIG.flood.stages (metres above normal channel
 * level). A building is at risk at the first stage whose level exceeds its
 * Height Above Nearest Drainage. Its residents evacuate while the water is
 * still one stage lower, on whatever roads are open at that moment, so
 * low-lying neighbourhoods leave first and later evacuees find their routes
 * cut by roads that flooded earlier.
 *
 * A resident at risk is protected when:
 *  - they have a car and can drive to a shelter with space within
 *    shelter.driveMinutes, or
 *  - they have no car and can walk to a shelter within bus.walkMinutes, or
 *    walk to a bus pickup with space that can drive them to a shelter with
 *    space within bus.rideMinutes.
 *
 * Score = protected / at-risk, with each person weighted 1 + extra weight
 * for each vulnerable group they (statistically) belong to.
 */
import { CONFIG } from '../config'
import type { Placement } from '../shared/types'
import { dijkstra, type Tree } from './dijkstra'
import { handAt, type World } from './world'

export interface Unit {
  hex: number
  stage: number
  pop: number
  nocar: number
  /** weight per person before the no-car bonus */
  w: number
}

export type Reason =
  | 'no-shelter'      // no shelter placed at all
  | 'too-far'         // nearest shelter more than the drive limit away even on dry roads
  | 'roads-flooded'   // a shelter would be in reach if the roads were open
  | 'shelter-full'    // reachable shelters were full
  | 'no-transit'      // no car, no bus pickup or shelter within walking distance
  | 'bus-full'        // reachable bus pickups were full
  | 'shelter-flooded' // the only reachable shelters were under water

export interface Allocation {
  unit: number
  shelter: number
  bus: number // -1 when not by bus
  mode: 'car' | 'walk' | 'bus'
  people: number
  /** travel time in seconds */
  time: number
}

export interface Strand {
  unit: number
  people: number
  nocar: boolean
  reason: Reason
}

export interface GroupStat {
  atRisk: number
  protected: number
}

export interface Evaluation {
  score: number
  atRisk: number
  protected: number
  stranded: number
  atRiskW: number
  protectedW: number
  groups: { all: GroupStat; elderly: GroupStat; poverty: GroupStat; nocar: GroupStat }
  hexAtRisk: Float32Array
  hexProtected: Float32Array
  hexReason: (Reason | null)[]
  districts: { name: string; atRisk: number; protected: number }[]
  shelters: { placement: Placement; load: number; capacity: number; siteHand: number; floodedAtStage: number }[]
  buses: { placement: Placement; riders: number; capacity: number }[]
  allocations: Allocation[]
  strands: Strand[]
  spent: number
  /** hexes within drive reach of any shelter at the peak of the flood */
  coverageHexes: Uint8Array
}

type NetMode = 'drive' | 'walk'

export class FloodModel {
  readonly world: World
  readonly levels: number[]
  readonly units: Unit[] = []
  readonly unitsByHex: number[][]
  private costCache = new Map<string, Float32Array>()
  private reachCache = new Map<string, Float32Array>()
  /** max cached reach arrays (~18 KB each) */
  cacheLimit = 600
  private baseDrive: Float32Array
  private baseWalk: Float32Array

  constructor(world: World) {
    this.world = world
    this.levels = [...CONFIG.flood.stages]
    const { hex } = world
    const { weights } = CONFIG.scoring
    this.unitsByHex = Array.from({ length: hex.n }, () => [])
    const K = this.levels.length
    for (let h = 0; h < hex.n; h++) {
      const perStage = new Float64Array(K)
      for (let k = hex.expoStart[h]; k < hex.expoStart[h + 1]; k++) {
        const low = hex.expoBin[k] * hex.binSize
        for (let s = 0; s < K; s++) {
          if (low < this.levels[s] - CONFIG.flood.homeFloodDepth) {
            perStage[s] += hex.expoPop[k]
            break
          }
        }
      }
      const w = 1 + weights.elderly * hex.elderly[h] + weights.poverty * hex.poverty[h]
      for (let s = 0; s < K; s++) {
        if (perStage[s] < 0.5) continue
        this.unitsByHex[h].push(this.units.length)
        this.units.push({ hex: h, stage: s, pop: perStage[s], nocar: hex.nocar[h], w })
      }
    }
    const g = world.graph
    this.baseDrive = new Float32Array(g.nEdges)
    this.baseWalk = new Float32Array(g.nEdges)
    const walkMs = CONFIG.travel.walkKmh / 3.6
    for (let e = 0; e < g.nEdges; e++) {
      const cls = g.classes[g.cls[e]]
      const kmh = (CONFIG.travel.speedKmh[cls] ?? 30) * CONFIG.travel.evacuationSpeedFactor
      this.baseDrive[e] = g.len[e] / (kmh / 3.6)
      this.baseWalk[e] = cls === 'motorway' || cls === 'trunk' ? Infinity : g.len[e] / walkMs
    }
  }

  /** Water level while residents of stage k evacuate. */
  evacLevel(k: number) {
    return k === 0 ? 0 : this.levels[k - 1]
  }

  peakLevel() {
    return this.levels[this.levels.length - 1]
  }

  /** Is edge e under water at level (m), given protected road stretches? */
  edgeClosed(e: number, level: number, prot: ReadonlySet<number>) {
    const g = this.world.graph
    return g.hand[e] < level - CONFIG.flood.roadClosureDepth && !prot.has(g.grp[e])
  }

  /** Level at which edge e closes (Infinity = never). */
  edgeCloseLevel(e: number) {
    return this.world.graph.hand[e] + CONFIG.flood.roadClosureDepth
  }

  private costs(mode: NetMode, level: number, prot: ReadonlySet<number>, protKey: string) {
    const key = `${mode}|${level}|${protKey}`
    let c = this.costCache.get(key)
    if (!c) {
      c = Float32Array.from(mode === 'drive' ? this.baseDrive : this.baseWalk)
      const g = this.world.graph
      for (let e = 0; e < g.nEdges; e++) if (this.edgeClosed(e, level, prot)) c[e] = Infinity
      this.costCache.set(key, c)
    }
    return c
  }

  /**
   * Travel time (s) from `source` to every hex's access node, Infinity beyond
   * `limitSec`. Cached in compact form (one float per hex) so the optimizer
   * can keep thousands of them.
   */
  reach(mode: NetMode, source: number, level: number, prot: ReadonlySet<number>, limitSec: number): Float32Array {
    const protKey = [...prot].sort((a, b) => a - b).join(',')
    const key = `${mode}|${source}|${level}|${protKey}|${limitSec}`
    let r = this.reachCache.get(key)
    if (!r) {
      const t = dijkstra(this.world.graph, [source], this.costs(mode, level, prot, protKey), limitSec)
      const { node, n } = this.world.hex
      r = new Float32Array(n)
      for (let h = 0; h < n; h++) r[h] = t.dist[node[h]]
      if (this.reachCache.size >= this.cacheLimit) this.reachCache.delete(this.reachCache.keys().next().value!)
      this.reachCache.set(key, r)
    }
    return r
  }

  /** Full shortest-path tree, for drawing routes in the simulation. */
  tree(mode: NetMode, source: number, level: number, prot: ReadonlySet<number>, limitSec: number): Tree {
    const protKey = [...prot].sort((a, b) => a - b).join(',')
    return dijkstra(this.world.graph, [source], this.costs(mode, level, prot, protKey), limitSec)
  }

  /** Hex whose centre is nearest to a point. */
  hexAt(lon: number, lat: number): number {
    const { hex } = this.world
    const k = Math.cos((lat * Math.PI) / 180)
    let best = 0
    let bd = Infinity
    for (let h = 0; h < hex.n; h++) {
      const dx = (hex.lon[h] - lon) * k
      const dy = hex.lat[h] - lat
      const d = dx * dx + dy * dy
      if (d < bd) {
        bd = d
        best = h
      }
    }
    return best
  }

  siteHand(p: Placement) {
    return handAt(this.world.hand, p.lon, p.lat)
  }

  /** First stage at which a site is under water (levels.length = never). */
  floodStageOf(siteHand: number) {
    const k = this.levels.findIndex((l) => l > siteHand + 0.05)
    return k < 0 ? this.levels.length : k
  }

  get limits() {
    const I = CONFIG.interventions
    return {
      drive: I.shelter.driveMinutes * 60,
      walk: I.bus.walkMinutes * 60,
      ride: I.bus.rideMinutes * 60,
    }
  }

  totalAtRisk() {
    return this.units.reduce((s, u) => s + u.pop, 0)
  }

  evaluate(placements: Placement[]): Evaluation {
    const { world, levels, units } = this
    const { hex } = world
    const K = levels.length
    const lim = this.limits
    const driveLimit = Math.max(lim.drive, lim.ride)
    const prot = new Set(placements.filter((p) => p.kind === 'road' && p.road !== undefined).map((p) => p.road!))
    const noProt = new Set<number>()

    const shelterP = placements.filter((p) => p.kind === 'shelter' && p.node !== undefined && p.node >= 0)
    const busP = placements.filter((p) => p.kind === 'bus' && p.node !== undefined && p.node >= 0)
    const shelters = shelterP.map((p) => {
      const siteHand = this.siteHand(p)
      return { placement: p, load: 0, capacity: CONFIG.interventions.shelter.capacity, siteHand,
        floodedAtStage: this.floodStageOf(siteHand) }
    })
    const buses = busP.map((p) => ({ placement: p, riders: 0, capacity: CONFIG.interventions.bus.capacity,
      floodedAtStage: this.floodStageOf(this.siteHand(p)) }))

    // travel-time arrays per stage (indexed by hex)
    const busHex = busP.map((p) => this.hexAt(p.lon, p.lat))
    const sDrive: Float32Array[][] = []
    const sWalk: Float32Array[][] = []
    const bWalk: Float32Array[][] = []
    for (let k = 0; k < K; k++) {
      const lvl = this.evacLevel(k)
      sDrive.push(shelterP.map((p) => this.reach('drive', p.node!, lvl, prot, driveLimit)))
      sWalk.push(shelterP.map((p) => this.reach('walk', p.node!, lvl, prot, lim.walk)))
      bWalk.push(busP.map((p) => this.reach('walk', p.node!, lvl, prot, lim.walk)))
    }
    const dryDrive = shelterP.map((p) => this.reach('drive', p.node!, 0, noProt, driveLimit))

    // order: earliest stage first, then whoever is closest to a shelter
    const order = units.map((_, i) => i)
    const bestTime = new Float32Array(units.length).fill(Infinity)
    for (let i = 0; i < units.length; i++) {
      const u = units[i]
      for (let s = 0; s < shelters.length; s++) bestTime[i] = Math.min(bestTime[i], sDrive[u.stage][s][u.hex])
    }
    order.sort((a, b) => units[a].stage - units[b].stage || bestTime[a] - bestTime[b])

    const allocations: Allocation[] = []
    const strands: Strand[] = []
    const W = CONFIG.scoring.weights
    const usable = (s: number, k: number) => shelters[s].floodedAtStage > k

    for (const ui of order) {
      const u = units[ui]
      const node = u.hex
      const k = u.stage
      const nocarPeople = u.pop * u.nocar
      let car = u.pop - nocarPeople
      let walkers = nocarPeople

      // --- drivers
      const opts = shelters
        .map((_, s) => s)
        .filter((s) => usable(s, k) && sDrive[k][s][node] <= lim.drive)
        .sort((a, b) => sDrive[k][a][node] - sDrive[k][b][node])
      for (const s of opts) {
        if (car <= 0) break
        const take = Math.min(car, shelters[s].capacity - shelters[s].load)
        if (take <= 0) continue
        shelters[s].load += take
        car -= take
        allocations.push({ unit: ui, shelter: s, bus: -1, mode: 'car', people: take, time: sDrive[k][s][node] })
      }
      if (car > 0.01) strands.push({ unit: ui, people: car, nocar: false, reason: this.carReason(ui, opts, shelters, dryDrive, sDrive) })

      // --- no car: walk straight to a shelter
      const wopts = shelters
        .map((_, s) => s)
        .filter((s) => usable(s, k) && sWalk[k][s][node] <= lim.walk)
        .sort((a, b) => sWalk[k][a][node] - sWalk[k][b][node])
      for (const s of wopts) {
        if (walkers <= 0) break
        const take = Math.min(walkers, shelters[s].capacity - shelters[s].load)
        if (take <= 0) continue
        shelters[s].load += take
        walkers -= take
        allocations.push({ unit: ui, shelter: s, bus: -1, mode: 'walk', people: take, time: sWalk[k][s][node] })
      }
      // --- no car: bus pickup
      let busReason: Reason = 'no-transit'
      if (walkers > 0.01) {
        const bopts = buses
          .map((_, b) => b)
          // a pickup only has to be dry while this stage evacuates (water one stage lower)
          .filter((b) => buses[b].floodedAtStage >= k && bWalk[k][b][node] <= lim.walk)
          .sort((a, b) => bWalk[k][a][node] - bWalk[k][b][node])
        if (bopts.length) busReason = 'bus-full'
        for (const b of bopts) {
          if (walkers <= 0) break
          const stop = busHex[b]
          const room = buses[b].capacity - buses[b].riders
          if (room <= 0) continue
          const dests = shelters
            .map((_, s) => s)
            .filter((s) => usable(s, k) && sDrive[k][s][stop] <= lim.ride)
            .sort((a, c) => sDrive[k][a][stop] - sDrive[k][c][stop])
          if (!dests.length) {
            busReason = shelters.length ? 'roads-flooded' : 'no-shelter'
            continue
          }
          let left = Math.min(walkers, room)
          for (const s of dests) {
            if (left <= 0) break
            const take = Math.min(left, shelters[s].capacity - shelters[s].load)
            if (take <= 0) continue
            shelters[s].load += take
            buses[b].riders += take
            left -= take
            walkers -= take
            allocations.push({ unit: ui, shelter: s, bus: b, mode: 'bus', people: take,
              time: bWalk[k][b][node] + sDrive[k][s][stop] })
          }
          if (left > 0) busReason = 'shelter-full'
        }
      }
      if (walkers > 0.01) strands.push({ unit: ui, people: walkers, nocar: true, reason: busReason })
    }

    // ---- tallies
    const hexAtRisk = new Float32Array(hex.n)
    const hexProtected = new Float32Array(hex.n)
    const hexReason: (Reason | null)[] = new Array(hex.n).fill(null)
    const hexStrandMax = new Float32Array(hex.n)
    const groups = {
      all: { atRisk: 0, protected: 0 },
      elderly: { atRisk: 0, protected: 0 },
      poverty: { atRisk: 0, protected: 0 },
      nocar: { atRisk: 0, protected: 0 },
    }
    let atRiskW = 0
    let protectedW = 0
    for (const u of units) {
      hexAtRisk[u.hex] += u.pop
      groups.all.atRisk += u.pop
      groups.elderly.atRisk += u.pop * hex.elderly[u.hex]
      groups.poverty.atRisk += u.pop * hex.poverty[u.hex]
      groups.nocar.atRisk += u.pop * u.nocar
      atRiskW += u.pop * u.w + u.pop * u.nocar * W.nocar
    }
    for (const a of allocations) {
      const u = units[a.unit]
      hexProtected[u.hex] += a.people
      groups.all.protected += a.people
      groups.elderly.protected += a.people * hex.elderly[u.hex]
      groups.poverty.protected += a.people * hex.poverty[u.hex]
      if (a.mode !== 'car') groups.nocar.protected += a.people
      protectedW += a.people * u.w + (a.mode !== 'car' ? a.people * W.nocar : 0)
    }
    for (const s of strands) {
      const h = units[s.unit].hex
      if (s.people > hexStrandMax[h]) {
        hexStrandMax[h] = s.people
        hexReason[h] = s.reason
      }
    }
    const dmap = new Map<number, { name: string; atRisk: number; protected: number }>()
    for (let h = 0; h < hex.n; h++) {
      if (hexAtRisk[h] <= 0) continue
      const d = hex.district[h]
      const rec = dmap.get(d) ?? { name: hex.districts[d], atRisk: 0, protected: 0 }
      rec.atRisk += hexAtRisk[h]
      rec.protected += hexProtected[h]
      dmap.set(d, rec)
    }

    // coverage footprint (worst case: roads open at the last evacuation stage)
    const coverageHexes = new Uint8Array(hex.n)
    if (shelters.length) {
      const last = sDrive[K - 1]
      for (let h = 0; h < hex.n; h++) {
        for (let s = 0; s < shelters.length; s++) {
          if (last[s][h] <= lim.drive) {
            coverageHexes[h] = 1
            break
          }
        }
      }
    }

    const costs = CONFIG.interventions
    const spent = placements.reduce((s, p) => s + costs[p.kind].cost, 0)
    const protectedPeople = groups.all.protected
    return {
      score: atRiskW > 0 ? (100 * protectedW) / atRiskW : 0,
      atRisk: groups.all.atRisk,
      protected: protectedPeople,
      stranded: groups.all.atRisk - protectedPeople,
      atRiskW,
      protectedW,
      groups,
      hexAtRisk,
      hexProtected,
      hexReason,
      districts: [...dmap.values()].sort((a, b) => b.atRisk - a.atRisk),
      shelters: shelters.map(({ placement, load, capacity, siteHand, floodedAtStage }) =>
        ({ placement, load, capacity, siteHand, floodedAtStage })),
      buses: buses.map(({ placement, riders, capacity }) => ({ placement, riders, capacity })),
      allocations,
      strands,
      spent,
      coverageHexes,
    }
  }

  private carReason(ui: number, opts: number[], shelters: { floodedAtStage: number }[], dry: Float32Array[], wet: Float32Array[][]): Reason {
    if (!shelters.length) return 'no-shelter'
    if (opts.length) return 'shelter-full'
    const u = this.units[ui]
    const lim = this.limits.drive
    if (wet[u.stage].some((t) => t[u.hex] <= lim)) return 'shelter-flooded'
    return dry.some((t) => t[u.hex] <= lim) ? 'roads-flooded' : 'too-far'
  }
}

export const REASON_TEXT: Record<Reason, string> = {
  'no-shelter': 'no shelter has been opened',
  'too-far': `no shelter within a ${CONFIG.interventions.shelter.driveMinutes}-minute drive`,
  'roads-flooded': 'flooded roads cut them off from a shelter',
  'shelter-full': 'the shelters they could reach were full',
  'no-transit': 'they have no car and no bus pickup or shelter within walking distance',
  'bus-full': 'the bus pickups they could walk to were full',
  'shelter-flooded': 'the shelter they could reach was under water',
}
