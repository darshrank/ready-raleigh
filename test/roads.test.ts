import { it } from 'vitest'
import { CONFIG } from '../src/config'
import { FloodModel } from '../src/engine/flood'
import type { Placement } from '../src/shared/types'
import { loadWorldFromDisk } from './loadWorld'

it.skipIf(!process.env.TUNE)('road protection gains', () => {
  const world = loadWorldFromDisk()
  const model = new FloodModel(world)
  const names = ['Carolina Pines Baptist Church', 'New Hope Baptist Church', 'Fellowship of Christian Athletes']
  const plan: Placement[] = names.map((n) => {
    const f = world.facilities.find((x) => x.name === n)!
    return { id: n, kind: 'shelter', lon: f.lon, lat: f.lat, node: f.node }
  })
  const base = model.evaluate(plan)
  const t0 = performance.now()
  const gains = world.roads
    .filter((r) => r.hand + CONFIG.flood.roadClosureDepth < model.peakLevel())
    .map((r) => {
      const ev = model.evaluate([...plan, { id: 'r', kind: 'road', lon: r.lon, lat: r.lat, road: r.id }])
      return { name: r.name, cls: r.cls, hand: r.hand, gain: ev.protected - base.protected, gw: ev.protectedW - base.protectedW }
    })
    .sort((a, b) => b.gw - a.gw)
  console.log(`base ${base.score.toFixed(1)}; ${gains.length} roads in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
  console.log(gains.slice(0, 12).map((g) => `${g.name}(${g.cls},${g.hand}) +${g.gain.toFixed(0)}`).join('\n'))
}, 600_000)
