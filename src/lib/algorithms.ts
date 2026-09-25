import { PENALTY_SEC } from "./config";
import { haversine, type Graph } from "./graph";
import { MinHeap } from "./heap";

export type AlgorithmId = "dijkstra" | "astar" | "bidijkstra" | "greedy" | "bellmanford";

export interface AlgorithmInfo {
  id: AlgorithmId;
  name: string;
  short: string;
  complexity: string;
  optimal: boolean;
  summary: string;
}

export const ALGORITHMS: AlgorithmInfo[] = [
  {
    id: "dijkstra",
    name: "다익스트라",
    short: "Dijkstra",
    complexity: "O((V + E) log V)",
    optimal: true,
    summary: "출발지에서 가까운 노드부터 차례로 확정한다. 목적지 방향을 모르므로 원 모양으로 퍼지며 탐색한다.",
  },
  {
    id: "astar",
    name: "A*",
    short: "A*",
    complexity: "O((V + E) log V), 실제로는 훨씬 적게 탐색",
    optimal: true,
    summary: "다익스트라에 '목적지까지 남은 직선거리 ÷ 속도' 휴리스틱을 더해 목적지 쪽 노드를 먼저 확정한다. 휴리스틱이 실제 비용을 넘지 않으므로 최적 경로를 보장한다.",
  },
  {
    id: "bidijkstra",
    name: "양방향 다익스트라",
    short: "Bi-Dijkstra",
    complexity: "O((V + E) log V), 탐색 반경이 절반인 원 두 개",
    optimal: true,
    summary: "출발지와 목적지에서 동시에 다익스트라를 돌리고, 두 탐색이 만나 더 나은 경로가 없음이 증명되면 멈춘다.",
  },
  {
    id: "greedy",
    name: "탐욕 최우선 탐색",
    short: "Greedy Best-First",
    complexity: "O((V + E) log V), 보통 매우 적게 탐색",
    optimal: false,
    summary: "지금까지 온 비용은 무시하고 목적지까지 직선거리가 가장 짧은 노드만 따라간다. 빠르지만 최적 경로를 보장하지 않는다.",
  },
  {
    id: "bellmanford",
    name: "벨만-포드",
    short: "Bellman-Ford",
    complexity: "O(V · E)",
    optimal: true,
    summary: "모든 간선을 반복해서 완화(relax)한다. 음수 가중치도 다룰 수 있지만 도로망처럼 가중치가 모두 양수이면 가장 느리다.",
  },
];

export const ALGORITHM_BY_ID = Object.fromEntries(ALGORITHMS.map((a) => [a.id, a])) as Record<AlgorithmId, AlgorithmInfo>;

export interface SearchOptions {
  source: number;
  target: number;
  /** m/s */
  speed: number;
  /** 현실 보정 (교차로 / 횡단보도 페널티) 적용 여부 */
  penalties: boolean;
  /** 탐색 과정(애니메이션용) 기록 여부 */
  record: boolean;
}

export interface SearchResult {
  found: boolean;
  /** 경로의 간선 번호 (출발 → 도착 순) */
  pathEdges: number[];
  costSec: number;
  distanceM: number;
  penaltySec: number;
  /** 자동차: 통과한 교차로 수, 도보: 건넌 횡단보도 수 */
  penaltyCount: number;
  /** 확정(settle)한 노드 수. 벨만-포드는 한 번이라도 도달한 노드 수 */
  visited: number;
  /** 간선 완화 시도 횟수 */
  relaxations: number;
  /** 벨만-포드 반복 횟수 */
  rounds?: number;
  /** 탐색 트리에 추가된 간선 순서 (record 일 때만) */
  explored: number[];
}

type CostFn = (e: number) => number;

function costFn(g: Graph, o: SearchOptions): CostFn {
  const { len, to, isIntersection, crossing, crossingLen } = g;
  const speed = o.speed;
  if (!o.penalties) return (e) => len[e] / speed;
  if (g.mode === "car") {
    const t = o.target;
    const p = PENALTY_SEC.intersection;
    return (e) => len[e] / speed + (isIntersection[to[e]] && to[e] !== t ? p : 0);
  }
  const p = PENALTY_SEC.crossing;
  // 횡단보도 way 가 여러 간선으로 쪼개져 있어도 한 번 건너면 정확히 p 초가 되도록 길이 비율로 나눈다
  return (e) => {
    const c = crossing[e];
    return len[e] / speed + (c >= 0 ? (p * len[e]) / crossingLen[c] : 0);
  };
}

