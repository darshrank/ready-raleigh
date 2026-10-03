import { describe, expect, it } from 'vitest'
import { FloodModel } from '../src/engine/flood'
import type { Placement } from '../src/shared/types'
import { loadWorldFromDisk } from './loadWorld'

const world = loadWorldFromDisk()
const model = new FloodModel(world)

const shelterAt = (name: string): Placement => {
  const f = world.facilities.find((x) => x.name.includes(name) && x.shelter)!
  return { id: name, kind: 'shelter', lon: f.lon, lat: f.lat, node: f.node, label: f.name }
}

describe('flood model on real Raleigh data', () => {
  it('finds residents at risk', () => {
    expect(model.units.length).toBeGreaterThan(100)
    expect(model.totalAtRisk()).toBeGreaterThan(5000)
  })

  it('empty plan protects nobody', () => {
    const ev = model.evaluate([])
    expect(ev.protected).toBe(0)
    expect(ev.score).toBe(0)
    expect(ev.strands.every((s) => s.reason === 'no-shelter' || s.reason === 'no-transit')).toBe(true)
  })

  it('a shelter protects people and respects capacity', () => {
    const t0 = performance.now()
    const ev = model.evaluate([shelterAt('Broughton')])
    const ms = performance.now() - t0
    console.log(`1 shelter: score ${ev.score.toFixed(1)} protected ${ev.protected.toFixed(0)} / ${ev.atRisk.toFixed(0)} in ${ms.toFixed(0)} ms`)
    expect(ev.protected).toBeGreaterThan(0)
    expect(ev.shelters[0].load).toBeLessThanOrEqual(ev.shelters[0].capacity + 1e-6)
  })

  it('more shelters never lower the score', () => {
    const a = model.evaluate([shelterAt('Broughton')])
    const t0 = performance.now()
    const b = model.evaluate([shelterAt('Broughton'), shelterAt('Enloe'), shelterAt('Sanderson')])
    console.log(`3 shelters: score ${b.score.toFixed(1)} in ${(performance.now() - t0).toFixed(0)} ms; reasons`,
      Object.entries(b.strands.reduce((m: Record<string, number>, s) => ((m[s.reason] = (m[s.reason] ?? 0) + s.people), m), {})))
    expect(b.score).toBeGreaterThanOrEqual(a.score)
  })
})
