import type { StudyGraph } from "./graph.ts";
import { TraceRecorder } from "./search.ts";
import { ResearchQueue } from "./researchQueue.ts";
import type { IncrementalResult } from "./lpa.ts";

/** CCH with metric-independent fill, directed basic customization, partial updates,
 * upward bidirectional Dijkstra and recursive shortcut unpacking.
 * https://arxiv.org/abs/1402.0402, sections 4, 7.1, 7.7, 8.
 * Educational coordinate-based nested dissection; not Metis/KaHIP ordering.
 */
export class CchIndex {
  readonly order: number[];
  readonly rank: Int32Array;
  private low: number[] = [];
  private high: number[] = [];
  private upwards: number[][];
  private originals: number[][] = [];
  private triangles: [number, number][][] = [];
  private dependents: Set<number>[] = [];
  private weights: Float64Array;
  private witnessEdge: Int32Array;
  private witnessA: Int32Array;
  private witnessB: Int32Array;
  private originalCosts: Float64Array;
  private originalArc: Int32Array;

  private graph: StudyGraph;
  constructor(graph: StudyGraph, costs: Float64Array) {
    this.graph = graph;
    const adjacency = Array.from({ length: graph.n }, () => new Set<number>());
    for (let e = 0; e < graph.m; e++) {
      const u = graph.from[e], v = graph.to[e];
      if (u !== v) { adjacency[u].add(v); adjacency[v].add(u); }
    }
    this.order = this.nestedDissection(Array.from({ length: graph.n }, (_, v) => v), adjacency);
    this.rank = new Int32Array(graph.n);
    this.order.forEach((v, i) => this.rank[v] = i);
    this.upwards = Array.from({ length: graph.n }, () => []);
    const ids = new Map<number, number>();
    const add = (u: number, v: number) => {
      const lo = this.rank[u] < this.rank[v] ? u : v, hi = lo === u ? v : u, key = lo * graph.n + hi;
      let id = ids.get(key);
      if (id === undefined) {
        id = this.low.length; ids.set(key, id); this.low.push(lo); this.high.push(hi);
        this.upwards[lo].push(id);
        this.originals.push([], []); this.triangles.push([], []); this.dependents.push(new Set(), new Set());
      }
      return id;
    };
    for (let u = 0; u < graph.n; u++) for (const v of adjacency[u]) add(u, v);
    for (const v of this.order) {
      const upper = [...adjacency[v]].filter(u => this.rank[u] > this.rank[v]).sort((a, b) => this.rank[a] - this.rank[b]);
      for (let i = 0; i < upper.length; i++) for (let j = i + 1; j < upper.length; j++) {
        const u = upper[i], w = upper[j], arc = add(u, w);
        adjacency[u].add(w); adjacency[w].add(u);
        const left = add(v, u), right = add(v, w);
        // u -> v -> w, and w -> v -> u. Child ranks are strictly smaller.
        const f: [number, number] = [2 * left + 1, 2 * right];
        const b: [number, number] = [2 * right + 1, 2 * left];
        this.triangles[2 * arc].push(f); this.triangles[2 * arc + 1].push(b);
        for (const child of f) this.dependents[child].add(2 * arc);
        for (const child of b) this.dependents[child].add(2 * arc + 1);
      }
    }
    this.originalArc = new Int32Array(graph.m).fill(-1);
    for (let e = 0; e < graph.m; e++) {
      const u = graph.from[e], v = graph.to[e];
      if (u === v) continue; // nonnegative self-loops never improve a shortest path
      const id = add(u, v), direction = 2 * id + (this.low[id] === u ? 0 : 1);
      this.originals[direction].push(e); this.originalArc[e] = direction;
    }
    const count = 2 * this.low.length;
    this.weights = new Float64Array(count).fill(Infinity);
    this.witnessEdge = new Int32Array(count).fill(-1);
    this.witnessA = new Int32Array(count).fill(-1); this.witnessB = new Int32Array(count).fill(-1);
    this.originalCosts = costs.slice();
    for (const v of this.order) for (const arc of this.upwards[v]) { this.recompute(2 * arc); this.recompute(2 * arc + 1); }
  }
  private nestedDissection(vertices: number[], adjacency: Set<number>[]): number[] {
    if (vertices.length < 12) return vertices.sort((a, b) => adjacency[a].size - adjacency[b].size || a - b);
    const g = this.graph;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of vertices) { minX = Math.min(minX, g.x[v]); maxX = Math.max(maxX, g.x[v]); minY = Math.min(minY, g.y[v]); maxY = Math.max(maxY, g.y[v]); }
    const coordinate = maxX - minX >= maxY - minY ? g.x : g.y;
    vertices.sort((a, b) => coordinate[a] - coordinate[b] || a - b);
    const left = new Set(vertices.slice(0, vertices.length >>> 1)), right = new Set(vertices.slice(vertices.length >>> 1));
    const separator = new Set<number>();
    for (const v of left) for (const u of adjacency[v]) if (right.has(u)) { separator.add(v); break; }
    const l = [...left].filter(v => !separator.has(v)), r = [...right];
    return [...this.nestedDissection(l, adjacency), ...this.nestedDissection(r, adjacency), ...[...separator].sort((a, b) => adjacency[a].size - adjacency[b].size || a - b)];
  }
  get arcCount() { return this.low.length; }
  get shortcutCount() { return this.originals.filter((edges, i) => i % 2 === 0 && !edges.length && !this.originals[i + 1].length).length; }
  get storageBytes() { return this.rank.byteLength + this.weights.byteLength + this.witnessEdge.byteLength + this.witnessA.byteLength + this.witnessB.byteLength + this.originalCosts.byteLength + this.originalArc.byteLength; }
  private recompute(direction: number) {
    let value = Infinity, edge = -1, a = -1, b = -1;
    for (const e of this.originals[direction]) if (this.originalCosts[e] < value) { value = this.originalCosts[e]; edge = e; }
    for (const [left, right] of this.triangles[direction]) {
      const candidate = this.weights[left] + this.weights[right];
      if (candidate < value) { value = candidate; edge = -1; a = left; b = right; }
    }
    const changed = value !== this.weights[direction];
    this.weights[direction] = value; this.witnessEdge[direction] = edge;
    this.witnessA[direction] = a; this.witnessB[direction] = b;
    return changed;
  }
  update(costs: Float64Array) {
    if (costs.length !== this.graph.m || costs.some(c => c < 0 || Number.isNaN(c))) throw new Error("Invalid CCH costs");
    const queue = new ResearchQueue(), queued = new Uint8Array(this.weights.length);
    const push = (direction: number) => {
      if (direction < 0 || queued[direction]) return;
      queued[direction] = 1;
      queue.push({ node: direction, first: this.rank[this.low[direction >>> 1]], second: direction });
    };
    for (let e = 0; e < costs.length; e++) if (costs[e] !== this.originalCosts[e]) push(this.originalArc[e]);
    this.originalCosts.set(costs);
    let updated = 0;
    while (queue.size) {
      const direction = queue.pop().node; queued[direction] = 0; updated++;
      if (this.recompute(direction)) for (const dependent of this.dependents[direction]) push(dependent);
    }
    return updated;
  }
  private unpack(directions: number[]) {
    const edges: number[] = [], pending = directions.slice().reverse();
    while (pending.length) {
      const direction = pending.pop()!;
      if (this.witnessEdge[direction] >= 0) edges.push(this.witnessEdge[direction]);
      else if (this.witnessA[direction] >= 0) pending.push(this.witnessB[direction], this.witnessA[direction]);
      else throw new Error("CCH shortcut without a finite witness");
    }
    return edges;
  }
  query(source: number, target: number, record = false): IncrementalResult & { links: { from: number; to: number }[] } {
    const n = this.graph.n, forward = new Float64Array(n).fill(Infinity), backward = forward.slice();
    const pf = new Int32Array(n).fill(-1), pb = pf.slice(), seen = new Uint8Array(n);
    const trace = record ? new TraceRecorder(n, 70) : null;
    let expanded = 0;
    const directionsTo = (v: number, parents: Int32Array, backwards: boolean) => {
      const result: number[] = [];
      for (let at = v; parents[at] >= 0; at = this.low[parents[at] >>> 1]) result.push(parents[at]);
      return backwards ? result : result.reverse();
    };
    const search = (start: number, distances: Float64Array, parents: Int32Array, backwards: boolean) => {
      const queue = new ResearchQueue(); distances[start] = 0; queue.push({ node: start, first: 0, second: 0 });
      while (queue.size) {
        const entry = queue.pop(), u = entry.node;
        if (entry.first !== distances[u]) continue;
        expanded++; seen[u] = 1;
        if (trace) {
          trace.visit(u);
          if (trace.due(expanded)) trace.push({ step: expanded, current: u, path: this.unpack(directionsTo(u, parents, backwards)), best: null });
        }
        for (const arc of this.upwards[u]) {
          const v = this.high[arc], direction = 2 * arc + Number(backwards), nd = distances[u] + this.weights[direction];
          if (nd < distances[v]) { distances[v] = nd; parents[v] = direction; queue.push({ node: v, first: nd, second: v }); }
        }
      }
    };
    search(source, forward, pf, false); search(target, backward, pb, true);
    let best = Infinity, meeting = -1;
    for (let v = 0; v < n; v++) if (forward[v] + backward[v] < best) { best = forward[v] + backward[v]; meeting = v; }
    const directions = meeting >= 0 ? [...directionsTo(meeting, pf, false), ...directionsTo(meeting, pb, true)] : [];
    const pathEdges = this.unpack(directions);
    return { cost: Number.isFinite(best) ? best : null, pathEdges, expanded, unique: seen.reduce((sum, value) => sum + value, 0), reused: [],
      links: directions.filter(d => this.witnessEdge[d] < 0).map(d => ({ from: d % 2 ? this.high[d >>> 1] : this.low[d >>> 1], to: d % 2 ? this.low[d >>> 1] : this.high[d >>> 1] })),
      trace: trace?.finish({ step: expanded + 1, current: meeting >= 0 ? target : -1, path: pathEdges, best: meeting >= 0 ? pathEdges : null }) ?? null };
  }
}
