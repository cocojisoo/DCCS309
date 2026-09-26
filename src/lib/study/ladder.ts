import { largestSccMask, subgraph, type StudyGraph } from "./graph.ts";
import { TupleHeap } from "./tupleHeap.ts";

/** 크기 사다리의 한 단계 (PROJECT_BLUEPRINT 6.3) */
export interface LadderStep {
  /** "n10", "r500" 같은 고유 이름 */
  label: string;
  kind: "nodes" | "radius";
  /** 목표 교차로 수 또는 반경(m) */
  target: number;
  /** 강연결요소만 남기기 전의 교차로 수 */
  cutNodes: number;
  graph: StudyGraph;
}

export function ladderTitle(kind: LadderStep["kind"], target: number): string {
  return kind === "nodes" ? `교차로 ${target}개` : `반경 ${target >= 1000 ? `${target / 1000}km` : `${target}m`}`;
}

/** 전체 지도에서 중심 좌표(0, 0)에 가장 가까운 교차로. 가장 큰 강연결요소 안에서만 고른다 */
export function centerNode(base: StudyGraph): number {
  const scc = largestSccMask(base);
  let best = -1;
  let bestD = Infinity;
  for (let v = 0; v < base.n; v++) {
    if (!scc[v]) continue;
    const d = Math.hypot(base.x[v], base.y[v]);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** 중심 교차로에서 도로를 따라(방향 무시) 가까운 순서로 count 개 교차로를 고른다 */
function nearestByRoad(base: StudyGraph, center: number, count: number): Uint8Array {
  const dist = new Float64Array(base.n).fill(Infinity);
  const keep = new Uint8Array(base.n);
  const heap = new TupleHeap();
  let seq = 0;
  let taken = 0;
  dist[center] = 0;
  heap.push(0, seq++, 0, center);
  const relax = (v: number, d: number) => {
    if (!keep[v] && d < dist[v]) {
      dist[v] = d;
      heap.push(d, seq++, 0, v);
    }
  };
  while (heap.size && taken < count) {
    const u = heap.pop();
    if (keep[u]) continue;
    keep[u] = 1;
    taken++;
    for (let i = base.outStart[u]; i < base.outStart[u + 1]; i++) relax(base.to[base.outEdge[i]], dist[u] + base.len[base.outEdge[i]]);
    for (let i = base.inStart[u]; i < base.inStart[u + 1]; i++) relax(base.from[base.inEdge[i]], dist[u] + base.len[base.inEdge[i]]);
  }
  return keep;
}

/** 중심 좌표에서 직선 반경 안의 교차로 전부 */
function withinRadius(base: StudyGraph, radiusM: number): Uint8Array {
  const keep = new Uint8Array(base.n);
  for (let v = 0; v < base.n; v++) if (Math.hypot(base.x[v], base.y[v]) <= radiusM) keep[v] = 1;
  return keep;
}

function finish(base: StudyGraph, keep: Uint8Array, label: string, kind: LadderStep["kind"], target: number): LadderStep {
  const cut = subgraph(base, keep);
  // 일방통행 때문에 들어가기만 하고 못 나오는 교차로를 없앤다
  const graph = subgraph(cut, largestSccMask(cut));
  return { label, kind, target, cutNodes: cut.n, graph };
}

export function buildLadder(base: StudyGraph, nodeCounts: number[], radiiM: number[]): LadderStep[] {
  const center = centerNode(base);
  return [
    ...nodeCounts.map((c) => finish(base, nearestByRoad(base, center, c), `n${c}`, "nodes", c)),
    ...radiiM.map((r) => finish(base, withinRadius(base, r), `r${r}`, "radius", r)),
  ];
}
