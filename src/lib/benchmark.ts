import { ALGORITHMS, cchSetupCost, runAlgorithm, type AlgorithmId, type SearchResult } from "./algorithms";
import { END, START, speedMps, type Mode } from "./config";
import { loadGraph, nearestNode, type Graph } from "./graph";

export const TIMING_RUNS = 5;

export interface AlgorithmRun extends SearchResult {
  algorithm: AlgorithmId;
  /** 1회 실행 시간 (ms, 기록 없이 측정). 반복 묶음 평균을 TIMING_RUNS 번 잰 중앙값. DFS 시간 초과는 그 1회 시간 */
  runtimeMs: number;
  /** 다익스트라 결과와 비용이 같은지 */
  optimal: boolean;
}

export interface ModeRun {
  mode: Mode;
  graph: Graph;
  source: number;
  target: number;
  snapStartM: number;
  snapEndM: number;
  runs: AlgorithmRun[];
  /** CCH 를 쓰기 전에 한 번 드는 시간 (질의 시간과 별도) */
  cch: { prepMs: number; customizeMs: number; shortcuts: number };
}

export interface BenchmarkResult {
  penalties: boolean;
  startedAt: string;
  modes: Record<Mode, ModeRun>;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** 다음 프레임까지 양보해서 UI(진행 표시)가 멈추지 않게 한다 */
const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export async function runBenchmark(
  penalties: boolean,
  onProgress?: (label: string) => void,
): Promise<BenchmarkResult> {
  const modes = {} as Record<Mode, ModeRun>;
  for (const mode of ["car", "walk"] as Mode[]) {
    onProgress?.(`${mode === "car" ? "차도" : "인도"} 그래프 불러오는 중`);
    const graph = await loadGraph(mode);
    const s = nearestNode(graph, START.lat, START.lng);
    const t = nearestNode(graph, END.lat, END.lng);
    const base = { source: s.node, target: t.node, speed: speedMps(mode), penalties };

    const runs: AlgorithmRun[] = [];
    for (const algo of ALGORITHMS) {
      onProgress?.(`${mode === "car" ? "차도" : "인도"} · ${algo.name} 실행 중${algo.id === "dfs" ? " (최대 2초)" : ""}`);
      await yieldToUi();
      const opts = { ...base, record: false };
      // CCH 는 첫 실행 때 전처리·커스터마이징을 하고 캐시한다 → 아래 시간 측정에는 질의만 들어간다
      let t0 = performance.now();
      const plain = runAlgorithm(algo.id, graph, opts);
      const perRun = Math.max(0.01, performance.now() - t0);
      let runtimeMs: number;
      if (plain.status === "TIMEOUT") {
        // 시간 초과는 반복해서 재지 않는다 (한 번에 제한시간만큼 걸린다)
        runtimeMs = perRun;
      } else {
        // 브라우저 타이머 해상도(약 0.1ms)보다 충분히 길게 재기 위해 한 묶음이 ~5ms 이상이 되도록 반복한다
        const batch = Math.min(200, Math.max(1, Math.ceil(5 / perRun)));
        const times: number[] = [];
        for (let i = 0; i < TIMING_RUNS; i++) {
          t0 = performance.now();
          for (let k = 0; k < batch; k++) runAlgorithm(algo.id, graph, opts);
          times.push((performance.now() - t0) / batch);
        }
        runtimeMs = median(times);
      }
      await yieldToUi();
      const recorded = runAlgorithm(algo.id, graph, { ...base, record: true });
      runs.push({ ...recorded, algorithm: algo.id, runtimeMs, optimal: false });
    }
    const ref = runs.find((r) => r.algorithm === "dijkstra")!.costSec;
    for (const r of runs) r.optimal = r.found && Math.abs(r.costSec - ref) < 1e-6;

    modes[mode] = {
      mode,
      graph,
      source: s.node,
      target: t.node,
      snapStartM: s.distanceM,
      snapEndM: t.distanceM,
      runs,
      cch: cchSetupCost(graph, base),
    };
  }
  return { penalties, startedAt: new Date().toISOString(), modes };
}

/** 간선 번호 목록 → [lat, lng] 좌표열 */
export function edgesToLatLngs(g: Graph, edges: number[]): [number, number][] {
  if (!edges.length) return [];
  const pts: [number, number][] = [[g.lat[g.from[edges[0]]], g.lng[g.from[edges[0]]]]];
  for (const e of edges) pts.push([g.lat[g.to[e]], g.lng[g.to[e]]]);
  return pts;
}
