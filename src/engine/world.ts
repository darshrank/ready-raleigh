/**
 * The preprocessed city: analysis hexes, road graph, facilities and the HAND
 * flood raster. Loaded once from public/data/<city>/ (see data-prep/build.py).
 */

export interface Meta {
  city: string
  bbox: [number, number, number, number]
  center: [number, number]
  population: number
  generated: string
  demographics: 'acs5' | 'citywide-fallback'
  hand: { bounds: [number, number, number, number]; width: number; height: number; step: number }
  sources: { name: string; use: string }[]
}

export interface Hexes {
  n: number
  id: string[]
  lon: Float64Array
  lat: Float64Array
  pop: Float32Array
  elderly: Float32Array
  poverty: Float32Array
  nocar: Float32Array
  hhsize: Float32Array
  node: Int32Array
  district: Int32Array
  hood: Int32Array
  binSize: number
  /** CSR: residents per HAND bin (height above drainage of their building) */
  expoStart: Int32Array
  expoBin: Int16Array
  expoPop: Float32Array
  districts: string[]
  hoods: string[]
}

export interface Graph {
  nNodes: number
  nEdges: number
  lon: Float64Array
  lat: Float64Array
  u: Int32Array
  v: Int32Array
  len: Float32Array
  cls: Uint8Array
  /** height above drainage (m) at which water reaches the road; Infinity = never */
  hand: Float32Array
  grp: Int32Array
  name: Int32Array
  names: string[]
  classes: string[]
  /** CSR adjacency (undirected) */
  adjStart: Int32Array
  adjEdge: Int32Array
  adjNode: Int32Array
  geomRaw: number[][]
  q: number
}

export interface RoadGroup {
  id: number
  edges: number[]
  hand: number
  name: string
  cls: string
  length: number
  lon: number
  lat: number
}

export interface Facility {
  name: string
  kind: 'school' | 'community' | 'worship' | 'hospital' | 'fire' | 'police'
  cat: string
  shelter: boolean
  lon: number
  lat: number
  hand: number | null
  node: number
}

export interface HandRaster {
  width: number
  height: number
  /** HAND code per pixel: metres = code * step, 255 = high ground / no data */
  code: Uint8Array
  /** permanent water (rivers, lakes) */
  water: Uint8Array
  bounds: [number, number, number, number]
  step: number
}

export interface World {
  meta: Meta
  hex: Hexes
  graph: Graph
  roads: RoadGroup[]
  facilities: Facility[]
  boundary: GeoJSON.Feature
  hand: HandRaster | null
}

const BASE = `${import.meta.env?.BASE_URL ?? '/'}data/raleigh/`

// ------------------------------------------------------------------ parsing

export function parseHexes(j: any): Hexes {
  const n = j.id.length
  const expoStart = new Int32Array(n + 1)
  let total = 0
  for (let i = 0; i < n; i++) {
    expoStart[i] = total
    total += j.expo[i].length / 2
  }
  expoStart[n] = total
  const expoBin = new Int16Array(total)
  const expoPop = new Float32Array(total)
  let k = 0
  for (let i = 0; i < n; i++) {
    const e = j.expo[i]
    for (let m = 0; m < e.length; m += 2) {
      expoBin[k] = e[m]
      expoPop[k] = e[m + 1]
      k++
    }
  }
  return {
    n,
    id: j.id,
    lon: Float64Array.from(j.lon),
    lat: Float64Array.from(j.lat),
    pop: Float32Array.from(j.pop),
    elderly: Float32Array.from(j.elderly),
    poverty: Float32Array.from(j.poverty),
    nocar: Float32Array.from(j.nocar),
    hhsize: Float32Array.from(j.hhsize),
    node: Int32Array.from(j.node),
    district: Int32Array.from(j.district),
    hood: Int32Array.from(j.hood),
    binSize: j.binSize,
    expoStart,
    expoBin,
    expoPop,
    districts: j.districts,
    hoods: j.hoods,
  }
}

