import type { FinalGraph } from "./finalGraph.ts";
import { TraceRecorder, type SearchStatus, type SearchTrace } from "./search.ts";

export type Objective = "distance" | "time";
export type FinalAlgorithm = "dfs" | "dijkstra" | "astar";
export interface Scenario {
  id: string;
  congestedEdgeIds?: string[];
  multiplier?: number;
  closedEdgeIds?: string[];
}
export interface Heuristic {
  scale: number;
  prepNs: number;
  fallbackReason: string | null;
  admissible: boolean;
  consistent: boolean;
}
export interface FinalSearchResult {
  status: SearchStatus;
  objectiveCost: number | null;
  bestSoFar: number | null;
  pathEdges: number[];
  routeLengthM: number | null;
  estimatedFreeFlowS: number | null;
  expandedKind: "path_prefix" | "settled_node";
  expandedCount: number;
  uniqueVisited: number;
  completePaths: number | null;
  relaxedEdges: number | null;
  heapPeakEntries: number | null;
  trace?: SearchTrace;
}

export function edgeCosts(final: FinalGraph, objective: Objective, scenario: Scenario): Float64Array {
  const congested = new Set(scenario.congestedEdgeIds ?? []);
  const closed = new Set(scenario.closedEdgeIds ?? []);
  const multiplier = scenario.multiplier ?? 1;
  if (!(multiplier >= 1 && Number.isFinite(multiplier))) throw new Error("invalid congestion multiplier");
  return Float64Array.from(final.edgeId, (id, e) => closed.has(id) ? Infinity :
    objective === "distance" ? final.graph.len[e] : final.freeFlowS[e] * (congested.has(id) ? multiplier : 1));
}

export function prepareHeuristic(original: FinalGraph, current: FinalGraph, objective: Objective, scenario: Scenario): Heuristic {
  const t0 = performance.now();
  const originalCost = edgeCosts(original, objective, scenario);
  const g = original.graph;
  let scale = Infinity;
  for (let e = 0; e < g.m; e++) {
    if (!Number.isFinite(originalCost[e])) continue;
    const straight = Math.hypot(g.x[g.from[e]] - g.x[g.to[e]], g.y[g.from[e]] - g.y[g.to[e]]);
    if (straight > 0) scale = Math.min(scale, originalCost[e] / straight);
  }
  let fallbackReason: string | null = null;
  if (!Number.isFinite(scale) || scale < 0) { scale = 0; fallbackReason = "no safe positive edge ratio"; }
  // A small numerical margin protects the consistency check against rounding.
  scale *= 1 - 1e-12;
  const costs = edgeCosts(current, objective, scenario);
  const graph = current.graph;
  for (let e = 0; e < graph.m; e++) {
    if (!Number.isFinite(costs[e])) continue;
    const straight = Math.hypot(graph.x[graph.from[e]] - graph.x[graph.to[e]], graph.y[graph.from[e]] - graph.y[graph.to[e]]);
    if (scale * straight > costs[e] + 1e-8) {
      scale = 0;
      fallbackReason = `consistency failed at ${current.edgeId[e]}`;
      break;
    }
  }
  return { scale, prepNs: Math.round((performance.now() - t0) * 1e6), fallbackReason, admissible: true, consistent: true };
}

export function validateFinalRoute(final: FinalGraph, costs: Float64Array, source: number, target: number, result: FinalSearchResult): string | null {
  if (result.status !== "SUCCESS") return result.objectiveCost === null && result.pathEdges.length === 0 ? null : "non-success has a confirmed route";
  const g = final.graph;
  let at = source, cost = 0, length = 0, travel = 0;
  for (const e of result.pathEdges) {
    if (!Number.isInteger(e) || e < 0 || e >= g.m) return "unknown edge";
    if (g.from[e] !== at) return "disconnected or reversed edge";
    if (!Number.isFinite(costs[e])) return "closed edge used";
    cost += costs[e]; length += g.len[e]; travel += final.freeFlowS[e]; at = g.to[e];
  }
  if (at !== target) return "wrong destination";
  if (Math.abs(cost - (result.objectiveCost ?? Infinity)) > 1e-6) return "objective cost mismatch";
  if (Math.abs(length - (result.routeLengthM ?? Infinity)) > 1e-6) return "route length mismatch";
  if (Math.abs(travel - (result.estimatedFreeFlowS ?? Infinity)) > 1e-6) return "free-flow time mismatch";
  return null;
}

