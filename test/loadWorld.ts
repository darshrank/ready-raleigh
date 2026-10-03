import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseGraph, parseHexes, type World } from '../src/engine/world'

const DIR = join(__dirname, '..', 'public', 'data', 'raleigh')
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'))

/** Load the real preprocessed data from disk (no HAND raster: sites never flood). */
export function loadWorldFromDisk(): World {
  return {
    meta: read('meta.json'),
    hex: parseHexes(read('hexes.json')),
    graph: parseGraph(read('graph.json')),
    roads: read('roads.json'),
    facilities: read('facilities.json'),
    boundary: read('boundary.json'),
    hand: null,
  }
}
