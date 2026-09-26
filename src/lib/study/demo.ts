import { timedRun, type StudyConfig } from "./benchmark.ts";
import { FINDERS } from "./finders.ts";
import type { StudyGraph } from "./graph.ts";
import { ladderTitle, type LadderStep } from "./ladder.ts";
import { localIndex, type OdPair } from "./od.ts";
import { STUDY_ALGORITHMS, type SearchStatus, type StudyAlgorithmId } from "./search.ts";

/** 애니메이션 한 장면. 번호는 모두 전체 지도(study.json) 기준 */
export interface DemoFrame {
  step: number;
  visited: number;
  current: number;
  path: number[];
  /** bests 목록의 번호 (-1 = 아직 없음). 같은 최고 기록 길을 장면마다 반복 저장하지 않기 위함 */
  best: number;
}

export interface DemoRun {
  status: SearchStatus;
  lengthM: number | null;
  bestSoFarM: number | null;
  /** 기록 없이 1회 잰 시간 (발표용 참고값. 공식 값은 raw_runs.csv) */
  searchMs: number;
  visitCount: number;
  uniqueVisited: number;
  completePaths: number | null;
  pathEdges: number[];
  order: number[];
  frames: DemoFrame[];
  bests: number[][];
}

export interface DemoPair {
  od: OdPair;
  runs: Record<StudyAlgorithmId, DemoRun>;
}

/** public/study/traces/<label>.json */
export interface DemoFile {
  label: string;
  title: string;
  nodes: number;
  edges: number;
  /** 이 크기의 지도에 포함된 도로 (전체 지도 간선 번호) */
  edgeIds: number[];
  pairs: DemoPair[];
}

/** public/study/traces/index.json */
export interface DemoIndexEntry {
  label: string;
  title: string;
  nodes: number;
  edges: number;
  pairs: { id: string; track: 1 | 2; straightM: number }[];
}

function demoRun(g: StudyGraph, algo: StudyAlgorithmId, s: number, t: number, c: StudyConfig): DemoRun {
  const { ms } = timedRun(algo, g, s, t, c);
  const r = FINDERS[algo](g, s, t, {
    timeLimitMs: algo === "dfs" ? c.run.dfs_time_limit_s * 1000 : null,
    heuristicScale: c.astar.heuristic_scale,
    recordTrace: true,
    maxFrames: c.demo.max_frames,
  });
  const toEdges = (es: number[]) => es.map((e) => g.origEdge[e]);
  const bests: number[][] = [];
  const bestIndex = new Map<number[], number>();
  const frames = (r.trace?.frames ?? []).map((f) => {
    let best = -1;
    if (f.best) {
      best = bestIndex.get(f.best) ?? -1;
      if (best < 0) {
        best = bests.length;
        bests.push(toEdges(f.best));
        bestIndex.set(f.best, best);
      }
    }
    return { step: f.step, visited: f.visited, current: f.current >= 0 ? g.orig[f.current] : -1, path: toEdges(f.path), best };
  });
  return {
    status: r.status,
    lengthM: r.lengthM,
    bestSoFarM: r.bestSoFarM,
    searchMs: ms,
    visitCount: r.visitCount,
    uniqueVisited: r.uniqueVisited,
    completePaths: r.completePaths,
    pathEdges: toEdges(r.pathEdges),
    order: (r.trace?.order ?? []).map((v) => g.orig[v]),
    frames,
    bests,
  };
}

export function makeDemo(step: LadderStep, pairs: OdPair[], c: StudyConfig): DemoFile {
  const g = step.graph;
  const out: DemoPair[] = [];
  for (const od of pairs) {
    const s = localIndex(g, od.source);
    const t = localIndex(g, od.target);
    if (s < 0 || t < 0) continue;
    const runs = {} as Record<StudyAlgorithmId, DemoRun>;
    for (const a of STUDY_ALGORITHMS) runs[a.id] = demoRun(g, a.id, s, t, c);
    out.push({ od, runs });
  }
  return {
    label: step.label,
    title: ladderTitle(step.kind, step.target),
    nodes: g.n,
    edges: g.m,
    edgeIds: Array.from(g.origEdge),
    pairs: out,
  };
}
