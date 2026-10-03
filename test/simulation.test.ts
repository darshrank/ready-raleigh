import { expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { buildDebrief } from '../src/engine/debrief'
import { FloodModel } from '../src/engine/flood'
import { buildSimulation, countsAt, levelAt } from '../src/engine/simulation'
import type { Placement } from '../src/shared/types'
import { loadWorldFromDisk } from './loadWorld'

it('builds an animation whose counters match the evaluation', () => {
  const world = loadWorldFromDisk()
  const model = new FloodModel(world)
  const pick = (n: string): Placement => {
    const f = world.facilities.find((x) => x.name.includes(n) && x.shelter)!
    return { id: n, kind: 'shelter', lon: f.lon, lat: f.lat, node: f.node, label: f.name }
  }
  const hexIdx = model.units.reduce((best, u) => (u.pop * u.nocar > model.units[best].pop * model.units[best].nocar ? model.units.indexOf(u) : best), 0)
  const h = model.units[hexIdx].hex
  const plan: Placement[] = [pick('Broughton'), pick('Enloe'),
    { id: 'b', kind: 'bus', lon: world.hex.lon[h], lat: world.hex.lat[h], node: world.hex.node[h] }]
  const ev = model.evaluate(plan)
  const t0 = performance.now()
  const sim = buildSimulation(model, plan, ev)
  console.log(`sim: ${sim.trips.length} trips, ${sim.strands.length} stranded dots, ${sim.roads.length} roads, ${sim.duration.toFixed(1)} s, built in ${(performance.now() - t0).toFixed(0)} ms`)
  expect(sim.trips.length + sim.strands.length).toBeLessThanOrEqual(CONFIG.simulation.maxDots * 1.05)
  const end = countsAt(sim, sim.duration)
  expect(Math.abs(end.protected - ev.protected)).toBeLessThan(1)
  expect(levelAt(sim, sim.duration)).toBeCloseTo(model.peakLevel())
  expect(sim.trips.every((t) => t.path.length >= 2 && t.timestamps.length === t.path.length)).toBe(true)
  const d = buildDebrief(model, ev, 63)
  console.log(d.headline, '\n', d.biggestMiss, '\n', d.vulnerable, '\n', d.notes.join('\n '))
})
