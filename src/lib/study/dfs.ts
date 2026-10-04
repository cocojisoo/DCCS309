import type { StudyGraph } from "./graph.ts";
import { emptyResult, setPath, TraceRecorder, trivialResult, weightsOf, type SearchOptions, type StudySearchResult } from "./search.ts";

/** 몇 번 방문할 때마다 제한시간을 확인하는지 */
const CLOCK_EVERY = 1000;

/**
 * DFS (naive, PROJECT_BLUEPRINT 8.2).
 * 출발점에서 갈 수 있는 모든 길을 끝까지 따라가 보고, 도착한 길 중 비용이 가장 작은 것을 고른다.
 * 지금 가고 있는 길에 이미 있는 교차로만 다시 들어가지 않는다. 가지치기는 넣지 않는다.
 * 재귀 대신 직접 만든 스택을 쓴다.
 */
export function dfsSearch(g: StudyGraph, source: number, target: number, o: SearchOptions): StudySearchResult {
  if (source === target) return { ...trivialResult(), completePaths: 0 };
  const res = emptyResult();
  const w = weightsOf(g, o);

  const n = g.n;
  const onPath = new Uint8Array(n);
  const seen = new Uint8Array(n);
  // 깊이 d 의 교차로, 다음에 볼 인접 도로 위치, 그 교차로까지 오는 데 쓴 도로, 누적 비용
  const nodeAt = new Int32Array(n);
  const nextAt = new Int32Array(n);
  const edgeAt = new Int32Array(n);
  const costAt = new Float64Array(n);
  const rec = o.recordTrace ? new TraceRecorder(n, o.maxFrames ?? 100) : null;
  const deadline = o.timeLimitMs === null ? Infinity : performance.now() + o.timeLimitMs;

  let depth = 0;
  nodeAt[0] = source;
  nextAt[0] = g.outStart[source];
  onPath[source] = 1;
  seen[source] = 1;
  let visits = 1;
  let unique = 1;
  let relax = 0;
  let complete = 0;
  let best = Infinity;
  let bestPath: number[] | null = null;
  let timedOut = false;
  rec?.visit(source);

  /** 지금 스택의 길 (+ 마지막 도로 e) */
  const currentPath = (e: number) => {
    const p = Array.from(edgeAt.subarray(1, depth + 1));
    p.push(e);
    return p;
  };

  while (depth >= 0) {
    const u = nodeAt[depth];
    const i = nextAt[depth];
    if (i === g.outStart[u + 1]) {
      onPath[u] = 0;
      depth--;
      continue;
    }
    nextAt[depth] = i + 1;
    const e = g.outEdge[i];
    const v = g.to[e];
    relax++;
    if (onPath[v] || w[e] === Infinity) continue;

    visits++;
    if (!seen[v]) {
      seen[v] = 1;
      unique++;
    }
    const d = costAt[depth] + w[e];

    if (v === target) {
      complete++;
      if (d < best) {
        best = d;
        bestPath = currentPath(e);
      }
    }
    if (rec) {
      rec.visit(v, u);
      if (rec.due(visits)) rec.push({ step: visits, current: v, path: currentPath(e), best: bestPath });
    }
    if (visits % CLOCK_EVERY === 0 && performance.now() > deadline) {
      timedOut = true;
      break;
    }
    // 도착점을 지나서 더 가면 다시 도착점으로 돌아올 수 없으므로 거기서 그 길은 끝난다
    if (v === target) continue;

    depth++;
    nodeAt[depth] = v;
    nextAt[depth] = g.outStart[v];
    edgeAt[depth] = e;
    costAt[depth] = d;
    onPath[v] = 1;
  }

  res.visitCount = visits;
  res.uniqueVisited = unique;
  res.relaxations = relax;
  res.completePaths = complete;
  res.bestSoFarM = bestPath ? bestPath.reduce((s, e) => s + g.len[e], 0) : null;
  if (timedOut) res.status = "TIMEOUT";
  else if (bestPath) setPath(res, g, w, bestPath);
  if (rec) {
    const last = res.status === "SUCCESS" ? res.pathEdges : bestPath ?? [];
    res.trace = rec.finish({ step: visits, current: timedOut ? nodeAt[Math.max(0, depth)] : target, path: last, best: bestPath });
  }
  return res;
}
