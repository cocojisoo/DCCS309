import { astarSearch, dijkstraSearch } from "./bestFirst.ts";
import { customizeCch, prepareCch, queryCch, updateCch } from "./cch.ts";
import { toDemoRun, type DemoRun } from "./demo.ts";
import { localIndex } from "./od.ts";
import { LpaStar } from "./lpa.ts";
import { seededRandom, shuffle } from "./rng.ts";
import { checkHeuristic, checkRoute, type StudySearchResult } from "./search.ts";
import { median } from "./summary.ts";
import { studyGraphFromJson, subgraph, type StudyGraph, type StudyGraphJson } from "./graph.ts";

export type ExperimentKind = "many-queries" | "replanning";
export type ExperimentAlgo = "astar" | "cch" | "lpa";
export type ChangeScope = "local" | "wide";
export type ExperimentScenario = "normal" | "congestion" | "closure";

export interface ExperimentRequest {
  kind: ExperimentKind;
  json: StudyGraphJson;
  edgeIds: number[];
  source: number;
  target: number;
  count: number;
  scope: ChangeScope;
  scenario: ExperimentScenario;
  seed: number;
  repeats: number;
}

export interface ExperimentProgress {
  stage: string;
  completed: number;
  total: number;
}

export interface ExperimentMetric {
  initialMs: number;
  /** CCH: 이번 교통 정보 반영 1회. LPA*: 반영 비용은 각 응답에 포함. */
  updateMs: number;
  responseMs: number[];
  cumulativeMs: number[];
  withInitialMs: number[];
  visited: number[];
}

export interface ReplayExample {
  index: number;
  label: string;
  changedRoads: number;
  od: { source: number; target: number };
  changes: { edges: number[]; kind: "congestion" | "closure" }[];
  ghostPath: number[];
  runs: Partial<Record<ExperimentAlgo, DemoRun>>;
}

export interface ExperimentResult {
  kind: ExperimentKind;
  count: number;
  nodes: number;
  edges: number;
  seed: number;
  scope: ChangeScope;
  scenario: ExperimentScenario;
  repeats: number;
  algorithms: ExperimentAlgo[];
  checkedCases: number;
  checks: number;
  checkpoints: number[];
  metrics: Partial<Record<ExperimentAlgo, ExperimentMetric>>;
  cchSetup?: { preprocessMs: number; customizeMs: number; updateMs: number; recomputed: number };
  examples: ReplayExample[];
  eventLabels: string[];
  changedRoads: number[];
}

interface TrafficStep {
  label: string;
  weights: Float64Array;
  changed: number[];
  changedRoads: number;
  changes: ReplayExample["changes"];
}

const SPEED = 30 * 1000 / 3600;
const SCALE = 0.999 / SPEED;
const OPTIONS = { timeLimitMs: null, heuristicScale: SCALE };
const RECORD = { ...OPTIONS, recordTrace: true, maxFrames: 100 };

/** 기존 크기별 지도와 같은 교차로·도로만 사용한다. */
export function experimentGraph(json: StudyGraphJson, edgeIds: number[]): StudyGraph {
  const base = studyGraphFromJson(json);
  const keep = new Uint8Array(base.n);
  for (const e of edgeIds) {
    if (!Number.isInteger(e) || e < 0 || e >= base.m) throw new Error("지도 도로 번호가 올바르지 않습니다.");
    keep[base.from[e]] = keep[base.to[e]] = 1;
  }
  const g = subgraph(base, keep);
  const included = new Set(edgeIds);
  if (g.m !== included.size || g.origEdge.some((e) => !included.has(e))) throw new Error("기존 실험 지도와 도로 구성이 다릅니다.");
  if (g.n < 2 || checkHeuristic(g, 0.999).length) throw new Error("지도 또는 A* 방향 힌트를 확인할 수 없습니다.");
  return g;
}

function roadsOf(g: StudyGraph): number[][] {
  const map = new Map<number, number[]>();
  for (let e = 0; e < g.m; e++) {
    const key = Math.min(g.from[e], g.to[e]) * g.n + Math.max(g.from[e], g.to[e]);
    const edges = map.get(key);
    if (edges) edges.push(e);
    else map.set(key, [e]);
  }
  return [...map.values()];
}

