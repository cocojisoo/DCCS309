import { travelSeconds, type StudyConfig } from "./benchmark.ts";
import { FINDERS } from "./finders.ts";
import { cchPrepFor, customizeCch, queryCch, updateCch } from "./cch.ts";
import type { StudyGraph } from "./graph.ts";
import { LpaStar } from "./lpa.ts";
import { deriveSeed, seededRandom, shuffle } from "./rng.ts";
import { checkRoute, type SearchStatus, type StudyAlgorithmId, type StudySearchResult } from "./search.ts";
import { median } from "./summary.ts";
import { toDemoRun, type DemoRun } from "./demo.ts";
import { ladderTitle, type LadderStep } from "./ladder.ts";
import { localIndex, type OdPair } from "./od.ts";

export type TrafficScenarioId = "congestion" | "closure" | "both";

export const TRAFFIC_SCENARIOS: { id: TrafficScenarioId; name: string; detail: string }[] = [
  { id: "congestion", name: "혼잡", detail: "일부 도로의 이동시간이 몇 배로 늘어남" },
  { id: "closure", name: "폐쇄", detail: "일부 도로를 지나갈 수 없음" },
  { id: "both", name: "혼잡 + 폐쇄", detail: "두 상황이 함께 생김" },
];

/** 상황이 바뀐 도로 하나 (양방향 간선 모두). 번호는 이 크기 지도의 간선 번호 */
export interface RoadChange {
  edges: number[];
  kind: "congestion" | "closure";
  /** 혼잡일 때 이동시간 배율 */
  factor: number;
  onNormalRoute: boolean;
}

/** 같은 두 교차로를 잇는 간선들(양방향)을 도로 하나로 묶는다 */
function roadsOf(g: StudyGraph): { roads: number[][]; roadOfEdge: Int32Array } {
  const key = new Map<number, number>();
  const roads: number[][] = [];
  const roadOfEdge = new Int32Array(g.m);
  for (let e = 0; e < g.m; e++) {
    const a = Math.min(g.from[e], g.to[e]);
    const b = Math.max(g.from[e], g.to[e]);
    const k = a * g.n + b;
    let r = key.get(k);
    if (r === undefined) {
      r = roads.length;
      key.set(k, r);
      roads.push([]);
    }
    roads[r].push(e);
    roadOfEdge[e] = r;
  }
  return { roads, roadOfEdge };
}

/**
 * 출발·도착 쌍마다 시드 고정으로 혼잡 · 폐쇄 도로를 고른다.
 *  - 혼잡: 정상 경로의 한 구간(연속한 도로들) + 지도 전체에서 무작위 도로들
 *  - 폐쇄: 정상 경로 가운데쯤의 도로 + 지도 전체에서 무작위 도로들
 * 정상 경로를 일부러 건드려야 알고리즘이 다른 길을 찾는 모습을 볼 수 있다.
 * 폐쇄로 출발·도착이 끊기면 그 폐쇄는 빼고 다시 고른다.
 */
