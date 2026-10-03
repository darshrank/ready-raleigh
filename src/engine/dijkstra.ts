import type { Graph } from './world'

/** Binary min-heap of (node, cost) over typed arrays. */
class Heap {
  nodes: Int32Array
  costs: Float64Array
  size = 0
  constructor(cap: number) {
    this.nodes = new Int32Array(cap)
    this.costs = new Float64Array(cap)
  }
  push(n: number, c: number) {
    if (this.size === this.nodes.length) {
      const nn = new Int32Array(this.size * 2)
      nn.set(this.nodes)
      const cc = new Float64Array(this.size * 2)
      cc.set(this.costs)
      this.nodes = nn
      this.costs = cc
    }
    let i = this.size++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.costs[p] <= c) break
      this.nodes[i] = this.nodes[p]
      this.costs[i] = this.costs[p]
      i = p
    }
    this.nodes[i] = n
    this.costs[i] = c
  }
  pop(): number {
    const top = this.nodes[0]
    const n = this.nodes[--this.size]
    const c = this.costs[this.size]
    let i = 0
    for (;;) {
      let l = 2 * i + 1
      if (l >= this.size) break
      const r = l + 1
      if (r < this.size && this.costs[r] < this.costs[l]) l = r
      if (this.costs[l] >= c) break
      this.nodes[i] = this.nodes[l]
      this.costs[i] = this.costs[l]
      i = l
    }
    this.nodes[i] = n
    this.costs[i] = c
    return top
  }
  topCost() {
    return this.costs[0]
  }
}

export interface Tree {
  /** seconds from the source to each node (Infinity = unreachable within limit) */
  dist: Float32Array
  /** edge used to reach each node (-1 at source / unreached) */
  pred: Int32Array
}

/**
 * Single- or multi-source shortest paths.
 * `edgeCost[e]` is the traversal time in seconds (Infinity = closed).
 * Search stops at `limit` seconds.
 */
export function dijkstra(g: Graph, sources: number[], edgeCost: Float32Array, limit = Infinity): Tree {
  const dist = new Float32Array(g.nNodes).fill(Infinity)
  const pred = new Int32Array(g.nNodes).fill(-1)
  const done = new Uint8Array(g.nNodes)
  const heap = new Heap(1024)
  for (const s of sources) {
    if (s < 0) continue
    dist[s] = 0
    heap.push(s, 0)
  }
  const { adjStart, adjEdge, adjNode } = g
  while (heap.size) {
    const c = heap.topCost()
    const n = heap.pop()
    if (done[n]) continue
    done[n] = 1
    if (c > limit) {
      dist[n] = Infinity
      pred[n] = -1
      continue
    }
    for (let a = adjStart[n]; a < adjStart[n + 1]; a++) {
      const e = adjEdge[a]
      const w = edgeCost[e]
      if (w === Infinity) continue
      const m = adjNode[a]
      const nc = c + w
      if (nc < dist[m] && nc <= limit) {
        dist[m] = nc
        pred[m] = e
        heap.push(m, nc)
      }
    }
  }
  return { dist, pred }
}

/** Walk the predecessor tree from `node` back to the tree's source. */
export function pathTo(g: Graph, tree: Tree, node: number): { edges: number[]; nodes: number[] } | null {
  if (tree.dist[node] === Infinity) return null
  const edges: number[] = []
  const nodes: number[] = [node]
  let n = node
  let guard = 0
  while (tree.pred[n] >= 0 && guard++ < 100000) {
    const e = tree.pred[n]
    edges.push(e)
    n = g.u[e] === n ? g.v[e] : g.u[e]
    nodes.push(n)
  }
  return { edges, nodes }
}
