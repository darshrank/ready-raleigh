/**
 * Precompute the optimal plan for the current CONFIG + data so browsers
 * (phones especially) don't spend ~30 s of CPU on it. The app uses this file
 * when its config hash matches and falls back to the Web Worker otherwise.
 * Run after changing src/config.ts or rebuilding data: npm run optimal
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG } from '../src/config'
import { FloodModel } from '../src/engine/flood'
import { configHash, optimize } from '../src/engine/optimize'
import { loadWorldFromDisk } from '../test/loadWorld'

const world = loadWorldFromDisk()
const model = new FloodModel(world)
let last = -1
const res = optimize(model, (p) => {
  const pct = Math.floor(p * 10)
  if (pct !== last) process.stdout.write(`${pct * 10}% `)
  last = pct
})
const out = { configHash: configHash(CONFIG), generated: world.meta.generated, ...res }
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'raleigh', 'optimal.json'), JSON.stringify(out))
console.log(`\noptimal score ${res.score.toFixed(1)} with ${res.placements.length} placements in ${(res.ms / 1000).toFixed(0)} s`)