function resultBase(algorithm: FinalAlgorithm): FinalSearchResult {
  return { status: "NO_PATH", objectiveCost: null, bestSoFar: null, pathEdges: [], routeLengthM: null,
    estimatedFreeFlowS: null, expandedKind: algorithm === "dfs" ? "path_prefix" : "settled_node",
    expandedCount: 0, uniqueVisited: 0, completePaths: algorithm === "dfs" ? 0 : null,
    relaxedEdges: algorithm === "dfs" ? null : 0, heapPeakEntries: algorithm === "dfs" ? null : 0 };
}

function finishRoute(result: FinalSearchResult, final: FinalGraph, costs: Float64Array, path: number[]): FinalSearchResult {
  result.status = "SUCCESS";
  result.pathEdges = path;
  result.objectiveCost = path.reduce((sum, e) => sum + costs[e], 0);
  result.routeLengthM = path.reduce((sum, e) => sum + final.graph.len[e], 0);
  result.estimatedFreeFlowS = path.reduce((sum, e) => sum + final.freeFlowS[e], 0);
  return result;
}

interface HeapEntry { f: number; g: number; seq: number; node: number }
class Heap {
  private data: HeapEntry[] = [];
  private smallerG: boolean;
  constructor(smallerG = false) { this.smallerG = smallerG; }
  get size() { return this.data.length; }
  private less(a: HeapEntry, b: HeapEntry) {
    return a.f < b.f || (a.f === b.f && ((this.smallerG ? a.g < b.g : a.g > b.g) ||
      (a.g === b.g && (this.smallerG ? a.node < b.node : a.seq < b.seq))));
  }
  push(value: HeapEntry) {
    const a = this.data;
    a.push(value);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]]; i = p;
    }
  }
  pop(): HeapEntry {
    const a = this.data;
    const first = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0;;) {
        let child = i * 2 + 1;
        if (child >= a.length) break;
        if (child + 1 < a.length && this.less(a[child + 1], a[child])) child++;
        if (!this.less(a[child], a[i])) break;
        [a[i], a[child]] = [a[child], a[i]]; i = child;
      }
    }
    return first;
  }
}

