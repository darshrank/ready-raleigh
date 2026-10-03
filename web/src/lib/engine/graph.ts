import { MinHeap } from "./heap";

export interface RoadsRaw {
  nodes: number[];
  edges: {
    u: number[];
    v: number[];
    len: number[];
    tt: number[];
    cls: number[];
    name: number[];
    oneway: number[];
    fcls: number[];
    fdist: number[];
    fsid: number[];
    fshare: number[];
    fsrc?: number[];
    fv?: number[];
    fcell?: number[];
    bridge?: number[];
  };
  geom: number[][];
  names: string[];
}

export type Direction = "forward" | "reverse" | "walk";
export type CostKind = "time" | "length";

export interface SearchResult {
  /** Cost to (forward) or from (reverse) the nearest source. Infinity if unreached. */
  dist: Float64Array;
  /** Edge used to reach the node in the search tree, -1 at sources. */
  viaEdge: Int32Array;
  /** Neighbour toward the source along the tree. */
  viaNode: Int32Array;
  /** Index of the source the node is attached to. */
  root: Int32Array;
}

/** Road network in compressed sparse row form, with forward, reverse and undirected adjacency. */
export class RoadGraph {
  readonly n: number;
  readonly m: number;
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  readonly eu: Int32Array;
  readonly ev: Int32Array;
  readonly len: Float32Array;
  readonly tt: Float32Array;
  readonly cls: Uint8Array;
  readonly nameIdx: Int32Array;
  readonly oneway: Uint8Array;
  readonly fcls: Uint8Array;
  readonly fdist: Float32Array;
  readonly fsid: Int16Array;
  readonly fshare: Float32Array;
  /** Hazard source of the worst cell on the edge. */
  readonly fsrc: Uint8Array;
  /** Hazard value at the edge's midpoint cell (heat x1000, shaking x100). */
  readonly fv: Float32Array;
  /** Index of the edge's worst (or midpoint) hazard cell, -1 if none. */
  readonly fcell: Int32Array;
  readonly bridge: Uint8Array;
  readonly geom: Float64Array[];
  readonly names: string[];

  private fStart: Int32Array;
  private fTo: Int32Array;
  private fEdge: Int32Array;
  private rStart: Int32Array;
  private rTo: Int32Array;
  private rEdge: Int32Array;
  private wStart: Int32Array;
  private wTo: Int32Array;
  private wEdge: Int32Array;

  constructor(raw: RoadsRaw) {
    this.n = raw.nodes.length / 2;
    this.m = raw.edges.u.length;
    this.lon = new Float64Array(this.n);
    this.lat = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.lon[i] = raw.nodes[2 * i];
      this.lat[i] = raw.nodes[2 * i + 1];
    }
    const e = raw.edges;
    this.eu = Int32Array.from(e.u);
    this.ev = Int32Array.from(e.v);
    this.len = Float32Array.from(e.len);
    this.tt = Float32Array.from(e.tt);
    this.cls = Uint8Array.from(e.cls);
    this.nameIdx = Int32Array.from(e.name);
    this.oneway = Uint8Array.from(e.oneway);
    this.fcls = Uint8Array.from(e.fcls);
    this.fdist = Float32Array.from(e.fdist);
    this.fsid = Int16Array.from(e.fsid);
    this.fshare = Float32Array.from(e.fshare);
    this.fsrc = e.fsrc ? Uint8Array.from(e.fsrc) : new Uint8Array(this.m);
    this.fv = e.fv ? Float32Array.from(e.fv) : new Float32Array(this.m);
    this.fcell = e.fcell ? Int32Array.from(e.fcell) : new Int32Array(this.m).fill(-1);
    this.bridge = e.bridge ? Uint8Array.from(e.bridge) : new Uint8Array(this.m);
    this.geom = raw.geom.map((g) => Float64Array.from(g));
    this.names = raw.names;

