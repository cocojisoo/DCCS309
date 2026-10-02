import type { StudyGraph } from "./graph.ts";
import { TraceRecorder, type SearchTrace } from "./search.ts";
import { lessKey, ResearchQueue } from "./researchQueue.ts";

export interface IncrementalResult {
  pathEdges: number[]; cost: number | null; expanded: number; unique: number;
  reused: number[]; trace: SearchTrace | null;
}

/** LPA*, Koenig/Likhachev/Furcy: fixed start/goal, consistent fixed heuristic.
 * https://idm-lab.org/bib/abstracts/papers/aij04.pdf
 * Each session owns g/rhs and preserves them across cost increases AND decreases.
 */
export class LpaSearch {
  private distances: Float64Array;
  private rhs: Float64Array;
  private versions: Uint32Array;
  private queue = new ResearchQueue();
  private costs: Float64Array;
  private hasSearched = false;
  private graph: StudyGraph;
  private source: number;
  private target: number;
  private heuristicScale: number;
  constructor(graph: StudyGraph, source: number, target: number, costs: Float64Array, heuristicScale: number) {
    this.graph = graph; this.source = source; this.target = target; this.heuristicScale = heuristicScale;
    this.distances = new Float64Array(graph.n).fill(Infinity);
    this.rhs = new Float64Array(graph.n).fill(Infinity);
    this.versions = new Uint32Array(graph.n);
    this.costs = costs.slice();
    this.rhs[source] = 0;
    this.enqueue(source);
  }
  get storageBytes() { return this.distances.byteLength + this.rhs.byteLength + this.versions.byteLength + this.costs.byteLength; }
  private key(v: number): [number, number] {
    const value = Math.min(this.distances[v], this.rhs[v]), g = this.graph;
    return [value + this.heuristicScale * Math.hypot(g.x[v] - g.x[this.target], g.y[v] - g.y[this.target]), value];
  }
  private enqueue(v: number) {
    const version = ++this.versions[v];
    if (this.distances[v] !== this.rhs[v]) {
      const [first, second] = this.key(v);
      this.queue.push({ node: v, first, second, version });
    }
  }
  private updateVertex(v: number) {
    if (v !== this.source) {
      let rhs = Infinity;
      const g = this.graph;
      for (let i = g.inStart[v]; i < g.inStart[v + 1]; i++) {
        const e = g.inEdge[i];
        rhs = Math.min(rhs, this.distances[g.from[e]] + this.costs[e]);
      }
      this.rhs[v] = rhs;
    }
    this.enqueue(v);
  }
  private validTop() {
    while (this.queue.size && this.queue.peek().version !== this.versions[this.queue.peek().node]) this.queue.pop();
    return this.queue.peek();
  }
  /** Reconstruct with tight incoming edges; handles zero-cost cycles and ties. */
  private route(end: number) {
    if (!Number.isFinite(this.distances[end])) return [];
    const g = this.graph, next = new Int32Array(g.n).fill(-1), seen = new Uint8Array(g.n);
    const pending = [end]; seen[end] = 1;
    for (let i = 0; i < pending.length && !seen[this.source]; i++) {
      const v = pending[i];
      for (let j = g.inStart[v]; j < g.inStart[v + 1]; j++) {
        const e = g.inEdge[j], u = g.from[e];
        if (seen[u] || !Number.isFinite(this.costs[e]) || !Number.isFinite(this.distances[u])) continue;
        const candidate = this.distances[u] + this.costs[e];
        if (Math.abs(candidate - this.distances[v]) > 1e-8 * Math.max(1, Math.abs(this.distances[v]))) continue;
        seen[u] = 1; next[u] = e; pending.push(u);
      }
    }
    if (!seen[this.source]) return [];
    const path: number[] = [];
    for (let v = this.source; v !== end;) { const e = next[v]; path.push(e); v = g.to[e]; }
    return path;
  }
  search(nextCosts: Float64Array, record = false): IncrementalResult {
    const g = this.graph;
    if (nextCosts.length !== g.m || nextCosts.some(c => c < 0 || Number.isNaN(c))) throw new Error("Invalid LPA* costs");
    const before = this.hasSearched ? this.distances.slice() : null;
    const affected = new Set<number>();
    for (let e = 0; e < g.m; e++) if (nextCosts[e] !== this.costs[e]) affected.add(g.to[e]);
    this.costs.set(nextCosts);
    for (const v of affected) this.updateVertex(v);
    const trace = record ? new TraceRecorder(g.n, 70) : null, processed = new Uint8Array(g.n);
    let expanded = 0, top = this.validTop();
    while (top && (lessKey([top.first, top.second], this.key(this.target)) || this.rhs[this.target] !== this.distances[this.target])) {
      const entry = this.queue.pop(), u = entry.node;
      if (lessKey([entry.first, entry.second], this.key(u))) this.enqueue(u);
      else {
        expanded++; processed[u] = 1;
        if (this.distances[u] > this.rhs[u]) this.distances[u] = this.rhs[u];
        else { this.distances[u] = Infinity; this.updateVertex(u); }
        for (let i = g.outStart[u]; i < g.outStart[u + 1]; i++) this.updateVertex(g.to[g.outEdge[i]]);
        if (trace) {
          trace.visit(u);
          if (trace.due(expanded)) trace.push({ step: expanded, current: u, path: this.route(u), best: null });
        }
      }
      top = this.validTop();
    }
    const pathEdges = this.route(this.target), finite = Number.isFinite(this.distances[this.target]);
    if (finite && this.source !== this.target && !pathEdges.length) throw new Error("LPA* route reconstruction failed");
    const reused: number[] = [];
    if (before) for (let v = 0; v < g.n; v++) if (Number.isFinite(before[v]) && !processed[v] && before[v] === this.distances[v]) reused.push(v);
    this.hasSearched = true;
    return { pathEdges, cost: finite ? this.distances[this.target] : null, expanded,
      unique: processed.reduce((sum, value) => sum + value, 0), reused,
      trace: trace?.finish({ step: expanded + 1, current: finite ? this.target : -1, path: pathEdges, best: finite ? pathEdges : null }) ?? null };
  }
}