export function makeScenario(g: StudyGraph, source: number, target: number, normalRoute: number[], c: StudyConfig, odId: string): Record<TrafficScenarioId, RoadChange[]> {
  const t = c.traffic;
  const rand = seededRandom(deriveSeed(c.seed, `traffic:${odId}`));
  const { roads, roadOfEdge } = roadsOf(g);
  const routeRoads = normalRoute.map((e) => roadOfEdge[e]);
  const onRoute = new Set(routeRoads);
  const factor = () => t.congestion_factor[0] + rand() * (t.congestion_factor[1] - t.congestion_factor[0]);

  // 혼잡: 정상 경로의 연속 구간
  const congested = new Map<number, RoadChange>();
  const span = Math.max(1, Math.round(routeRoads.length * t.congestion_on_route_ratio));
  const startAt = Math.floor(rand() * Math.max(1, routeRoads.length - span + 1));
  for (const r of routeRoads.slice(startAt, startAt + span)) congested.set(r, { edges: roads[r], kind: "congestion", factor: factor(), onNormalRoute: true });
  for (const r of shuffle(Array.from(roads.keys()), rand).slice(0, Math.round(roads.length * t.congestion_random_ratio))) {
    if (!congested.has(r)) congested.set(r, { edges: roads[r], kind: "congestion", factor: factor(), onNormalRoute: onRoute.has(r) });
  }

  // 폐쇄: 정상 경로 가운데 절반에서 고르고, 나머지는 지도 전체에서. 길이 끊기는 폐쇄는 건너뛴다
  const closed = new Map<number, RoadChange>();
  const blocked = new Uint8Array(g.m);
  const tryClose = (r: number) => {
    if (closed.has(r)) return false;
    for (const e of roads[r]) blocked[e] = 1;
    const w = Float64Array.from(g.len, (l, e) => (blocked[e] ? Infinity : l));
    if (FINDERS.dijkstra(g, source, target, { timeLimitMs: null, weights: w }).status !== "SUCCESS") {
      for (const e of roads[r]) blocked[e] = 0;
      return false;
    }
    closed.set(r, { edges: roads[r], kind: "closure", factor: Infinity, onNormalRoute: onRoute.has(r) });
    return true;
  };
  const middle = routeRoads.slice(Math.floor(routeRoads.length / 4), Math.ceil((routeRoads.length * 3) / 4));
  let need = t.closures_on_route;
  for (const r of shuffle(middle.length ? middle : routeRoads, rand)) if (need > 0 && tryClose(r)) need--;
  need = t.closures_random;
  for (const r of shuffle(Array.from(roads.keys()), rand)) if (need > 0 && !onRoute.has(r) && tryClose(r)) need--;

  const both = new Map(congested);
  for (const [r, ch] of closed) both.set(r, ch);
  return { congestion: [...congested.values()], closure: [...closed.values()], both: [...both.values()] };
}

/** 정상 비용(이동시간)에 상황을 덮어쓴 비용 배열 */
export function applyChanges(normal: Float64Array, changes: RoadChange[]): Float64Array {
  const w = normal.slice();
  for (const ch of changes) for (const e of ch.edges) w[e] = ch.kind === "closure" ? Infinity : normal[e] * ch.factor;
  return w;
}

export interface TrafficRun {
  status: SearchStatus;
  lengthM: number | null;
  timeS: number | null;
  /** 상황이 바뀐 뒤 다시 찾는 데 든 계산 시간 (반복 중간값, ms) */
  searchMs: number;
  /** CCH: 부분 커스터마이징 / 질의 시간, 다시 계산한 지름길 수 */
  customizeMs?: number;
  queryMs?: number;
  recomputedArcs?: number;
  /** 다시 찾을 때 본 서로 다른 교차로 수 */
  visited: number;
  pathEdges: number[];
  result: StudySearchResult;
}

/**
 * 상황이 바뀐 뒤 각 방법이 새 경로를 찾는 데 하는 일:
 *  - A*: 바뀐 비용으로 처음부터 다시 탐색
 *  - CCH: 정상 상태로 커스터마이징해 둔 상태에서 바뀐 도로에 닿는 지름길만 다시 계산 + 질의
 *  - LPA*: 정상 상태로 한 번 계획해 둔 상태에서 바뀐 도로만 알려 주고 다시 계획
 * 정상 상태의 준비는 시간에 넣지 않는다 (상황이 바뀌기 전에 이미 해 둔 일).
 */
export function respond(
  algo: StudyAlgorithmId,
  g: StudyGraph,
  s: number,
  t: number,
  normal: Float64Array,
  next: Float64Array,
  changed: number[],
  heuristicScale: number,
  record: { recordTrace: boolean; maxFrames: number } | null,
): { result: StudySearchResult; ms: number; customizeMs?: number; queryMs?: number; recomputedArcs?: number } {
  const o = { timeLimitMs: null, heuristicScale, recordTrace: record?.recordTrace ?? false, maxFrames: record?.maxFrames };
  if (algo === "cch") {
    const metric = customizeCch(cchPrepFor(g), normal);
    const t0 = performance.now();
    const { recomputed } = updateCch(metric, next, changed);
    const t1 = performance.now();
    const result = queryCch(metric, s, t, o);
    const t2 = performance.now();
    return { result, ms: t2 - t0, customizeMs: t1 - t0, queryMs: t2 - t1, recomputedArcs: recomputed };
  }
  if (algo === "lpa") {
    const lpa = new LpaStar(g, s, t, normal, heuristicScale);
    lpa.compute();
    const t0 = performance.now();
    for (const e of changed) lpa.setWeight(e, next[e]);
    const result = lpa.compute(o);
    return { result, ms: performance.now() - t0 };
  }
  const t0 = performance.now();
  const result = FINDERS[algo](g, s, t, { ...o, weights: next });
  return { result, ms: performance.now() - t0 };
}