/** 요청 수를 늘려도 앞쪽 요청은 같고, 모든 출발·도착 쌍은 서로 다르다. */
export function requestPairs(g: StudyGraph, count: number, seed: number, first: [number, number]): [number, number][] {
  if (count > g.n * (g.n - 1)) throw new Error("이 지도에서 만들 수 있는 서로 다른 요청 수를 넘었습니다.");
  const rand = seededRandom(seed);
  const out: [number, number][] = [first];
  const seen = new Set([first[0] * g.n + first[1]]);
  while (out.length < count) {
    const s = Math.floor(rand() * g.n), t = Math.floor(rand() * g.n);
    const key = s * g.n + t;
    if (s === t || seen.has(key)) continue;
    seen.add(key);
    out.push([s, t]);
  }
  return out;
}

function trafficStep(g: StudyGraph, normal: Float64Array, previous: Float64Array, roads: number[][], kind: ExperimentScenario, label: string): TrafficStep {
  const weights = normal.slice();
  const changes: TrafficStep["changes"] = [];
  if (kind !== "normal") for (const edges of roads) {
    for (const e of edges) weights[e] = kind === "closure" ? Infinity : normal[e] * 4;
    changes.push({ edges, kind });
  }
  const changed: number[] = [];
  for (let e = 0; e < g.m; e++) if (weights[e] !== previous[e]) changed.push(e);
  const roadKeys = new Set(changed.map((e) => Math.min(g.from[e], g.to[e]) * g.n + Math.max(g.from[e], g.to[e])));
  return { label, weights, changed, changedRoads: roadKeys.size, changes };
}

/** 같은 고정 경로에서 정상→혼잡→폐쇄→해소를 반복한다. 선택에 측정 결과를 사용하지 않는다. */
export function replanSteps(g: StudyGraph, normal: Float64Array, route: number[], count: number, scope: ChangeScope, seed: number): TrafficStep[] {
  const all = roadsOf(g);
  const nearTarget = new Set(route.slice(Math.floor(route.length * 2 / 3)));
  const local = all.filter((edges) => edges.some((e) => nearTarget.has(e)));
  const rand = seededRandom(seed);
  const steps: TrafficStep[] = [];
  let previous = normal;
  let chosen: number[][] = [];
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) chosen = scope === "local"
      ? [local[Math.floor(rand() * local.length)]]
      : shuffle(all, rand).slice(0, Math.max(1, Math.round(all.length * 0.1)));
    const kind = (["congestion", "closure", "normal"] as const)[i % 3];
    const label = kind === "congestion" ? "혼잡" : kind === "closure" ? "폐쇄" : "해소";
    const step = trafficStep(g, normal, previous, chosen, kind, label);
    steps.push(step);
    previous = step.weights;
  }
  return steps;
}

/** 정답뿐 아니라 일방통행·폐쇄·반환 경로의 실제 비용도 검사한다. 측정 구간 밖에서 호출. */
export function verifyExperimentRoute(g: StudyGraph, s: number, t: number, w: Float64Array, r: StudySearchResult, reference: StudySearchResult) {
  if (r.status !== reference.status) throw new Error(`정답과 상태 불일치: ${r.status} / ${reference.status}`);
  if (r.status === "NO_PATH") return;
  if (r.status !== "SUCCESS") throw new Error(`탐색에 실패했습니다: ${r.status}`);
  const issue = checkRoute(g, s, t, r.pathEdges, r.lengthM!);
  if (issue) throw new Error(issue);
  const cost = r.pathEdges.reduce((sum, e) => sum + w[e], 0);
  const tolerance = Math.max(1e-6, Math.abs(reference.cost!) * 1e-9);
  if (!Number.isFinite(cost) || Math.abs(cost - reference.cost!) > tolerance || Math.abs(r.cost! - cost) > tolerance) {
    throw new Error("최소 이동시간의 정답과 일치하지 않습니다.");
  }
}

interface Sample {
  initial: number;
  update: number;
  times: number[];
  visited: number[];
  preprocess?: number;
  customize?: number;
  recomputed?: number;
}

