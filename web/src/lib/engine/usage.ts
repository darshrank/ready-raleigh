import type { RoadGraph, SearchResult } from "./graph";

/**
 * Population carried by each edge when every weighted node follows its
 * reverse-search tree to the nearest source. Edges off the tree carry zero,
 * so removing them cannot change anyone's shortest route.
 */
export function treeUsage(graph: RoadGraph, tree: SearchResult, weights: { node: number; w: number }[]): Float64Array {
  const usage = new Float64Array(graph.m);
  for (const { node, w } of weights) {
    let cur = node;
    if (!Number.isFinite(tree.dist[cur])) continue;
    let guard = 0;
    while (tree.viaNode[cur] >= 0 && guard++ < 100000) {
      usage[tree.viaEdge[cur]] += w;
      cur = tree.viaNode[cur];
    }
  }
  return usage;
}