export function parseGraph(j: any): Graph {
  const nNodes = j.nodes.length / 2
  const nEdges = j.u.length
  const lon = new Float64Array(nNodes)
  const lat = new Float64Array(nNodes)
  for (let i = 0; i < nNodes; i++) {
    lon[i] = j.nodes[2 * i] / j.q
    lat[i] = j.nodes[2 * i + 1] / j.q
  }
  const u = Int32Array.from(j.u)
  const v = Int32Array.from(j.v)
  const deg = new Int32Array(nNodes + 1)
  for (let e = 0; e < nEdges; e++) {
    deg[u[e]]++
    deg[v[e]]++
  }
  const adjStart = new Int32Array(nNodes + 1)
  for (let i = 0; i < nNodes; i++) adjStart[i + 1] = adjStart[i] + deg[i]
  const fill = adjStart.slice(0, nNodes)
  const adjEdge = new Int32Array(2 * nEdges)
  const adjNode = new Int32Array(2 * nEdges)
  for (let e = 0; e < nEdges; e++) {
    adjEdge[fill[u[e]]] = e
    adjNode[fill[u[e]]++] = v[e]
    adjEdge[fill[v[e]]] = e
    adjNode[fill[v[e]]++] = u[e]
  }
  const hand = new Float32Array(nEdges)
  for (let e = 0; e < nEdges; e++) hand[e] = j.hand[e] < 0 ? Infinity : j.hand[e] / 100
  return {
    nNodes,
    nEdges,
    lon,
    lat,
    u,
    v,
    len: Float32Array.from(j.len),
    cls: Uint8Array.from(j.cls),
    hand,
    grp: Int32Array.from(j.grp),
    name: Int32Array.from(j.name),
    names: j.names,
    classes: j.classes,
    adjStart,
    adjEdge,
    adjNode,
    geomRaw: j.geom,
    q: j.q,
  }
}

/** Full coordinates of an edge, oriented from `from` node. */
export function edgeCoords(g: Graph, e: number, from?: number): [number, number][] {
  const u = g.u[e]
  const out: [number, number][] = [[g.lon[u], g.lat[u]]]
  const raw = g.geomRaw[e]
  let x = Math.round(g.lon[u] * g.q)
  let y = Math.round(g.lat[u] * g.q)
  for (let i = 0; i < raw.length; i += 2) {
    x += raw[i]
    y += raw[i + 1]
    out.push([x / g.q, y / g.q])
  }
  const v = g.v[e]
  out.push([g.lon[v], g.lat[v]])
  if (from !== undefined && from !== u) out.reverse()
  return out
}

// ------------------------------------------------------------------ hand raster

export async function decodeHand(url: string, meta: Meta): Promise<HandRaster | null> {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null
  const blob = await (await fetch(url)).blob()
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  const n = bmp.width * bmp.height
  const code = new Uint8Array(n)
  const water = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    code[i] = px[4 * i]
    water[i] = px[4 * i + 1] > 127 ? 1 : 0
  }
  return { width: bmp.width, height: bmp.height, code, water, bounds: meta.hand.bounds, step: meta.hand.step }
}

const R = 6378137
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const mercX = (lon: number) => (R * lon * Math.PI) / 180

/** HAND (m) at a location, or Infinity if high ground / outside the raster. */
export function handAt(h: HandRaster | null, lon: number, lat: number): number {
  if (!h) return Infinity
  const [w, s, e, n] = h.bounds
  const fx = (mercX(lon) - mercX(w)) / (mercX(e) - mercX(w))
  const fy = (mercY(n) - mercY(lat)) / (mercY(n) - mercY(s))
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return Infinity
  const i = Math.floor(fy * h.height) * h.width + Math.floor(fx * h.width)
  const c = h.code[i]
  return c === 255 ? Infinity : c * h.step
}

// ------------------------------------------------------------------ loading

export async function loadWorld(onProgress?: (msg: string) => void): Promise<World> {
  const get = async (f: string) => {
    const r = await fetch(BASE + f)
    if (!r.ok) throw new Error(`Failed to load ${f}: ${r.status}`)
    return r.json()
  }
  onProgress?.('Loading map data')
  const [meta, hexJ, graphJ, roads, facilities, boundary] = await Promise.all([
    get('meta.json'), get('hexes.json'), get('graph.json'), get('roads.json'), get('facilities.json'),
    get('boundary.json'),
  ])
  onProgress?.('Building road network')
  const hand = await decodeHand(BASE + 'hand.png', meta).catch(() => null)
  return { meta, hex: parseHexes(hexJ), graph: parseGraph(graphJ), roads, facilities, boundary, hand }
}

/** Snap a point to the nearest graph node (linear scan; ~40k nodes, fast enough). */
export function nearestNode(g: Graph, lon: number, lat: number, walkableOnly = true): number {
  const k = Math.cos((lat * Math.PI) / 180)
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < g.nNodes; i++) {
    const dx = (g.lon[i] - lon) * k
    const dy = g.lat[i] - lat
    const d = dx * dx + dy * dy
    if (d < bestD) {
      if (walkableOnly && !nodeWalkable(g, i)) continue
      bestD = d
      best = i
    }
  }
  return best
}

function nodeWalkable(g: Graph, n: number) {
  for (let a = g.adjStart[n]; a < g.adjStart[n + 1]; a++) {
    const c = g.classes[g.cls[g.adjEdge[a]]]
    if (c !== 'motorway' && c !== 'trunk') return true
  }
  return false
}

export function distanceM(lon1: number, lat1: number, lon2: number, lat2: number) {
  const k = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  const dx = (lon2 - lon1) * k * 111320
  const dy = (lat2 - lat1) * 110574
  return Math.sqrt(dx * dx + dy * dy)
}
