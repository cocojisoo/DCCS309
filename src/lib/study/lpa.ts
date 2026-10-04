import type { StudyGraph } from "./graph.ts";
import { emptyResult, setPath, TraceRecorder, trivialResult, weightsOf, type SearchOptions, type StudySearchResult } from "./search.ts";
import { TupleHeap } from "./tupleHeap.ts";

/**
 * LPA* (Lifelong Planning A*, Koenig · Likhachev · Furcy 2004)
 *
 * 같은 출발·도착을 계속 다시 계산해야 할 때 쓰는 A*.
 *  - g(v): 지금까지 확정한 출발점→v 비용, rhs(v): 들어오는 도로들로 한 단계 앞을 내다본 비용
 *  - g ≠ rhs 인 교차로(=비용이 어긋난 곳)만 큐에 넣고, A* 처럼 힌트를 더한 순서로 고친다.
 *  - 도로 비용이 바뀌면 그 도로의 도착 교차로만 다시 검사하고, 어긋남이 퍼지는 곳만 다시 계산한다.
 * 처음 한 번은 A* 와 거의 같은 일을 하고, 그 다음부터는 바뀐 곳 근처만 다시 본다.
 */
export class LpaStar {
  readonly g: StudyGraph;
  readonly source: number;
  readonly target: number;
  w: Float64Array;
  private scale: number;
  private gv: Float64Array;
  private rhs: Float64Array;
  /** rhs 를 만든 들어오는 도로 (경로 복원용) */
  private bp: Int32Array;
  private inQueue: Uint8Array;
  private queueSeq: Float64Array;
  private heap = new TupleHeap();
  private seq = 0;
  private relax = 0;

  constructor(g: StudyGraph, source: number, target: number, weights: Float64Array, heuristicScale: number) {
    this.g = g;
    this.source = source;
    this.target = target;
    this.w = weights.slice();
    this.scale = heuristicScale;
    this.gv = new Float64Array(g.n).fill(Infinity);
    this.rhs = new Float64Array(g.n).fill(Infinity);
    this.bp = new Int32Array(g.n).fill(-1);
    this.inQueue = new Uint8Array(g.n);
    this.queueSeq = new Float64Array(g.n);
    this.rhs[source] = 0;
    this.insert(source);
  }

  private h(v: number) {
    const g = this.g;
    return this.scale * Math.hypot(g.x[v] - g.x[this.target], g.y[v] - g.y[this.target]);
  }

  private insert(v: number) {
    const k2 = Math.min(this.gv[v], this.rhs[v]);
    const s = this.seq++;
    this.inQueue[v] = 1;
    this.queueSeq[v] = s;
    this.heap.push(k2 + this.h(v), k2, s, v);
  }

  /** 맨 위의 유효한 항목만 남긴다 (지난 키로 들어간 항목은 버린다) */
  private clean() {
    while (this.heap.size) {
      const v = this.heap.topValue();
      if (this.inQueue[v] && this.queueSeq[v] === this.heap.topC()) return;
      this.heap.pop();
    }
  }

  private updateVertex(v: number) {
    const g = this.g;
    if (v !== this.source) {
      let best = Infinity;
      let be = -1;
      for (let i = g.inStart[v]; i < g.inStart[v + 1]; i++) {
        const e = g.inEdge[i];
        this.relax++;
        const c = this.gv[g.from[e]] + this.w[e];
        if (c < best) {
          best = c;
          be = e;
        }
      }
      this.rhs[v] = best;
      this.bp[v] = be;
    }
    this.inQueue[v] = 0;
    if (this.gv[v] !== this.rhs[v]) this.insert(v);
  }

  /** 도로 비용을 바꾼다 (폐쇄는 Infinity). 다음 compute() 때 바뀐 곳 근처만 다시 계산한다 */
  setWeight(e: number, cost: number) {
    if (this.w[e] === cost) return;
    this.w[e] = cost;
    this.updateVertex(this.g.to[e]);
  }

  /** 어긋난 교차로가 없어질 때까지(도착점까지 확정될 때까지) 고친다 */
  compute(
    o: Pick<SearchOptions, "recordTrace" | "maxFrames"> & {
      /** 교차로를 하나 꺼낼 때마다 (꺼내기 전의 g, rhs). 알고리즘 교실 설명용 */
      onExpand?: (u: number, g: number, rhs: number) => void;
    } = {},
  ): StudySearchResult {
    const g = this.g;
    const t = this.target;
    if (this.source === t) return trivialResult();
    const res = emptyResult();
    const rec = o.recordTrace ? new TraceRecorder(g.n, o.maxFrames ?? 100) : null;
    const expanded = new Uint8Array(g.n);
    let visits = 0;
    let unique = 0;
    this.relax = 0;

    for (;;) {
      this.clean();
      if (!this.heap.size) break;
      const tk2 = Math.min(this.gv[t], this.rhs[t]);
      const tk1 = tk2 + this.h(t);
      const a = this.heap.topA();
      const b = this.heap.topB();
      const topLess = a < tk1 || (a === tk1 && b < tk2);
      if (!topLess && this.rhs[t] === this.gv[t]) break;

      const u = this.heap.pop();
      this.inQueue[u] = 0;
      visits++;
      if (!expanded[u]) {
        expanded[u] = 1;
        unique++;
      }
      if (rec) {
        rec.visit(u, this.bp[u] >= 0 ? g.from[this.bp[u]] : -1);
        if (rec.due(visits)) rec.push({ step: visits, current: u, path: [], best: null });
      }
      o.onExpand?.(u, this.gv[u], this.rhs[u]);
      if (this.gv[u] > this.rhs[u]) {
        this.gv[u] = this.rhs[u];
        for (let i = g.outStart[u]; i < g.outStart[u + 1]; i++) this.updateVertex(g.to[g.outEdge[i]]);
      } else {
        this.gv[u] = Infinity;
        this.updateVertex(u);
        for (let i = g.outStart[u]; i < g.outStart[u + 1]; i++) this.updateVertex(g.to[g.outEdge[i]]);
      }
    }

    res.visitCount = visits;
    res.uniqueVisited = unique;
    res.relaxations = this.relax;
    if (this.gv[t] < Infinity) {
      const path: number[] = [];
      for (let v = t, guard = 0; v !== this.source && guard <= g.n; guard++) {
        const e = this.bp[v];
        if (e < 0) break;
        path.push(e);
        v = g.from[e];
      }
      path.reverse();
      if (path.length && g.from[path[0]] === this.source) setPath(res, g, this.w, path);
      else {
        res.status = "ERROR";
        res.errorReason = "LPA*: 경로 복원 실패";
      }
    }
    if (rec) res.trace = rec.finish({ step: visits, current: t, path: res.pathEdges, best: res.status === "SUCCESS" ? res.pathEdges : null });
    return res;
  }
}

/** 다른 방법과 같은 모양의 길찾기 함수 (매번 처음부터 = 첫 계획) */
export function lpaSearch(g: StudyGraph, source: number, target: number, o: SearchOptions): StudySearchResult {
  return new LpaStar(g, source, target, weightsOf(g, o), o.heuristicScale ?? 0.999).compute(o);
}
