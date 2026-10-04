import { cchMetricFor } from "./study/cch";
import { FINDERS } from "./study/finders";
import { buildStudyGraph, projector, type StudyGraph } from "./study/graph";
import { STUDY_ALGORITHMS, type SearchStatus, type StudyAlgorithmId } from "./study/search";
import { PENALTY_SEC } from "./config";
import type { Graph } from "./graph";

/**
 * 대시보드용 길찾기. 알고리즘 구현은 실험(src/lib/study)과 같은 것을 쓰고,
 * 여기서는 비용(이동시간 + 현실 보정)을 만들고 결과를 대시보드 형식으로 바꾼다.
 */
export type AlgorithmId = StudyAlgorithmId;

export const ALGORITHMS = STUDY_ALGORITHMS;
export const ALGORITHM_BY_ID = Object.fromEntries(ALGORITHMS.map((a) => [a.id, a])) as Record<AlgorithmId, (typeof ALGORITHMS)[number]>;

/** DFS 한 번의 제한시간 (크기별 실험과 같은 2초) */
export const DFS_TIME_LIMIT_MS = 2000;

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
  status: SearchStatus;
  found: boolean;
  /** 경로의 간선 번호 (출발 → 도착 순) */
  pathEdges: number[];
  costSec: number;
  distanceM: number;
  penaltySec: number;
  /** 자동차: 통과한 교차로 수, 도보: 건넌 횡단보도 수 */
  penaltyCount: number;
  /** 확정(방문)한 서로 다른 노드 수 */
  visited: number;
  /** 간선(CCH 는 지름길) 살펴본 횟수 */
  relaxations: number;
  /** 탐색 순서대로 [어디서, 어디로] 노드 쌍 (record 일 때만). CCH 는 지름길이라 직선으로 그려진다 */
  explored: [number, number][];
}

const studyGraphs = new WeakMap<Graph, StudyGraph>();

/** 대시보드 그래프를 실험용 그래프 형식으로 (평면 좌표를 붙인다) */
export function studyGraphOf(g: Graph): StudyGraph {
  let sg = studyGraphs.get(g);
  if (!sg) {
    let lat0 = 0, lng0 = 0;
    for (let v = 0; v < g.n; v++) {
      lat0 += g.lat[v] / g.n;
      lng0 += g.lng[v] / g.n;
    }
    const project = projector(lat0, lng0);
    const x = new Float64Array(g.n);
    const y = new Float64Array(g.n);
    for (let v = 0; v < g.n; v++) [x[v], y[v]] = project(g.lat[v], g.lng[v]);
    sg = buildStudyGraph({ lat: g.lat, lng: g.lng, x, y, from: g.from, to: g.to, len: g.len });
    studyGraphs.set(g, sg);
  }
  return sg;
}

const weightCache = new WeakMap<Graph, Map<string, Float64Array>>();

/**
 * 간선 비용(초) = 길이 ÷ 속도 (+ 현실 보정).
 * 같은 조건이면 같은 배열을 돌려준다 → CCH 커스터마이징도 한 번만 한다.
 */
export function edgeCosts(g: Graph, o: Pick<SearchOptions, "speed" | "penalties" | "target">): Float64Array {
  let byKey = weightCache.get(g);
  if (!byKey) {
    byKey = new Map();
    weightCache.set(g, byKey);
  }
  // 자동차 교차로 페널티는 도착 교차로에는 붙이지 않으므로 도착점마다 비용이 다르다
  const key = `${o.speed}|${o.penalties}|${o.penalties && g.mode === "car" ? o.target : ""}`;
  let w = byKey.get(key);
  if (w) return w;
  w = new Float64Array(g.m);
  const p = PENALTY_SEC;
  for (let e = 0; e < g.m; e++) {
    let c = g.len[e] / o.speed;
    if (o.penalties) {
      if (g.mode === "car" && g.isIntersection[g.to[e]] && g.to[e] !== o.target) c += p.intersection;
      // 횡단보도 way 가 여러 간선으로 쪼개져 있어도 한 번 건너면 정확히 p 초가 되도록 길이 비율로 나눈다
      if (g.mode === "walk" && g.crossing[e] >= 0) c += (p.crossing * g.len[e]) / g.crossingLen[g.crossing[e]];
    }
    w[e] = c;
  }
  byKey.set(key, w);
  return w;
}

export function runAlgorithm(id: AlgorithmId, g: Graph, o: SearchOptions): SearchResult {
  const sg = studyGraphOf(g);
  const w = edgeCosts(g, o);
  const r = FINDERS[id](sg, o.source, o.target, {
    weights: w,
    // 힌트 = 직선거리 ÷ 속도. 보정은 더하기만 하므로 실제 비용을 넘지 않는다 (좌표 반올림 여유 1%)
    heuristicScale: 0.99 / o.speed,
    timeLimitMs: id === "dfs" ? DFS_TIME_LIMIT_MS : null,
    recordTrace: o.record,
    maxFrames: 2,
  });

  const found = r.status === "SUCCESS";
  let penaltyCount = 0;
  if (found && o.penalties) {
    const crossings = new Set<number>();
    for (const e of r.pathEdges) {
      if (g.mode === "car" && g.isIntersection[g.to[e]] && g.to[e] !== o.target) penaltyCount++;
      if (g.mode === "walk" && g.crossing[e] >= 0) crossings.add(g.crossing[e]);
    }
    if (g.mode === "walk") penaltyCount = crossings.size;
  }
  const explored: [number, number][] = [];
  if (r.trace) r.trace.order.forEach((v, i) => r.trace!.via[i] >= 0 && explored.push([r.trace!.via[i], v]));
  const costSec = found ? r.cost! : NaN;
  const distanceM = found ? r.lengthM! : NaN;
  return {
    status: r.status,
    found,
    pathEdges: r.pathEdges,
    costSec,
    distanceM,
    penaltySec: found && o.penalties ? Math.max(0, costSec - distanceM / o.speed) : 0,
    penaltyCount,
    visited: r.uniqueVisited,
    relaxations: r.relaxations,
    explored,
  };
}

/** CCH 전처리 · 커스터마이징에 든 시간 (질의 시간과 따로 보여 준다) */
export function cchSetupCost(g: Graph, o: Pick<SearchOptions, "speed" | "penalties" | "target">) {
  const m = cchMetricFor(studyGraphOf(g), edgeCosts(g, o));
  return { prepMs: m.prep.prepMs, customizeMs: m.customizeMs, shortcuts: m.prep.shortcuts };
}