    const fwd = this.buildCsr((add) => {
      for (let i = 0; i < this.m; i++) {
        add(this.eu[i], this.ev[i], i);
        if (!this.oneway[i]) add(this.ev[i], this.eu[i], i);
      }
    });
    this.fStart = fwd.start;
    this.fTo = fwd.to;
    this.fEdge = fwd.edge;
    const rev = this.buildCsr((add) => {
      for (let i = 0; i < this.m; i++) {
        add(this.ev[i], this.eu[i], i);
        if (!this.oneway[i]) add(this.eu[i], this.ev[i], i);
      }
    });
    this.rStart = rev.start;
    this.rTo = rev.to;
    this.rEdge = rev.edge;
    const walk = this.buildCsr((add) => {
      for (let i = 0; i < this.m; i++) {
        if (this.cls[i] <= 1) continue;
        add(this.eu[i], this.ev[i], i);
        add(this.ev[i], this.eu[i], i);
      }
    });
    this.wStart = walk.start;
    this.wTo = walk.to;
    this.wEdge = walk.edge;
  }

  private buildCsr(fill: (add: (a: number, b: number, e: number) => void) => void) {
    const count = new Int32Array(this.n + 1);
    fill((a) => {
      count[a + 1]++;
    });
    for (let i = 0; i < this.n; i++) count[i + 1] += count[i];
    const start = count.slice();
    const cursor = count.slice();
    const to = new Int32Array(start[this.n]);
    const edge = new Int32Array(start[this.n]);
    fill((a, b, e) => {
      const k = cursor[a]++;
      to[k] = b;
      edge[k] = e;
    });
    return { start, to, edge };
  }

  /**
   * Multi-source Dijkstra.
   * forward: cost from sources outward along one-way rules.
   * reverse: cost from every node to the nearest source (follow viaNode to reach it).
   * walk: undirected, ignores one-way and excludes motorways and trunks.
   * `blocked(edge)` removes edges; `limit` stops the search at that cost.
   */
  search(opts: {
    sources: ArrayLike<number>;
    sourceCost?: ArrayLike<number>;
    direction: Direction;
    cost: CostKind;
    blocked?: Uint8Array;
    limit?: number;
  }): SearchResult {
    const { sources, sourceCost, direction, cost, blocked } = opts;
    const limit = opts.limit ?? Infinity;
    const n = this.n;
    const dist = new Float64Array(n).fill(Infinity);
    const viaEdge = new Int32Array(n).fill(-1);
    const viaNode = new Int32Array(n).fill(-1);
    const root = new Int32Array(n).fill(-1);
    const heap = new MinHeap(4096);
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (s < 0) continue;
      const c = sourceCost ? sourceCost[i] : 0;
      if (c < dist[s]) {
        dist[s] = c;
        root[s] = i;
        heap.push(c, s);
      }
    }
    const start = direction === "forward" ? this.fStart : direction === "reverse" ? this.rStart : this.wStart;
    const to = direction === "forward" ? this.fTo : direction === "reverse" ? this.rTo : this.wTo;
    const edge = direction === "forward" ? this.fEdge : direction === "reverse" ? this.rEdge : this.wEdge;
    const w = cost === "time" ? this.tt : this.len;
    while (heap.size > 0) {
      const u = heap.pop();
      const du = heap.lastKey;
      if (du > dist[u]) continue;
      if (du > limit) break;
      for (let k = start[u]; k < start[u + 1]; k++) {
        const e = edge[k];
        if (blocked && blocked[e]) continue;
        const v = to[k];
        const dv = du + w[e];
        if (dv < dist[v]) {
          dist[v] = dv;
          viaEdge[v] = e;
          viaNode[v] = u;
          root[v] = root[u];
          heap.push(dv, v);
        }
      }
    }
    return { dist, viaEdge, viaNode, root };
  }

  /** Follow a reverse-search tree from `node` to its source. Returns the edges walked. */
  pathToRoot(tree: SearchResult, node: number): { edges: number[]; nodes: number[] } {
    const edges: number[] = [];
    const nodes: number[] = [node];
    let cur = node;
    let guard = 0;
    while (tree.viaNode[cur] >= 0 && guard++ < 100000) {
      edges.push(tree.viaEdge[cur]);
      cur = tree.viaNode[cur];
      nodes.push(cur);
    }
    return { edges, nodes };
  }

  /** Coordinates of an edge oriented from node `from`. */
  edgeCoords(e: number, from: number): Float64Array {
    const g = this.geom[e];
    if (from === this.eu[e]) return g;
    const out = new Float64Array(g.length);
    for (let i = 0, j = g.length - 2; j >= 0; i += 2, j -= 2) {
      out[i] = g[j];
      out[i + 1] = g[j + 1];
    }
    return out;
  }

  edgeMid(e: number): [number, number] {
    const g = this.geom[e];
    const k = Math.floor(g.length / 4) * 2;
    return [g[k], g[k + 1]];
  }

  edgeName(e: number): string {
    return this.names[this.nameIdx[e]] || "Unnamed road";
  }
}