function metricOf(samples: Sample[]): ExperimentMetric {
  const sums = samples.map((s) => {
    let total = s.update;
    return s.times.map((ms) => total += ms);
  });
  return {
    initialMs: median(samples.map((s) => s.initial)),
    updateMs: median(samples.map((s) => s.update)),
    responseMs: samples[0].times.map((_, i) => median(samples.map((s) => s.times[i]))),
    cumulativeMs: sums[0].map((_, i) => median(sums.map((sum) => sum[i]))),
    withInitialMs: sums[0].map((_, i) => median(sums.map((sum, j) => sum[i] + samples[j].initial))),
    visited: samples[0].visited.slice(),
  };
}

function replay(g: StudyGraph, index: number, s: number, t: number, step: TrafficStep, ghostPath: number[], runs: ReplayExample["runs"]): ReplayExample {
  return {
    index, label: step.label, changedRoads: step.changedRoads,
    od: { source: g.orig[s], target: g.orig[t] },
    changes: step.changes.map((ch) => ({ ...ch, edges: ch.edges.map((e) => g.origEdge[e]) })),
    ghostPath: ghostPath.map((e) => g.origEdge[e]), runs,
  };
}

/** 기존 A*·CCH·LPA*를 호출한다. 알고리즘 본체는 변경하지 않는다. */
export function runRoutingExperiment(request: ExperimentRequest, onProgress: (p: ExperimentProgress) => void = () => {}): ExperimentResult {
  const { kind, count, seed, repeats, scope, scenario } = request;
  if (!Number.isInteger(count) || count < 1 || count > (kind === "many-queries" ? 1000 : 60)) throw new Error("실험 횟수의 범위를 확인하세요.");
  if (![1, 3, 5].includes(repeats) || !Number.isInteger(seed) || seed < 0 || seed > 1_000_000) throw new Error("측정 조건이 올바르지 않습니다.");
  const g = experimentGraph(request.json, request.edgeIds);
  const s = localIndex(g, request.source), t = localIndex(g, request.target);
  if (s < 0 || t < 0 || s === t) throw new Error("출발·도착 쌍을 확인하세요.");
  const normal = Float64Array.from(g.len, (l) => l / SPEED);
  const base = dijkstraSearch(g, s, t, { ...OPTIONS, weights: normal });
  if (base.status !== "SUCCESS") throw new Error("정상 상태에서 통행 가능한 경로가 없습니다.");
  const algorithms: ExperimentAlgo[] = kind === "many-queries" ? ["astar", "cch"] : ["astar", "lpa"];
  const result: ExperimentResult = {
    kind, count, nodes: g.n, edges: g.m, seed, repeats, scope, scenario, algorithms,
    checkedCases: count, checks: 0,
    checkpoints: [...new Set([1, 10, 100, 1000, count].filter((n) => n <= count))].sort((a, b) => a - b),
    metrics: {}, examples: [], eventLabels: [], changedRoads: [],
  };
  const samples: Partial<Record<ExperimentAlgo, Sample[]>> = Object.fromEntries(algorithms.map((a) => [a, []]));
  const allRoads = roadsOf(g);
  const fixedChange = trafficStep(g, normal, normal, shuffle(allRoads, seededRandom(seed)).slice(0, Math.max(1, Math.round(allRoads.length * (scope === "local" ? 0.01 : 0.1)))), scenario, "같은 교통 정보를 모든 요청이 공유");
  const pairs = kind === "many-queries" ? requestPairs(g, count, seed, [s, t]) : Array.from({ length: count }, (): [number, number] => [s, t]);
  const steps = kind === "many-queries" ? Array.from({ length: count }, () => fixedChange) : replanSteps(g, normal, base.pathEdges, count, scope, seed);
  onProgress({ stage: "다익스트라로 정답 확인", completed: 0, total: count });
  const reference = steps.map((step, i) => {
    const [source, target] = pairs[i];
    const r = dijkstraSearch(g, source, target, { ...OPTIONS, weights: step.weights });
    if (i % 25 === 0 || i === count - 1) onProgress({ stage: "다익스트라로 정답 확인", completed: i + 1, total: count });
    return r;
  });

  // 워밍업은 별도 상태. 측정 반복마다 상태를 새로 만들고, 연속 변화 중에는 유지한다.
  for (let repetition = -1; repetition < repeats; repetition++) {
    const order = repetition % 2 === 0 ? algorithms : [...algorithms].reverse();
    for (const algo of order) {
      const sample: Sample = { initial: 0, update: 0, times: [], visited: [] };
      const begin = performance.now();
      const prep = algo === "cch" ? prepareCch(g) : null;
      const afterPrep = performance.now();
      const cch = prep ? customizeCch(prep, normal) : null;
      const lpa = algo === "lpa" ? new LpaStar(g, s, t, normal, SCALE) : null;
      if (lpa) lpa.compute();
      if (algo === "astar" && kind === "replanning") astarSearch(g, s, t, { ...OPTIONS, weights: normal });
      const afterInitial = performance.now();
      sample.initial = algo === "astar" && kind === "many-queries" ? 0 : afterInitial - begin;
      if (cch && prep) {
        sample.preprocess = afterPrep - begin;
        sample.customize = afterInitial - afterPrep;
        if (fixedChange.changed.length) {
          const u = updateCch(cch, fixedChange.weights, fixedChange.changed);
          sample.update = u.ms;
          sample.recomputed = u.recomputed;
        } else sample.recomputed = 0;
      }
      for (let i = 0; i < count; i++) {
        const [source, target] = pairs[i];
        const step = steps[i];
        const start = performance.now();
        if (lpa) for (const e of step.changed) lpa.setWeight(e, step.weights[e]);
        const r = cch ? queryCch(cch, source, target, OPTIONS) : lpa ? lpa.compute() : astarSearch(g, source, target, { ...OPTIONS, weights: step.weights });
        sample.times.push(performance.now() - start);
        sample.visited.push(r.uniqueVisited);
        verifyExperimentRoute(g, source, target, step.weights, r, reference[i]);
        if (repetition >= 0) result.checks++;
        if (i % 25 === 0 || i === count - 1) onProgress({
          stage: repetition < 0 ? `워밍업 · ${algo}` : `실측 ${repetition + 1}/${repeats} · ${algo}`,
          completed: i + 1, total: count,
        });
      }
      if (repetition >= 0) samples[algo]!.push(sample);
    }
  }
  for (const algo of algorithms) result.metrics[algo] = metricOf(samples[algo]!);
  if (kind === "many-queries") {
    const cs = samples.cch!;
    result.cchSetup = {
      preprocessMs: median(cs.map((x) => x.preprocess!)), customizeMs: median(cs.map((x) => x.customize!)),
      updateMs: median(cs.map((x) => x.update)), recomputed: cs.at(-1)!.recomputed!,
    };
  }
  onProgress({ stage: "측정과 별도로 재생 기록 생성", completed: 0, total: count });
  const cch = kind === "many-queries" ? customizeCch(prepareCch(g), fixedChange.weights) : null;
  const lpa = kind === "replanning" ? new LpaStar(g, s, t, normal, SCALE) : null;
  lpa?.compute();
  const examples = kind === "many-queries" ? new Set([0, Math.floor((count - 1) / 2), count - 1]) : new Set(steps.map((_, i) => i));
  for (let i = 0; i < count; i++) {
    if (!examples.has(i)) continue;
    const [source, target] = pairs[i], step = steps[i];
    const ar = astarSearch(g, source, target, { ...RECORD, weights: step.weights });
    if (lpa) for (const e of step.changed) lpa.setWeight(e, step.weights[e]);
    const other = cch ? queryCch(cch, source, target, RECORD) : lpa!.compute(RECORD);
    verifyExperimentRoute(g, source, target, step.weights, ar, reference[i]);
    verifyExperimentRoute(g, source, target, step.weights, other, reference[i]);
    const otherId = algorithms[1];
    const ghost = kind === "replanning" ? (i ? reference[i - 1].pathEdges : base.pathEdges) : [];
    result.examples.push(replay(g, i, source, target, step, ghost, {
      astar: toDemoRun(g, ar, result.metrics.astar!.responseMs[i], ar.cost),
      [otherId]: toDemoRun(g, other, result.metrics[otherId]!.responseMs[i], other.cost),
    }));
  }
  result.eventLabels = steps.map((step) => step.label);
  result.changedRoads = steps.map((step) => step.changedRoads);
  return result;
}
