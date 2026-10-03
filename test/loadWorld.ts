import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { parseGraph, parseHexes, type HandRaster, type Meta, type World } from '../src/engine/world'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'raleigh')
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'))

function readHand(meta: Meta): HandRaster {
  const png = PNG.sync.read(readFileSync(join(DIR, 'hand.png')))
  const n = png.width * png.height
  const code = new Uint8Array(n)
  const water = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    code[i] = png.data[4 * i]
    water[i] = png.data[4 * i + 1] > 127 ? 1 : 0
  }
  return { width: png.width, height: png.height, code, water, bounds: meta.hand.bounds, step: meta.hand.step }
}

/** Load the real preprocessed data from disk, exactly as the browser sees it. */
export function loadWorldFromDisk(): World {
  const meta = read('meta.json')
  return {
    meta,
    hex: parseHexes(read('hexes.json')),
    graph: parseGraph(read('graph.json')),
    roads: read('roads.json'),
    facilities: read('facilities.json'),
    boundary: read('boundary.json'),
    hand: readHand(meta),
  }
}
