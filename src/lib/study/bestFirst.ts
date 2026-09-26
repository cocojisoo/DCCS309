import type { StudyGraph } from "./graph.ts";
import { emptyResult, TraceRecorder, type SearchOptions, type StudySearchResult } from "./search.ts";
import { TupleHeap } from "./tupleHeap.ts";

const CLOCK_EVERY = 1000;

function tracePath(g: StudyGraph, parentEdge: Int32Array, v: number): number[] {
  const path: number[] = [];
  while (parentEdge[v] >= 0) {
    const e = parentEdge[v];
    path.push(e);
    v = g.from[e];
  }
  return path.reverse();
}

/**
 * 다익스트라와 A* 는 힙에 넣는 우선순위만 다르다 (PROJECT_BLUEPRINT 8.3, 8.4).
 *  - 다익스트라: (지금까지 거리, 순번)
 *  - A*: (지금까지 거리 + 힌트, −지금까지 거리, 순번). 힌트 = 도착점까지 직선거리 × scale.
 *    우선순위가 같으면 지금까지 거리가 더 긴 쪽(도착점에 더 가까운 쪽)을 먼저 꺼낸다.
 * 꺼낸 교차로가 이미 확정된 것이면 건너뛰고, 도착점을 꺼내면 멈춘다.
 */
function bestFirst(g: StudyGraph, source: number, target: number, o: SearchOptions, astar: boolean): StudySearchResult {
  const res = emptyResult();
  if (source === target) return { ...res, status: "SUCCESS", lengthM: 0, visitCount: 1, uniqueVisited: 1 };

  const scale = o.heuristicScale ?? 0.999;
  const tx = g.x[target];
  const ty = g.y[target];
  const h = (v: number) => scale * Math.hypot(g.x[v] - tx, g.y[v] - ty);
  const dist = new Float64Array(g.n).fill(Infinity);
  const parentEdge = new Int32Array(g.n).fill(-1);
  const closed = new Uint8Array(g.n);
  const heap = new TupleHeap();
  const rec = o.recordTrace ? new TraceRecorder(g.n, o.maxFrames ?? 100) : null;
  const deadline = o.timeLimitMs === null ? Infinity : performance.now() + o.timeLimitMs;
  let seq = 0;
  const push = (d: number, v: number) => (astar ? heap.push(d + h(v), -d, seq++, v) : heap.push(d, seq++, 0, v));

  dist[source] = 0;
  push(0, source);
  let visits = 0;
  let found = false;
  let timedOut = false;

  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue;
    closed[u] = 1;
    visits++;
    if (rec) {
      rec.visit(u);
      if (rec.due(visits) || u === target) rec.push({ step: visits, current: u, path: tracePath(g, parentEdge, u), best: null });
    }
    if (u === target) {
      found = true;
      break;
    }
    if (visits % CLOCK_EVERY === 0 && performance.now() > deadline) {
      timedOut = true;
      break;
    }
    const du = dist[u];
    for (let i = g.outStart[u]; i < g.outStart[u + 1]; i++) {
      const e = g.outEdge[i];
      const v = g.to[e];
      if (closed[v]) continue;
      const nd = du + g.len[e];
      if (nd < dist[v]) {
        dist[v] = nd;
        parentEdge[v] = e;
        push(nd, v);
      }
    }
  }

  // 확정할 때마다 1번 세므로 방문 횟수 = 서로 다른 방문 교차로 수
  res.visitCount = visits;
  res.uniqueVisited = visits;
  if (timedOut) res.status = "TIMEOUT";
  else if (found) {
    res.status = "SUCCESS";
    res.pathEdges = tracePath(g, parentEdge, target);
    res.lengthM = res.pathEdges.reduce((s, e) => s + g.len[e], 0);
  }
  if (rec) res.trace = rec.finish({ step: visits, current: found ? target : -1, path: res.pathEdges, best: found ? res.pathEdges : null });
  return res;
}

export function dijkstraSearch(g: StudyGraph, source: number, target: number, o: SearchOptions): StudySearchResult {
  return bestFirst(g, source, target, o, false);
}

export function astarSearch(g: StudyGraph, source: number, target: number, o: SearchOptions): StudySearchResult {
  return bestFirst(g, source, target, o, true);
}
