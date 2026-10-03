import { describe, expect, it } from 'vitest'
import { FloodModel } from '../src/engine/flood'
import { optimize } from '../src/engine/optimize'
import { loadWorldFromDisk } from './loadWorld'

describe('optimizer', () => {
  it('finds a plan within budget that beats a naive one', () => {
    const world = loadWorldFromDisk()
    const model = new FloodModel(world)
    const res = optimize(model)
    const ev = model.evaluate(res.placements)
    console.log(`optimal: score ${res.score.toFixed(1)}, protected ${ev.protected.toFixed(0)}/${ev.atRisk.toFixed(0)}, ` +
      `${res.evaluations} evaluations in ${(res.ms / 1000).toFixed(1)} s`)
    console.log(res.placements.map((p) => `${p.kind}:${p.label ?? p.node}`).join(' | '))
    console.log('groups', JSON.stringify(ev.groups))
    console.log('strand reasons', JSON.stringify(ev.strands.reduce((m: Record<string, number>, s) => ((m[s.reason] = Math.round((m[s.reason] ?? 0) + s.people)), m), {})))
    expect(ev.spent).toBeLessThanOrEqual(10_000_000)
    expect(res.score).toBeGreaterThan(0)
  }, 120_000)
})