export interface TrafficCase {
  scenario: TrafficScenarioId;
  changes: RoadChange[];
  /** 정상 경로를 그대로 갔을 때 이 상황에서의 이동 시간 (폐쇄 도로를 지나면 null) */
  normalRouteNowS: number | null;
  runs: Partial<Record<StudyAlgorithmId, TrafficRun>>;
}

export interface TrafficOd {
  odId: string;
  source: number;
  target: number;
  normal: { lengthM: number; timeS: number; pathEdges: number[] };
  cases: TrafficCase[];
}

/** 한 출발·도착 쌍에 대해 세 상황 × 세 방법을 실행한다 */
export function runTrafficOd(g: StudyGraph, s: number, t: number, odId: string, c: StudyConfig, gc?: () => void, onRepeat?: (row: TrafficRepeatRow) => void): TrafficOd {
  const speed = (c.travel.car_speed_kmh * 1000) / 3600;
  const normal = Float64Array.from(g.len, (l) => l / speed);
  const scale = c.astar.heuristic_scale / speed;
  const base = FINDERS.dijkstra(g, s, t, { timeLimitMs: null, weights: normal });
  if (base.status !== "SUCCESS") throw new Error(`${odId}: 정상 상태에서 길이 없음`);
  const scenarios = makeScenario(g, s, t, base.pathEdges, c, odId);

  const cases: TrafficCase[] = [];
  for (const sc of TRAFFIC_SCENARIOS) {
    const changes = scenarios[sc.id];
    const next = applyChanges(normal, changes);
    const changed = changes.flatMap((ch) => ch.edges);
    const nowS = base.pathEdges.reduce((sum, e) => sum + next[e], 0);
    const runs: TrafficCase["runs"] = {};
    for (const algo of c.traffic.algorithms) {
      respond(algo, g, s, t, normal, next, changed, scale, null); // 워밍업
      const times: number[] = [];
      const cust: number[] = [];
      const query: number[] = [];
      let last: ReturnType<typeof respond> | null = null;
      for (let rep = 1; rep <= c.traffic.repeats; rep++) {
        gc?.();
        last = respond(algo, g, s, t, normal, next, changed, scale, null);
        times.push(last.ms);
        if (last.customizeMs !== undefined) cust.push(last.customizeMs);
        if (last.queryMs !== undefined) query.push(last.queryMs);
        onRepeat?.(repeatRow(odId, sc.id, algo, rep, last, base, nowS, g));
      }
      const r = last!.result;
      const problem = r.status === "SUCCESS" ? checkRoute(g, s, t, r.pathEdges, r.lengthM!) : null;
      runs[algo] = {
        status: problem ? "ERROR" : r.status,
        lengthM: r.lengthM,
        timeS: r.cost,
        searchMs: median(times),
        customizeMs: cust.length ? median(cust) : undefined,
        queryMs: query.length ? median(query) : undefined,
        recomputedArcs: last!.recomputedArcs,
        visited: r.uniqueVisited,
        pathEdges: r.pathEdges,
        result: r,
      };
    }
    cases.push({ scenario: sc.id, changes, normalRouteNowS: Number.isFinite(nowS) ? nowS : null, runs });
  }
  return { odId, source: s, target: t, normal: { lengthM: base.lengthM!, timeS: travelSeconds(base.lengthM!, c), pathEdges: base.pathEdges }, cases };
}

/** 화면용 탐색 기록 (재생만 한다) */
export interface TrafficDemoRun extends DemoRun {
  customizeMs?: number;
  queryMs?: number;
  recomputedArcs?: number;
}

