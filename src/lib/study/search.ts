import type { StudyGraph } from "./graph.ts";

export type StudyAlgorithmId = "dfs" | "dijkstra" | "astar" | "cch" | "lpa";
export type SearchStatus = "SUCCESS" | "TIMEOUT" | "NO_PATH" | "ERROR";

/** 화면과 표에 나오는 순서 (명세서: DFS, 다익스트라, A*, CCH, LPA) */
export const STUDY_ALGORITHMS: { id: StudyAlgorithmId; name: string; role: string }[] = [
  { id: "dfs", name: "DFS", role: "모든 길 확인" },
  { id: "dijkstra", name: "다익스트라", role: "가까운 곳부터" },
  { id: "astar", name: "A*", role: "도착점 방향 힌트" },
  { id: "cch", name: "CCH", role: "미리 계산한 지름길" },
  { id: "lpa", name: "LPA*", role: "바뀐 곳만 다시 계산" },
];

export const STUDY_ALGORITHM_BY_ID = Object.fromEntries(STUDY_ALGORITHMS.map((a) => [a.id, a])) as Record<
  StudyAlgorithmId,
  (typeof STUDY_ALGORITHMS)[number]
>;

export interface SearchOptions {
  /** 제한시간(ms). null 이면 제한 없음 */
  timeLimitMs: number | null;
  /** 애니메이션용 기록. 공식 시간 측정은 항상 false */
  recordTrace?: boolean;
  /** 기록할 최대 프레임 수 */
  maxFrames?: number;
  /**
   * A* · LPA* 힌트 = 도착점까지 직선거리(m) × heuristicScale.
   * 비용이 길이(m)이면 0.999, 이동시간(초)이면 0.999 ÷ 최고 속도(m/s) 처럼 실제 비용을 넘지 않게 정한다.
   */
  heuristicScale?: number;
  /** 도로별 비용. 없으면 도로 길이(m). 이동시간·혼잡·폐쇄(Infinity)를 넣을 수 있다 */
  weights?: Float64Array;
}

/** 비용 배열 (없으면 길이) */
export const weightsOf = (g: StudyGraph, o: SearchOptions): Float64Array => o.weights ?? g.len;

/** 애니메이션 한 장면 */
export interface TraceFrame {
  /** 이 장면까지의 visit_count */
  step: number;
  /** 이 장면까지 처음 들어간 교차로 수 (SearchTrace.order 의 앞부분 길이) */
  visited: number;
  /** 지금 보고 있는 교차로 */
  current: number;
  /** 지금 따라가고 있는 길 (DFS) / 지금 확정한 교차로까지의 길 (다익스트라, A*) */
  path: number[];
  /** 지금까지 찾은 가장 짧은 완성 경로 (없으면 null) */
  best: number[] | null;
}

export interface SearchTrace {
  /** 처음 들어간 순서대로의 교차로 번호 */
  order: number[];
  /** order[i] 에 처음 들어올 때 어느 교차로에서 왔는지 (-1 = 없음). 대시보드 지도의 탐색선에 쓴다 */
  via: number[];
  frames: TraceFrame[];
}

export interface StudySearchResult {
  status: SearchStatus;
  /** 찾은 길의 간선 번호 (출발 → 도착). 성공일 때만 의미가 있다 */
  pathEdges: number[];
  /** 찾은 길의 길이(m). 성공이 아니면 null */
  lengthM: number | null;
  /** 찾은 길의 비용 (weights 합). 비용이 길이이면 lengthM 과 같다. 성공이 아니면 null */
  cost: number | null;
  /** 간선(또는 CCH 지름길)을 살펴본 횟수 */
  relaxations: number;
  /** 교차로에 들어간 총 횟수 (같은 곳 다시 들어가면 또 셈) */
  visitCount: number;
  /** 한 번이라도 들어간 서로 다른 교차로 수 */
  uniqueVisited: number;
  /** 끝까지 만들어 본 완성 경로 수 (DFS 만) */
  completePaths: number | null;
  /** 시간 초과 전까지 찾은 가장 짧은 길(m). 정답 비교에는 쓰지 않는다 */
  bestSoFarM: number | null;
  errorReason?: string;
  trace?: SearchTrace;
}

export type PathFinder = (g: StudyGraph, source: number, target: number, options: SearchOptions) => StudySearchResult;

/**
 * 탐색 기록기. 기록 간격을 두 배씩 늘려 가며 장면 수를 maxFrames 의 2배 이하로 유지하고,
 * 끝나면 균등하게 골라 maxFrames 장으로 줄인다. (보여주는 장면만 줄이고 탐색 자체는 줄이지 않는다)
 */