export function finalSearch(final: FinalGraph, source: number, target: number, costs: Float64Array, algorithm: FinalAlgorithm,
  options: { timeLimitMs?: number; heuristicScale?: number; recordTrace?: boolean; maxFrames?: number; smallerGTies?: boolean } = {}): FinalSearchResult {
  const g = final.graph, result = resultBase(algorithm);
  if (source < 0 || source >= g.n || target < 0 || target >= g.n) throw new Error("invalid source or target");
  if (costs.length !== g.m || Array.from(costs).some((v) => v < 0 || Number.isNaN(v))) throw new Error("invalid costs");
  const trace = options.recordTrace ? new TraceRecorder(g.n, options.maxFrames ?? 90) : null;
  if (source === target) {
    result.expandedCount = 1; result.uniqueVisited = 1;
    trace?.visit(source);
    if (trace) result.trace = trace.finish({ step: 1, current: source, path: [], best: [] });
    return finishRoute(result, final, costs, []);
  }
  if (algorithm === "dfs") {
    const onPath = new Uint8Array(g.n), seen = new Uint8Array(g.n);
    const nodes = new Int32Array(g.n), next = new Int32Array(g.n), incoming = new Int32Array(g.n), dist = new Float64Array(g.n);
    const deadline = performance.now() + (options.timeLimitMs ?? Infinity);
    let depth = 0, best = Infinity, bestPath: number[] | null = null;
    nodes[0] = source; next[0] = g.outStart[source]; onPath[source] = 1; seen[source] = 1;
    result.expandedCount = 1; result.uniqueVisited = 1; trace?.visit(source);
    while (depth >= 0) {
      if (result.expandedCount % 128 === 0 && performance.now() >= deadline) {
        result.status = "TIMEOUT"; result.bestSoFar = bestPath ? best : null; break;
      }
      const u = nodes[depth], i = next[depth];
      if (i >= g.outStart[u + 1]) { onPath[u] = 0; depth--; continue; }
      next[depth] = i + 1;
      const e = g.outEdge[i], v = g.to[e];
      if (onPath[v] || !Number.isFinite(costs[e])) continue;
      result.expandedCount++;
      if (!seen[v]) { seen[v] = 1; result.uniqueVisited++; }
      const cost = dist[depth] + costs[e];
      if (v === target) {
        result.completePaths = (result.completePaths ?? 0) + 1;
        if (cost < best) { best = cost; bestPath = [...incoming.subarray(1, depth + 1), e]; }
      }
      if (trace) {
        trace.visit(v);
        if (trace.due(result.expandedCount)) trace.push({ step: result.expandedCount, current: v,
          path: [...incoming.subarray(1, depth + 1), e], best: bestPath });
      }
      if (v === target) continue;
      depth++; nodes[depth] = v; next[depth] = g.outStart[v]; incoming[depth] = e; dist[depth] = cost; onPath[v] = 1;
    }
    if (result.status !== "TIMEOUT" && bestPath) finishRoute(result, final, costs, bestPath);
    if (trace) result.trace = trace.finish({ step: result.expandedCount, current: target,
      path: result.status === "SUCCESS" ? result.pathEdges : bestPath ?? [], best: bestPath });
    return result;
  }
  const d = new Float64Array(g.n).fill(Infinity), parent = new Int32Array(g.n).fill(-1), closed = new Uint8Array(g.n);
  const heap = new Heap(options.smallerGTies), scale = algorithm === "astar" ? options.heuristicScale ?? 0 : 0;
  let seq = 0, peak = 0;
  const push = (node: number, distance: number) => {
    const h = scale * Math.hypot(g.x[node] - g.x[target], g.y[node] - g.y[target]);
    heap.push({ f: distance + h, g: distance, seq: seq++, node });
    peak = Math.max(peak, heap.size);
  };
  d[source] = 0; push(source, 0);
  while (heap.size) {
    const item = heap.pop(), u = item.node;
    if (closed[u] || item.g !== d[u]) continue;
    closed[u] = 1; result.expandedCount++; result.uniqueVisited++;
    if (trace) {
      trace.visit(u);
      if (trace.due(result.expandedCount) || u === target) {
        const path: number[] = [];
        for (let v = u; parent[v] >= 0; v = g.from[parent[v]]) path.push(parent[v]);
        trace.push({ step: result.expandedCount, current: u, path: path.reverse(), best: null });
      }
    }
    if (u === target) {
      const path: number[] = [];
      for (let v = target; parent[v] >= 0; v = g.from[parent[v]]) path.push(parent[v]);
      finishRoute(result, final, costs, path.reverse()); break;
    }
    for (let i = g.outStart[u]; i < g.outStart[u + 1]; i++) {
      const e = g.outEdge[i], v = g.to[e];
      if (!Number.isFinite(costs[e]) || closed[v]) continue;
      const nd = d[u] + costs[e];
      if (nd < d[v]) { d[v] = nd; parent[v] = e; push(v, nd); result.relaxedEdges!++; }
    }
  }
  result.heapPeakEntries = peak;
  if (trace) result.trace = trace.finish({ step: result.expandedCount, current: result.status === "SUCCESS" ? target : -1,
    path: result.pathEdges, best: result.status === "SUCCESS" ? result.pathEdges : null });
  return result;
}
