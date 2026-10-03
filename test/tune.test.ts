import { it } from 'vitest'
import { CONFIG } from '../src/config'
import { FloodModel } from '../src/engine/flood'
import { optimize } from '../src/engine/optimize'
import type { Placement } from '../src/shared/types'
import { loadWorldFromDisk } from './loadWorld'

// Balance exploration; run with: TUNE=1 npx vitest run test/tune.test.ts
it.skipIf(!process.env.TUNE)('tune', () => {
  const world = loadWorldFromDisk()
  const cfg = CONFIG as any
  for (const [cap, drive] of [[6000, 15], [6000, 10], [8000, 10]]) {
    cfg.interventions.shelter.capacity = cap
    cfg.interventions.shelter.driveMinutes = drive
    const model = new FloodModel(world)
    const res = optimize(model)
    // naive: three big downtown-ish schools
    const pick = (n: string): Placement => {
      const f = world.facilities.find((x) => x.name.includes(n))!
      return { id: n, kind: 'shelter', lon: f.lon, lat: f.lat, node: f.node }
    }
    const naive = model.evaluate([pick('Broughton'), pick('Enloe'), pick('Sanderson')])
    const ev = model.evaluate(res.placements)
    const reasons = (e: typeof ev) => JSON.stringify(e.strands.reduce((m: Record<string, number>, s) => ((m[s.reason] = Math.round((m[s.reason] ?? 0) + s.people)), m), {}))
    console.log(`cap ${cap} drive ${drive}: optimal ${res.score.toFixed(1)} [${res.placements.map((p) => p.kind[0] + ':' + (p.label ?? p.node)).join(', ')}] ${reasons(ev)}\n   naive ${naive.score.toFixed(1)} ${reasons(naive)}  (${(res.ms / 1000).toFixed(0)}s)`)
  }
}, 600_000)