export class TraceRecorder {
  readonly order: number[] = [];
  private via: number[] = [];
  private frames: TraceFrame[] = [];
  private seen: Uint8Array;
  private interval = 1;
  private maxFrames: number;

  constructor(n: number, maxFrames: number) {
    this.seen = new Uint8Array(n);
    this.maxFrames = Math.max(2, maxFrames);
  }

  /** node 에 처음 들어왔으면 순서에 남긴다. from = 어느 교차로에서 왔는지 (모르면 -1) */
  visit(node: number, from = -1) {
    if (this.seen[node]) return;
    this.seen[node] = 1;
    this.order.push(node);
    this.via.push(from);
  }

  /** 이 step 에서 장면을 남길 차례인지 */
  due(step: number) {
    return step % this.interval === 0;
  }

  push(frame: Omit<TraceFrame, "visited">) {
    this.frames.push({ ...frame, visited: this.order.length });
    if (this.frames.length >= 2 * this.maxFrames) {
      this.interval *= 2;
      this.frames = this.frames.filter((f) => f.step % this.interval === 0);
    }
  }

  finish(last: Omit<TraceFrame, "visited">): SearchTrace {
    if (this.frames.at(-1)?.step !== last.step) this.frames.push({ ...last, visited: this.order.length });
    let frames = this.frames;
    if (frames.length > this.maxFrames) {
      const k = this.maxFrames;
      frames = Array.from({ length: k }, (_, i) => this.frames[Math.round((i * (this.frames.length - 1)) / (k - 1))]);
    }
    return { order: this.order, via: this.via, frames };
  }
}

export function emptyResult(): StudySearchResult {
  return {
    status: "NO_PATH",
    pathEdges: [],
    lengthM: null,
    cost: null,
    relaxations: 0,
    visitCount: 0,
    uniqueVisited: 0,
    completePaths: null,
    bestSoFarM: null,
  };
}

/** 출발 = 도착일 때의 결과 */
export function trivialResult(): StudySearchResult {
  return { ...emptyResult(), status: "SUCCESS", lengthM: 0, cost: 0, visitCount: 1, uniqueVisited: 1 };
}

/** 찾은 길을 결과에 채운다 (길이와 비용은 간선 순서대로 더한다) */
export function setPath(res: StudySearchResult, g: StudyGraph, w: Float64Array, pathEdges: number[]) {
  res.status = "SUCCESS";
  res.pathEdges = pathEdges;
  res.lengthM = pathEdges.reduce((s, e) => s + g.len[e], 0);
  res.cost = pathEdges.reduce((s, e) => s + w[e], 0);
}

/**
 * 반환된 길이 실제로 이어지는지 확인한다 (PROJECT_BLUEPRINT 7.6 RouteChecker).
 * 간선이 방향 그래프의 간선이므로 이어지기만 하면 일방통행을 거꾸로 가지 않은 것이다.
 */
export function checkRoute(g: StudyGraph, source: number, target: number, pathEdges: number[], lengthM: number): string | null {
  if (source === target) return pathEdges.length === 0 && lengthM === 0 ? null : "출발 = 도착인데 길이 비어 있지 않음";
  if (!pathEdges.length) return "빈 경로";
  let cur = source;
  let sum = 0;
  for (const e of pathEdges) {
    if (!(e >= 0 && e < g.m)) return `없는 도로 번호 ${e}`;
    if (g.from[e] !== cur) return `도로 ${e} 가 앞 도로와 이어지지 않음`;
    sum += g.len[e];
    cur = g.to[e];
  }
  if (cur !== target) return "도착 교차로에서 끝나지 않음";
  if (Math.abs(sum - lengthM) > 0.01) return `길이 합 ${sum.toFixed(3)}m ≠ 보고한 길이 ${lengthM.toFixed(3)}m`;
  return null;
}

/**
 * A* 힌트 안전 확인 (PROJECT_BLUEPRINT 8.4).
 * 모든 도로에서 scale × 직선거리(양 끝) ≤ 도로 길이이면, 삼각부등식으로 어떤 도착점에 대해서도
 * h(출발쪽) ≤ 도로 길이 + h(도착쪽) 가 성립한다. 어긋나는 도로 목록을 돌려준다.
 */
export function checkHeuristic(g: StudyGraph, scale: number): { edge: number; straightM: number; lengthM: number }[] {
  const bad: { edge: number; straightM: number; lengthM: number }[] = [];
  for (let e = 0; e < g.m; e++) {
    const d = Math.hypot(g.x[g.from[e]] - g.x[g.to[e]], g.y[g.from[e]] - g.y[g.to[e]]);
    if (scale * d > g.len[e] + 1e-9) bad.push({ edge: g.origEdge[e], straightM: d, lengthM: g.len[e] });
  }
  return bad;
}