/** public/study/traffic/<경로>.json — 번호는 모두 전체 지도(study.json) 기준 */
export interface TrafficDemoFile {
  odId: string;
  size: { label: string; title: string; nodes: number; edges: number };
  edgeIds: number[];
  od: OdPair;
  normal: { lengthM: number; timeS: number; pathEdges: number[] };
  cases: {
    scenario: TrafficScenarioId;
    changes: { edges: number[]; kind: RoadChange["kind"]; factor: number; onNormalRoute: boolean }[];
    normalRouteNowS: number | null;
    runs: Partial<Record<StudyAlgorithmId, TrafficDemoRun>>;
  }[];
}

/** public/study/traffic/index.json */
export interface TrafficIndex {
  size: TrafficDemoFile["size"];
  algorithms: StudyAlgorithmId[];
  pairs: { odId: string; straightM: number }[];
  /** 경로들의 중간값 (상황 × 방법) */
  summary: {
    scenario: TrafficScenarioId;
    algorithm: StudyAlgorithmId;
    pairs: number;
    success: number;
    searchMs: number;
    customizeMs: number | null;
    queryMs: number | null;
    recomputedArcs: number | null;
    visited: number;
    normalTimeS: number;
    normalLengthM: number;
    routeTimeS: number | null;
    routeLengthM: number | null;
    normalRouteNowS: number | null;
    /** 정상 경로를 그대로 갈 수 없는(폐쇄) 경로 수 */
    normalRouteBlocked: number;
    routeChanged: number;
  }[];
  generatedAt: string;
}

/** 한 쌍의 실험 결과(runTrafficOd)에 탐색 기록을 붙여 화면용 파일로 만든다 */
export function makeTrafficDemo(step: LadderStep, od: OdPair, result: TrafficOd, c: StudyConfig): TrafficDemoFile {
  const g = step.graph;
  const speed = (c.travel.car_speed_kmh * 1000) / 3600;
  const normal = Float64Array.from(g.len, (l) => l / speed);
  const scale = c.astar.heuristic_scale / speed;
  const toOrig = (es: number[]) => es.map((e) => g.origEdge[e]);
  return {
    odId: od.id,
    size: { label: step.label, title: ladderTitle(step.kind, step.target), nodes: g.n, edges: g.m },
    edgeIds: Array.from(g.origEdge),
    od,
    normal: { ...result.normal, pathEdges: toOrig(result.normal.pathEdges) },
    cases: result.cases.map((cs) => {
      const next = applyChanges(normal, cs.changes);
      const changed = cs.changes.flatMap((ch) => ch.edges);
      const runs: Partial<Record<StudyAlgorithmId, TrafficDemoRun>> = {};
      for (const [algo, run] of Object.entries(cs.runs) as [StudyAlgorithmId, TrafficRun][]) {
        const rec = respond(algo, g, result.source, result.target, normal, next, changed, scale, { recordTrace: true, maxFrames: c.demo.max_frames });
        runs[algo] = {
          ...toDemoRun(g, rec.result, run.searchMs, run.timeS),
          status: run.status,
          customizeMs: run.customizeMs,
          queryMs: run.queryMs,
          recomputedArcs: run.recomputedArcs,
        };
      }
      return {
        scenario: cs.scenario,
        changes: cs.changes.map((ch) => ({ ...ch, edges: toOrig(ch.edges) })),
        normalRouteNowS: cs.normalRouteNowS,
        runs,
      };
    }),
  };
}

/** 실험할 지도 크기와 출발·도착 쌍 (트랙 2 의 앞쪽 쌍) */
export function trafficTargets(ladder: LadderStep[], track2: Record<string, { pairs: OdPair[] }>, c: StudyConfig) {
  const step = ladder.find((l) => l.label === c.traffic.size_label);
  if (!step) throw new Error(`traffic.size_label ${c.traffic.size_label} 이 크기 사다리에 없습니다`);
  const pairs = track2[step.label].pairs.slice(0, c.traffic.pairs).filter((p) => localIndex(step.graph, p.source) >= 0 && localIndex(step.graph, p.target) >= 0);
  return { step, pairs };
}