function summarize(g: Graph, o: SearchOptions, pathEdges: number[], cost: CostFn) {
  let distanceM = 0;
  let costSec = 0;
  const crossings = new Set<number>();
  let intersections = 0;
  for (const e of pathEdges) {
    distanceM += g.len[e];
    costSec += cost(e);
    if (o.penalties) {
      if (g.mode === "car" && g.isIntersection[g.to[e]] && g.to[e] !== o.target) intersections++;
      if (g.mode === "walk" && g.crossing[e] >= 0) crossings.add(g.crossing[e]);
    }
  }
  const penaltySec = o.penalties ? costSec - distanceM / o.speed : 0;
  const penaltyCount = g.mode === "car" ? intersections : crossings.size;
  return { distanceM, costSec, penaltySec: Math.max(0, penaltySec), penaltyCount };
}

function tracePath(g: Graph, parentEdge: Int32Array, target: number): number[] {
  const path: number[] = [];
  let v = target;
  while (parentEdge[v] >= 0) {
    const e = parentEdge[v];
    path.push(e);
    v = g.from[e];
  }
  return path.reverse();
}

function emptyResult(): SearchResult {
  return { found: false, pathEdges: [], costSec: Infinity, distanceM: 0, penaltySec: 0, penaltyCount: 0, visited: 0, relaxations: 0, explored: [] };
}

/** 다익스트라와 A*, 탐욕 탐색은 우선순위 함수만 다르다. */
function bestFirst(g: Graph, o: SearchOptions, kind: "dijkstra" | "astar" | "greedy"): SearchResult {
  const { source: s, target: t, speed } = o;
  const cost = costFn(g, o);
  const dist = new Float64Array(g.n).fill(Infinity);
  const parentEdge = new Int32Array(g.n).fill(-1);
  const closed = new Uint8Array(g.n);
  const tLat = g.lat[t];
  const tLng = g.lng[t];
  const h = (v: number) => haversine(g.lat[v], g.lng[v], tLat, tLng) / speed;

  const heap = new MinHeap();
  dist[s] = 0;
  heap.push(kind === "dijkstra" ? 0 : h(s), s);
  const res = emptyResult();

  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue;
    closed[u] = 1;
    res.visited++;
    if (o.record && parentEdge[u] >= 0) res.explored.push(parentEdge[u]);
    if (u === t) break;
    for (let i = g.outStart[u]; i < g.outStart[u + 1]; i++) {
      const e = g.outEdge[i];
      const v = g.to[e];
      if (closed[v]) continue;
      res.relaxations++;
      if (kind === "greedy") {
        // 탐욕 탐색: 처음 발견한 경로를 그대로 쓴다 (비용 비교 없음)
        if (dist[v] !== Infinity) continue;
        dist[v] = dist[u] + cost(e);
        parentEdge[v] = e;
        heap.push(h(v), v);
        continue;
      }
      const nd = dist[u] + cost(e);
      if (nd < dist[v]) {
        dist[v] = nd;
        parentEdge[v] = e;
        heap.push(kind === "astar" ? nd + h(v) : nd, v);
      }
    }
  }

  if (!closed[t]) return res;
  res.found = true;
  res.pathEdges = tracePath(g, parentEdge, t);
  Object.assign(res, summarize(g, o, res.pathEdges, cost));
  return res;
}

