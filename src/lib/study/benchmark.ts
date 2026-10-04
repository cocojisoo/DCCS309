import type { StudyGraph } from "./graph.ts";
import { FINDERS } from "./finders.ts";
import { buildLadder, type LadderStep } from "./ladder.ts";
import { localIndex, pickFixedPairs, pickGrowingPairs, type OdPair } from "./od.ts";
import { deriveSeed, seededRandom, shuffle } from "./rng.ts";
import { cchMetricFor } from "./cch.ts";
import { checkHeuristic, checkRoute, emptyResult, STUDY_ALGORITHMS, type SearchStatus, type StudyAlgorithmId, type StudySearchResult } from "./search.ts";

/** configs/study.json */
export interface StudyConfig {
  schema_version: number;
  seed: number;
  map: { center_lat: number; center_lon: number; bbox_half_width_m: number; network_type: string };
  size_ladder: { node_counts: number[]; radius_m: number[] };
  track_fixed_od: { pairs_max: number };
  track_growing_od: { pairs_max: number; straight_distance_ratio: [number, number] };
  run: { repeats: number; warmup: number; dfs_time_limit_s: number; shuffle_algorithm_order: boolean };
  astar: { heuristic_scale: number };
  /** 이동 시간 계산용 차량 속도 (정상 상태는 모든 도로 같은 속도) */
  travel: { car_speed_kmh: number };
  demo: { max_frames: number; fixed_pairs: number; growing_pairs: number };
  traffic: TrafficConfig;
}

/** 혼잡 · 폐쇄 실험 설정 */
export interface TrafficConfig {
  /** 실험할 지도 크기 (크기 사다리의 이름) */
  size_label: string;
  /** 경로(출발·도착 쌍) 수: 이 크기의 트랙 2 쌍 앞에서부터 */
  pairs: number;
  algorithms: StudyAlgorithmId[];
  /** 혼잡 도로의 이동시간 배율 범위 */
  congestion_factor: [number, number];
  /** 정상 경로 위에서 혼잡으로 만들 도로 비율 */
  congestion_on_route_ratio: number;
  /** 정상 경로와 상관없이 지도 전체에서 혼잡으로 만들 도로 비율 */
  congestion_random_ratio: number;
  /** 정상 경로 위에서 막을 도로 수 */
  closures_on_route: number;
  /** 지도 전체에서 막을 도로 수 */
  closures_random: number;
  repeats: number;
}

/** 이동 시간(초) = 길이 ÷ 속도 */
export const travelSeconds = (lengthM: number, c: StudyConfig) => lengthM / ((c.travel.car_speed_kmh * 1000) / 3600);

/** results/raw_runs.csv 의 한 줄 (PROJECT_BLUEPRINT 7.5) */
export interface RawRun {
  run_id: number;
  track: 1 | 2;
  size_label: string;
  graph_nodes: number;
  graph_edges: number;
  od_id: string;
  source: number;
  target: number;
  od_straight_m: number;
  algorithm: StudyAlgorithmId;
  repetition: number;
  status: SearchStatus;
  search_ms: number;
  visit_count: number;
  unique_visited: number;
  complete_paths: number | null;
  route_length_m: number | null;
  /** 찾은 길을 차량(travel.car_speed_kmh)으로 갈 때 이동 시간(초) */
  route_time_s: number | null;
  route_edge_ids: string;
  error_reason: string;
}

export const RAW_COLUMNS: (keyof RawRun)[] = [
  "run_id", "track", "size_label", "graph_nodes", "graph_edges", "od_id", "source", "target",
  "od_straight_m", "algorithm", "repetition", "status", "search_ms", "visit_count",
  "unique_visited", "complete_paths", "route_length_m", "route_time_s", "route_edge_ids", "error_reason",
];

/** 공식 실험 전에 정해지는 것들: 크기 사다리, 출발·도착 쌍, 힌트 검사 */
export interface StudyPlan {
  ladder: LadderStep[];
  track1: OdPair[];
  track2: Record<string, { pairs: OdPair[]; diameterM: number }>;
  heuristic: { scale: number; violations: number; examples: { edge: number; straightM: number; lengthM: number }[] };
}

export function planStudy(base: StudyGraph, c: StudyConfig): StudyPlan {
  const ladder = buildLadder(base, c.size_ladder.node_counts, c.size_ladder.radius_m);
  const smallest = ladder.reduce((a, b) => (b.graph.n < a.graph.n ? b : a));
  const track1 = pickFixedPairs(smallest.graph, c.track_fixed_od.pairs_max, c.seed);
  const track2: StudyPlan["track2"] = {};
  for (const step of ladder) {
    track2[step.label] = pickGrowingPairs(step.graph, step.label, c.track_growing_od.pairs_max, c.track_growing_od.straight_distance_ratio, c.seed);
  }
  // 모든 크기가 전체 지도의 부분 그래프이므로 전체 지도에서 한 번 검사하면 된다
  const bad = checkHeuristic(base, c.astar.heuristic_scale);
  return { ladder, track1, track2, heuristic: { scale: c.astar.heuristic_scale, violations: bad.length, examples: bad.slice(0, 20) } };
}