export function summarizeTraffic(results: TrafficOd[], c: StudyConfig): TrafficIndex["summary"] {
  const out: TrafficIndex["summary"] = [];
  const med = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    return v.length ? median(v) : null;
  };
  for (const sc of TRAFFIC_SCENARIOS)
    for (const algo of c.traffic.algorithms) {
      const items = results.map((r) => ({ od: r, cs: r.cases.find((x) => x.scenario === sc.id)! })).filter((x) => x.cs.runs[algo]);
      const runs = items.map((x) => x.cs.runs[algo]!);
      out.push({
        scenario: sc.id,
        algorithm: algo,
        pairs: items.length,
        success: runs.filter((r) => r.status === "SUCCESS").length,
        searchMs: med(runs.map((r) => r.searchMs)) ?? NaN,
        customizeMs: med(runs.map((r) => r.customizeMs)),
        queryMs: med(runs.map((r) => r.queryMs)),
        recomputedArcs: med(runs.map((r) => r.recomputedArcs)),
        visited: med(runs.map((r) => r.visited)) ?? NaN,
        normalTimeS: med(items.map((x) => x.od.normal.timeS)) ?? NaN,
        normalLengthM: med(items.map((x) => x.od.normal.lengthM)) ?? NaN,
        routeTimeS: med(runs.map((r) => r.timeS)),
        routeLengthM: med(runs.map((r) => r.lengthM)),
        normalRouteNowS: med(items.map((x) => x.cs.normalRouteNowS)),
        normalRouteBlocked: items.filter((x) => x.cs.normalRouteNowS === null).length,
        routeChanged: items.filter((x) => {
          const p = x.cs.runs[algo]!.pathEdges;
          const n = x.od.normal.pathEdges;
          return p.length !== n.length || p.some((e, i) => e !== n[i]);
        }).length,
      });
    }
  return out;
}

/** results/traffic_runs.csv 의 한 줄 */
export interface TrafficRepeatRow {
  od_id: string;
  scenario: TrafficScenarioId;
  algorithm: StudyAlgorithmId;
  repetition: number;
  status: SearchStatus;
  search_ms: number;
  customize_ms: number | null;
  query_ms: number | null;
  recomputed_arcs: number | null;
  unique_visited: number;
  route_length_m: number | null;
  route_time_s: number | null;
  normal_length_m: number;
  normal_time_s: number;
  normal_route_now_s: number | null;
  route_changed: boolean | null;
  route_edge_ids: string;
}

export const TRAFFIC_COLUMNS: (keyof TrafficRepeatRow)[] = [
  "od_id", "scenario", "algorithm", "repetition", "status", "search_ms", "customize_ms", "query_ms", "recomputed_arcs",
  "unique_visited", "route_length_m", "route_time_s", "normal_length_m", "normal_time_s", "normal_route_now_s",
  "route_changed", "route_edge_ids",
];

function repeatRow(
  odId: string,
  scenario: TrafficScenarioId,
  algo: StudyAlgorithmId,
  rep: number,
  r: ReturnType<typeof respond>,
  base: StudySearchResult,
  nowS: number,
  g: StudyGraph,
): TrafficRepeatRow {
  const ok = r.result.status === "SUCCESS";
  const same = ok && r.result.pathEdges.length === base.pathEdges.length && r.result.pathEdges.every((e, i) => e === base.pathEdges[i]);
  return {
    od_id: odId,
    scenario,
    algorithm: algo,
    repetition: rep,
    status: r.result.status,
    search_ms: r.ms,
    customize_ms: r.customizeMs ?? null,
    query_ms: r.queryMs ?? null,
    recomputed_arcs: r.recomputedArcs ?? null,
    unique_visited: r.result.uniqueVisited,
    route_length_m: ok ? r.result.lengthM : null,
    route_time_s: ok ? r.result.cost : null,
    normal_length_m: base.lengthM!,
    normal_time_s: base.cost!,
    normal_route_now_s: Number.isFinite(nowS) ? nowS : null,
    route_changed: ok ? !same : null,
    route_edge_ids: ok ? r.result.pathEdges.map((e) => g.origEdge[e]).join(" ") : "",
  };
}
