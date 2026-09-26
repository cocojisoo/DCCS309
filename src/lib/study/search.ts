import type { StudyGraph } from "./graph.ts";

export type StudyAlgorithmId = "dfs" | "dijkstra" | "astar";
export type SearchStatus = "SUCCESS" | "TIMEOUT" | "NO_PATH" | "ERROR";

export const STUDY_ALGORITHMS: { id: StudyAlgorithmId; name: string; role: string }[] = [
  { id: "dfs", name: "DFS", role: "naive · 모든 길 확인" },
  { id: "dijkstra", name: "다익스트라", role: "better" },
  { id: "astar", name: "A*", role: "더 better" },
];

export interface SearchOptions {
  /** 제한시간(ms). null 이면 제한 없음 */
  timeLimitMs: number | null;
  /** 애니메이션용 기록. 공식 시간 측정은 항상 false */
  recordTrace?: boolean;
  /** 기록할 최대 프레임 수 */
  maxFrames?: number;
  /** A* 힌트 배율 (직선거리 × scale) */
  heuristicScale?: number;
}

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
  frames: TraceFrame[];
}

export interface StudySearchResult {
  status: SearchStatus;
  /** 찾은 길의 간선 번호 (출발 → 도착). 성공일 때만 의미가 있다 */
  pathEdges: number[];
  /** 찾은 길의 길이(m). 성공이 아니면 null */
  lengthM: number | null;
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
  private frames: TraceFrame[] = [];
  private seen: Uint8Array;
  private interval = 1;
  private maxFrames: number;

  constructor(n: number, maxFrames: number) {
    this.seen = new Uint8Array(n);
    this.maxFrames = Math.max(2, maxFrames);
  }

  visit(node: number) {
    if (this.seen[node]) return;
    this.seen[node] = 1;
    this.order.push(node);
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
    return { order: this.order, frames };
  }
}

export function emptyResult(): StudySearchResult {
  return { status: "NO_PATH", pathEdges: [], lengthM: null, visitCount: 0, uniqueVisited: 0, completePaths: null, bestSoFarM: null };
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
