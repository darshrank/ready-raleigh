/**
 * "Best plan the algorithm found": greedy weighted maximum coverage under the
 * budget (best score gain per dollar first), followed by a swap pass that
 * tries replacing each chosen site with every other candidate of its kind.
 * Uses the same FloodModel.evaluate as the player's plan, so the two scores
 * are directly comparable.
 */
import { CONFIG } from '../config'
import type { Placement, PlacementKind } from '../shared/types'
import type { FloodModel } from './flood'
import { distanceM, handAt } from './world'

export interface OptimizeResult {
  placements: Placement[]
  score: number
  evaluations: number
  ms: number
}

const KIND_RANK: Record<string, number> = { school: 0, community: 1, worship: 2 }

export function candidates(model: FloodModel) {
  const { world } = model
  const peak = model.peakLevel()
  // shelters: real facilities that stay dry at the peak, thinned to one per ~700 m cell
  const cells = new Map<string, Placement & { rank: number }>()
  for (const f of world.facilities) {
    if (!f.shelter) continue
    const h = handAt(world.hand, f.lon, f.lat)
    const hand = Number.isFinite(h) ? h : (f.hand ?? Infinity)
    if (hand < peak + 0.5) continue
    const key = `${Math.round(f.lon / 0.008)}|${Math.round(f.lat / 0.0065)}`
    const rank = KIND_RANK[f.kind] ?? 3
    const cur = cells.get(key)
    if (!cur || rank < cur.rank) {
      cells.set(key, { id: '', kind: 'shelter', lon: f.lon, lat: f.lat, node: f.node, label: f.name, rank })
    }
  }
  const shelters: Placement[] = [...cells.values()].map(({ rank: _r, ...p }, i) => ({ ...p, id: `opt-s${i}` }))

  // bus pickups: hexes with the most car-less residents at risk
  const { hex } = world
  const nocarAtRisk = new Float64Array(hex.n)
  for (const u of model.units) nocarAtRisk[u.hex] += u.pop * u.nocar
  const busHex = [...nocarAtRisk.keys()].filter((h) => nocarAtRisk[h] > 0).sort((a, b) => nocarAtRisk[b] - nocarAtRisk[a]).slice(0, 40)
  const buses: Placement[] = busHex.map((h, i) => ({ id: `opt-b${i}`, kind: 'bus', lon: hex.lon[h], lat: hex.lat[h], node: hex.node[h] }))

  // roads: stretches that close before the peak, ranked by the at-risk
  // residents within ~1.5 km who would still be evacuating after they close
  const closeStage = (hand: number) => model.levels.findIndex((l) => l - CONFIG.flood.roadClosureDepth > hand)
  const lateRisk = world.roads
    .filter((r) => r.hand + CONFIG.flood.roadClosureDepth < peak)
    .map((r) => {
      const k0 = closeStage(r.hand)
      let people = 0
      for (const u of model.units) {
        if (u.stage <= k0) continue
        if (distanceM(r.lon, r.lat, hex.lon[u.hex], hex.lat[u.hex]) < 1500) people += u.pop
      }
      return { r, people }
    })
    .sort((a, b) => b.people - a.people)
    .slice(0, 30)
  const roads: Placement[] = lateRisk.map(({ r }, i) =>
    ({ id: `opt-r${i}`, kind: 'road', lon: r.lon, lat: r.lat, road: r.id, label: r.name || 'Unnamed road' }))
  return { shelter: shelters, bus: buses, road: roads } as Record<PlacementKind, Placement[]>
}

export function optimize(model: FloodModel, onProgress?: (p: number, msg: string) => void): OptimizeResult {
  const t0 = performance.now()
  model.cacheLimit = Math.max(model.cacheLimit, 6000)
  const cand = candidates(model)
  const budget = CONFIG.budget
  const cost = (k: PlacementKind) => CONFIG.interventions[k].cost
  let evaluations = 0
  const score = (plan: Placement[]) => {
    evaluations++
    return model.evaluate(plan).protectedW
  }

  const all = [...cand.shelter, ...cand.bus, ...cand.road]
  const maxShelters = Math.floor(budget / cost('shelter'))

  /** Greedy best-gain-per-dollar, allowing at most `cap` shelters. */
  const greedy = (cap: number, pStart: number, pSpan: number) => {
    let plan: Placement[] = []
    let best = 0
    let spent = 0
    let step = 0
    for (;;) {
      step++
      let pick: Placement | null = null
      let pickRatio = 0
      let pickScore = best
      const used = new Set(plan.map((p) => p.id))
      const nShelters = plan.filter((p) => p.kind === 'shelter').length
      for (let i = 0; i < all.length; i++) {
        const c = all[i]
        if (used.has(c.id) || spent + cost(c.kind) > budget) continue
        if (c.kind === 'shelter' && nShelters >= cap) continue
        const s = score([...plan, c])
        const ratio = (s - best) / cost(c.kind)
        if (ratio > pickRatio + 1e-12) {
          pick = c
          pickRatio = ratio
          pickScore = s
        }
        if (i % 25 === 0) onProgress?.(pStart + pSpan * Math.min(0.95, (step - 1 + i / all.length) / 6), 'Testing candidate sites')
      }
      if (!pick) break
      plan = [...plan, pick]
      best = pickScore
      spent += cost(pick.kind)
    }
    return { plan, best }
  }

  // The greedy rule tends to spend everything on shelters; also try leaving
  // money for buses and road protection, and keep whichever mix scores best.
  const caps = [maxShelters, maxShelters - 1].filter((c) => c >= 1)
  let plan: Placement[] = []
  let best = -1
  caps.forEach((cap, i) => {
    const r = greedy(cap, (0.75 * i) / caps.length, 0.75 / caps.length)
    if (r.best > best) {
      best = r.best
      plan = r.plan
    }
  })

  // swap pass: replace each chosen item with a same-kind candidate if it helps
  for (let i = 0; i < plan.length; i++) {
    onProgress?.(0.75 + (0.25 * i) / Math.max(1, plan.length), 'Refining the plan')
    const kind = plan[i].kind
    for (const c of cand[kind]) {
      if (plan.some((p) => p.id === c.id)) continue
      const trial = plan.slice()
      trial[i] = c
      const s = score(trial)
      if (s > best + 1e-9) {
        best = s
        plan = trial
      }
    }
  }
  const ev = model.evaluate(plan)
  return { placements: plan, score: ev.score, evaluations, ms: performance.now() - t0 }
}