/** 한 번 실행하고 걸린 시간을 잰다. 예외와 경로 검사 실패는 ERROR 로 바꾼다 */
export function timedRun(
  algo: StudyAlgorithmId,
  g: StudyGraph,
  s: number,
  t: number,
  c: StudyConfig,
  gc?: () => void,
): { result: StudySearchResult; ms: number } {
  const timeLimitMs = algo === "dfs" ? c.run.dfs_time_limit_s * 1000 : null;
  const opts = { timeLimitMs, heuristicScale: c.astar.heuristic_scale };
  // CCH 의 전처리 · 커스터마이징은 지도마다 한 번이므로 질의 시간에 넣지 않는다 (따로 기록)
  if (algo === "cch") cchMetricFor(g, g.len);
  gc?.();
  const t0 = performance.now();
  let result: StudySearchResult;
  try {
    result = FINDERS[algo](g, s, t, opts);
  } catch (e) {
    const ms = performance.now() - t0;
    return { ms, result: { ...emptyResult(), status: "ERROR", errorReason: e instanceof Error ? e.message : String(e) } };
  }
  const ms = performance.now() - t0;
  if (result.status === "SUCCESS") {
    const problem = checkRoute(g, s, t, result.pathEdges, result.lengthM!);
    if (problem) result = { ...result, status: "ERROR", errorReason: `경로 검사 실패: ${problem}` };
  }
  return { result, ms };
}

export interface StudyHooks {
  onRow: (row: RawRun) => void;
  onProgress?: (message: string) => void;
  /** 측정 직전에 부를 쓰레기 수집 (node --expose-gc 의 global.gc) */
  gc?: () => void;
}

export interface StudyRunLog {
  /** 큰 지도에서 빠져서 그 크기에서 제외한 트랙 1 쌍 */
  excluded: { track: 1 | 2; sizeLabel: string; odId: string; reason: string }[];
  /** 성공한 방법끼리 길이가 0.01m 넘게 다른 경우 */
  mismatches: { track: 1 | 2; sizeLabel: string; odId: string; repetition: number; lengths: Partial<Record<StudyAlgorithmId, number>> }[];
  /** 크기마다 CCH 를 쓰기 전에 한 번 드는 비용 (질의 시간과 따로) */
  cch: { sizeLabel: string; nodes: number; prepMs: number; customizeMs: number; arcs: number; shortcuts: number }[];
}

export function runStudy(plan: StudyPlan, c: StudyConfig, hooks: StudyHooks): StudyRunLog {
  const log: StudyRunLog = { excluded: [], mismatches: [], cch: [] };
  for (const step of plan.ladder) {
    const m = cchMetricFor(step.graph, step.graph.len);
    log.cch.push({
      sizeLabel: step.label,
      nodes: step.graph.n,
      prepMs: m.prep.prepMs,
      customizeMs: m.customizeMs,
      arcs: m.prep.arcs,
      shortcuts: m.prep.shortcuts,
    });
  }
  const algos = STUDY_ALGORITHMS.map((a) => a.id);
  let runId = 0;
  const jobs: { track: 1 | 2; step: LadderStep; pairs: OdPair[] }[] = [
    ...plan.ladder.map((step) => ({ track: 1 as const, step, pairs: plan.track1 })),
    ...plan.ladder.map((step) => ({ track: 2 as const, step, pairs: plan.track2[step.label].pairs })),
  ];

  for (const [jobIdx, { track, step, pairs }] of jobs.entries()) {
    const g = step.graph;
    for (const od of pairs) {
      const s = localIndex(g, od.source);
      const t = localIndex(g, od.target);
      if (s < 0 || t < 0) {
        log.excluded.push({ track, sizeLabel: step.label, odId: od.id, reason: "출발 또는 도착 교차로가 이 크기의 지도에 없음" });
        continue;
      }
      hooks.onProgress?.(`[${jobIdx + 1}/${jobs.length}] 트랙 ${track} · ${step.label} (교차로 ${g.n}) · ${od.id}`);
      for (let w = 0; w < c.run.warmup; w++) for (const a of algos) timedRun(a, g, s, t, c);

      const orderRand = seededRandom(deriveSeed(c.seed, `order:${track}:${step.label}:${od.id}`));
      for (let rep = 1; rep <= c.run.repeats; rep++) {
        const order = c.run.shuffle_algorithm_order ? shuffle(algos, orderRand) : algos;
        const lengths: Partial<Record<StudyAlgorithmId, number>> = {};
        for (const algo of order) {
          const { result: r, ms } = timedRun(algo, g, s, t, c, hooks.gc);
          const ok = r.status === "SUCCESS";
          if (ok) lengths[algo] = r.lengthM!;
          hooks.onRow({
            run_id: ++runId,
            track,
            size_label: step.label,
            graph_nodes: g.n,
            graph_edges: g.m,
            od_id: od.id,
            source: od.source,
            target: od.target,
            od_straight_m: od.straightM,
            algorithm: algo,
            repetition: rep,
            status: r.status,
            search_ms: ms,
            visit_count: r.visitCount,
            unique_visited: r.uniqueVisited,
            complete_paths: r.completePaths,
            route_length_m: ok ? r.lengthM : null,
            route_time_s: ok ? travelSeconds(r.lengthM!, c) : null,
            route_edge_ids: ok ? r.pathEdges.map((e) => g.origEdge[e]).join(" ") : "",
            error_reason: r.errorReason ?? "",
          });
        }
        const vals = Object.values(lengths);
        if (vals.length > 1 && Math.max(...vals) - Math.min(...vals) > 0.01) {
          log.mismatches.push({ track, sizeLabel: step.label, odId: od.id, repetition: rep, lengths });
        }
      }
    }
  }
  return log;
}