function bidirectionalDijkstra(g: Graph, o: SearchOptions): SearchResult {
  const { source: s, target: t } = o;
  const cost = costFn(g, o);
  const distF = new Float64Array(g.n).fill(Infinity);
  const distB = new Float64Array(g.n).fill(Infinity);
  const parF = new Int32Array(g.n).fill(-1);
  const parB = new Int32Array(g.n).fill(-1);
  const closedF = new Uint8Array(g.n);
  const closedB = new Uint8Array(g.n);
  const heapF = new MinHeap();
  const heapB = new MinHeap();
  const res = emptyResult();

  distF[s] = 0;
  distB[t] = 0;
  heapF.push(0, s);
  heapB.push(0, t);
  let best = s === t ? 0 : Infinity;
  let meetEdge = -1;

  while (heapF.size && heapB.size) {
    if (heapF.peekKey() + heapB.peekKey() >= best) break;
    const forward = heapF.peekKey() <= heapB.peekKey();
    if (forward) {
      const u = heapF.pop();
      if (closedF[u]) continue;
      closedF[u] = 1;
      res.visited++;
      if (o.record && parF[u] >= 0) res.explored.push(parF[u]);
      for (let i = g.outStart[u]; i < g.outStart[u + 1]; i++) {
        const e = g.outEdge[i];
        const v = g.to[e];
        res.relaxations++;
        const nd = distF[u] + cost(e);
        if (nd < distF[v]) {
          distF[v] = nd;
          parF[v] = e;
          heapF.push(nd, v);
        }
        if (distB[v] !== Infinity && distF[u] + cost(e) + distB[v] < best) {
          best = distF[u] + cost(e) + distB[v];
          meetEdge = e;
        }
      }
    } else {
      const u = heapB.pop();
      if (closedB[u]) continue;
      closedB[u] = 1;
      res.visited++;
      if (o.record && parB[u] >= 0) res.explored.push(parB[u]);
      for (let i = g.inStart[u]; i < g.inStart[u + 1]; i++) {
        const e = g.inEdge[i];
        const x = g.from[e];
        res.relaxations++;
        const nd = distB[u] + cost(e);
        if (nd < distB[x]) {
          distB[x] = nd;
          parB[x] = e;
          heapB.push(nd, x);
        }
        if (distF[x] !== Infinity && distF[x] + cost(e) + distB[u] < best) {
          best = distF[x] + cost(e) + distB[u];
          meetEdge = e;
        }
      }
    }
  }

  if (best === Infinity) return res;
  const path: number[] = [];
  if (meetEdge >= 0) {
    path.push(...tracePath(g, parF, g.from[meetEdge]), meetEdge);
    let v = g.to[meetEdge];
    while (parB[v] >= 0) {
      path.push(parB[v]);
      v = g.to[parB[v]];
    }
  }
  res.found = true;
  res.pathEdges = path;
  Object.assign(res, summarize(g, o, path, cost));
  return res;
}

function bellmanFord(g: Graph, o: SearchOptions): SearchResult {
  const { source: s, target: t } = o;
  const cost = costFn(g, o);
  const dist = new Float64Array(g.n).fill(Infinity);
  const parentEdge = new Int32Array(g.n).fill(-1);
  const res = emptyResult();
  dist[s] = 0;
  res.visited = 1;
  let rounds = 0;

  for (let round = 1; round < g.n; round++) {
    rounds = round;
    let changed = false;
    for (let e = 0; e < g.m; e++) {
      const du = dist[g.from[e]];
      if (du === Infinity) continue;
      res.relaxations++;
      const v = g.to[e];
      const nd = du + cost(e);
      if (nd < dist[v]) {
        if (dist[v] === Infinity) {
          res.visited++;
          if (o.record) res.explored.push(e);
        }
        dist[v] = nd;
        parentEdge[v] = e;
        changed = true;
      }
    }
    if (!changed) break;
  }

  res.rounds = rounds;
  if (dist[t] === Infinity) return res;
  res.found = true;
  res.pathEdges = tracePath(g, parentEdge, t);
  Object.assign(res, summarize(g, o, res.pathEdges, cost));
  return res;
}

export function runAlgorithm(id: AlgorithmId, g: Graph, o: SearchOptions): SearchResult {
  switch (id) {
    case "dijkstra":
    case "astar":
    case "greedy":
      return bestFirst(g, o, id);
    case "bidijkstra":
      return bidirectionalDijkstra(g, o);
    case "bellmanford":
      return bellmanFord(g, o);
  }
}
