/**
 * Room-wide analysis for the reveal: where the crowd put its interventions,
 * how well the crowd covered each neighbourhood, and the perception gap -
 * places the data flags (the optimal plan protects them, many vulnerable
 * residents) that the crowd mostly ignored.
 */
import type { Placement, Submission } from '../shared/types'
import type { Evaluation, FloodModel } from './flood'

export interface GapArea {
  hood: string
  district: string
  lon: number
  lat: number
  /** weighted residents at risk */
  need: number
  people: number
  crowdCoverage: number
  optimalCoverage: number
}

export interface RevealAnalysis {
  /** per hex: mean share of at-risk residents protected across the room */
  crowdCoverage: Float32Array
  optimalCoverage: Float32Array
  gaps: GapArea[]
  /** crowd placements, for the heatmap */
  points: { position: [number, number]; weight: number; kind: Placement['kind'] }[]
  crowdScore: number
}

export function analyseReveal(model: FloodModel, subs: Submission[], optimal: Evaluation): RevealAnalysis {
  const { hex } = model.world
  const n = hex.n
  const crowd = new Float32Array(n)
  const evals = subs.map((s) => model.evaluate(s.placements))
  for (const ev of evals) {
    for (let h = 0; h < n; h++) if (ev.hexAtRisk[h] > 0) crowd[h] += ev.hexProtected[h] / ev.hexAtRisk[h] / evals.length
  }
  const opt = new Float32Array(n)
  for (let h = 0; h < n; h++) if (optimal.hexAtRisk[h] > 0) opt[h] = optimal.hexProtected[h] / optimal.hexAtRisk[h]

  // weighted need per hex
  const need = new Float32Array(n)
  for (const u of model.units) need[u.hex] += u.pop * (u.w + u.nocar)

  // aggregate gap by neighbourhood
  const byHood = new Map<number, GapArea & { wsum: number }>()
  for (let h = 0; h < n; h++) {
    if (need[h] <= 0) continue
    const gap = Math.max(0, opt[h] - crowd[h])
    if (gap <= 0.25) continue
    const k = hex.hood[h]
    const r = byHood.get(k) ?? { hood: hex.hoods[k], district: hex.districts[hex.district[h]], lon: 0, lat: 0, need: 0, people: 0,
      crowdCoverage: 0, optimalCoverage: 0, wsum: 0 }
    r.need += need[h] * gap
    r.people += optimal.hexAtRisk[h]
    r.lon += hex.lon[h] * need[h]
    r.lat += hex.lat[h] * need[h]
    r.crowdCoverage += crowd[h] * need[h]
    r.optimalCoverage += opt[h] * need[h]
    r.wsum += need[h]
    byHood.set(k, r)
  }
  const gaps = [...byHood.values()]
    .map(({ wsum, ...r }) => ({ ...r, lon: r.lon / wsum, lat: r.lat / wsum, crowdCoverage: r.crowdCoverage / wsum,
      optimalCoverage: r.optimalCoverage / wsum }))
    .sort((a, b) => b.need - a.need)
    .slice(0, 6)

  const points = subs.flatMap((s) => s.placements.map((p) => ({ position: [p.lon, p.lat] as [number, number],
    weight: p.kind === 'shelter' ? 3 : p.kind === 'road' ? 2 : 1, kind: p.kind })))
  const crowdScore = evals.length ? evals.reduce((a, e) => a + e.score, 0) / evals.length : 0
  return { crowdCoverage: crowd, optimalCoverage: opt, gaps, points, crowdScore }
}
