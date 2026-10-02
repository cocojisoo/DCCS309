import { buildStudyGraph } from "./graph.ts";
import { roadGraph, roadRadius, type FinalGraph, type FinalRoadJson } from "./finalGraph.ts";
import { edgeCosts, finalSearch, prepareHeuristic, validateFinalRoute, type Objective, type Scenario } from "./finalSearch.ts";
import { CchIndex } from "./cch.ts";
import { LpaSearch, type IncrementalResult } from "./lpa.ts";
import type { SearchTrace } from "./search.ts";

export type ResearchAlgorithm = "astar" | "cch" | "lpa";
export interface ResearchRequest {
  mode: "routes" | "replan"; map: "demo" | "road"; radius: number; objective: Objective;
  change: "few" | "many" | "outside"; multiplier: number; repeats?: number; includeNoPath: boolean;
  road?: FinalRoadJson;
}
export interface ResearchRun {
  algorithm: ResearchAlgorithm; objective: Objective; status: "SUCCESS" | "NO_PATH"; verified: boolean;
  cost: number | null; distanceM: number | null; travelS: number | null; pathEdges: number[];
  expanded: number; unique: number; updatedArcs: number; reused: number[]; links: { from: number; to: number }[];
  trace: SearchTrace | null;
  responseMs: number; updateMs: number; searchMs: number; cumulativeMs: number; q1Ms: number; q3Ms: number;
}
export interface ResearchStep {
  id: string; label: string; description: string; changedEdges: number; impactedIds: string[]; closedIds: string[];
  runs: ResearchRun[];
}
export interface ResearchResult {
  request: Omit<ResearchRequest, "road">; computedAt: string; osmTimestamp: string | null; osmSha256: string | null;
  nodes: number; edges: number; source: number; target: number; repeats: number;
  graph: { x: number[]; y: number[]; from: number[]; to: number[]; len: number[]; freeFlowS: number[]; edgeId: string[] } | null;
  steps: ResearchStep[]; preparation: { algorithm: ResearchAlgorithm; ms: number; storageBytes: number; shortcuts: number }[];
  requests: { count: number; astarMs: number; cchMs: number }[];
}
export function teachingGraph(): FinalGraph {
  // Equal free-flow speed makes shortest and fastest routes coincide initially.
  const x = [0, 200, 450, 150, 350, 550, 270, 700], y = [200, 200, 200, 0, 0, 0, 370, 200];
  const roads = [[0, 1, 600], [1, 2, 800], [2, 7, 600], [0, 3, 800], [3, 4, 700], [4, 5, 700], [5, 7, 800], [1, 6, 200]];
  const from: number[] = [], to: number[] = [], len: number[] = [];
  for (const [u, v, d] of roads) { from.push(u, v); to.push(v, u); len.push(d, d); }
  return { kind: "synthetic", graph: buildStudyGraph({ lat: x.map(() => 0), lng: y.map(() => 0), x, y, from, to, len }),
    edgeId: from.map((u, e) => `${u}:${to[e]}:0`), freeFlowS: Float64Array.from(len, d => d * 3.6 / 30) };
}
const median = (values: number[], q = 0.5) => {
  const sorted = [...values].sort((a, b) => a - b), p = (sorted.length - 1) * q, low = Math.floor(p);
  return sorted[low] + (sorted[Math.ceil(p)] - sorted[low]) * (p - low);
};
interface Sample { response: number; update: number; search: number; cumulative: number }

export function runResearch(request: ResearchRequest, progress?: (message: string) => void): ResearchResult {
  const repeats = Math.max(1, Math.min(30, request.repeats ?? 10));
  if (![500, 2000, 5000].includes(request.radius) || ![1.5, 3, 5].includes(request.multiplier)) throw new Error("Invalid experiment settings");
  const final = request.map === "demo" ? teachingGraph() : request.road ? roadRadius(roadGraph(request.road), request.radius).final : null;
  if (!final || !final.graph.n) throw new Error("Road graph is unavailable");
  const g = final.graph;
  let source = 0, target = request.map === "demo" ? 7 : 0;
  if (request.map === "road") {
    // Fixed endpoints for every method/event; deterministic opposite sides of this radius.
    for (let v = 1; v < g.n; v++) { if (g.x[v] < g.x[source]) source = v; if (g.x[v] > g.x[target]) target = v; }
  }
  const objective = request.mode === "routes" ? "time" : request.objective;
  const normal: Scenario = { id: "normal" }, base = edgeCosts(final, objective, normal);
  const referenceRoute = finalSearch(final, source, target, base, "dijkstra").pathEdges;
  const selected = new Set(referenceRoute);
  if (request.change === "outside") {
    selected.clear();
    for (let e = 0; e < g.m && selected.size < Math.max(1, referenceRoute.length); e++) if (!referenceRoute.includes(e)) selected.add(e);
  } else if (request.change === "many") for (let e = 0; e < g.m; e++) if (e % 5 === 0) selected.add(e);
  const congested: Scenario = { id: "congestion", congestedEdgeIds: [...selected].map(e => final.edgeId[e]), multiplier: request.multiplier };
  const congestedPath = finalSearch(final, source, target, edgeCosts(final, "time", congested), "dijkstra").pathEdges;
  const closureEdge = congestedPath[Math.floor(congestedPath.length / 2)];
  const closed: Scenario = { ...congested, id: "closure", closedEdgeIds: closureEdge == null ? [] : [final.edgeId[closureEdge]] };
  const scenarios: { scenario: Scenario; label: string; description: string }[] = [
    { scenario: normal, label: "1. 정상", description: "같은 도로·출발·도착에서 첫 경로를 계산합니다." },
    { scenario: congested, label: "2. 혼잡", description: request.change === "outside" ? "기존 최적 경로 밖의 도로만 느려집니다. 경로가 유지되는 경우도 비교합니다." : `선택한 도로의 이동시간이 ${request.multiplier}배로 증가합니다. 거리는 변하지 않습니다.` },
    { scenario: closed, label: "3. 폐쇄", description: "혼잡 상태를 유지하고, 그때의 시간 최소 경로에 있는 도로 한 방향을 폐쇄합니다." },
  ];
  if (request.includeNoPath) scenarios.push({ scenario: { ...closed, id: "no_path", closedEdgeIds: final.edgeId.filter((_, e) => g.to[e] === target) },
    label: "4. 도달 불가", description: "목적지로 들어가는 모든 도로를 폐쇄합니다. 경로 없음도 정확하게 판단해야 합니다." });
  scenarios.push({ scenario: { id: "restore" }, label: `${scenarios.length + 1}. 복구`, description: "혼잡과 폐쇄를 해제합니다. 비용이 감소할 때에도 같은 상태를 이어서 사용합니다." });
  const objectives: Objective[] = request.mode === "routes" ? ["distance", "time"] : [request.objective];
  const algorithms: ResearchAlgorithm[] = request.mode === "routes" ? ["astar"] : ["astar", "cch", "lpa"];
  const samples = new Map<string, Sample[]>(), prepSamples = new Map<string, number[]>();
  const preparation = new Map<ResearchAlgorithm, { ms: number; storageBytes: number; shortcuts: number }>();
  const traces = new Map<string, ResearchRun>();
  const key = (step: number, goal: Objective, algorithm: ResearchAlgorithm) => `${step}:${goal}:${algorithm}`;

  for (let repetition = -1; repetition <= repeats; repetition++) {
    const recording = repetition === repeats;
    progress?.(recording ? "탐색 과정을 기록하는 중…" : repetition < 0 ? "워밍업 중…" : `${repetition + 1}/${repeats}회 반복 측정 중…`);
    for (const goal of objectives) {
      const initialCosts = edgeCosts(final, goal, normal), t0 = performance.now();
      // Fixed safe heuristic for the whole sequence. Changes are >= normal costs.
      const heuristic = prepareHeuristic(final, final, goal, normal).scale;
      const heuristicMs = performance.now() - t0;
      const prep = new Map<ResearchAlgorithm, number>([["astar", heuristicMs]]);
      let cch: CchIndex | null = null, lpa: LpaSearch | null = null;
      if (algorithms.includes("cch")) { const start = performance.now(); cch = new CchIndex(g, initialCosts); prep.set("cch", performance.now() - start); }
      if (algorithms.includes("lpa")) { const start = performance.now(); lpa = new LpaSearch(g, source, target, initialCosts, heuristic); prep.set("lpa", heuristicMs + performance.now() - start); }
      if (repetition >= 0 && !recording) for (const algorithm of algorithms) {
        const values = prepSamples.get(algorithm) ?? []; values.push(prep.get(algorithm)!); prepSamples.set(algorithm, values);
      }
      if (recording) for (const algorithm of algorithms) preparation.set(algorithm, { ms: median(prepSamples.get(algorithm)!),
        storageBytes: algorithm === "cch" ? cch!.storageBytes : algorithm === "lpa" ? lpa!.storageBytes : 0,
        shortcuts: algorithm === "cch" ? cch!.shortcutCount : 0 });
      const cumulative = new Map(algorithms.map(a => [a, prep.get(a)!]));
      for (let step = 0; step < scenarios.length; step++) {
        const scenario = scenarios[step].scenario, costs = edgeCosts(final, goal, scenario), timeCosts = edgeCosts(final, "time", scenario);
        const reference = finalSearch(final, source, target, costs, "dijkstra");
        // Rotate measurement order; algorithms have independent state.
        const order = algorithms.map((_, i) => algorithms[(i + Math.max(0, repetition)) % algorithms.length]);
        for (const algorithm of order) {
          let result: IncrementalResult, updateMs = 0, updatedArcs = 0, links: { from: number; to: number }[] = [];
          const start = performance.now();
          if (algorithm === "cch") {
            updatedArcs = cch!.update(costs); updateMs = performance.now() - start;
            const value = cch!.query(source, target, recording); result = value; links = value.links;
          } else if (algorithm === "lpa") result = lpa!.search(costs, recording);
          else {
            const value = finalSearch(final, source, target, costs, "astar", { heuristicScale: heuristic, recordTrace: recording, maxFrames: 70, smallerGTies: true });
            result = { cost: value.objectiveCost, pathEdges: value.pathEdges, expanded: value.expandedCount, unique: value.uniqueVisited, reused: [], trace: value.trace ?? null };
          }
          const response = performance.now() - start, search = response - updateMs;
          cumulative.set(algorithm, cumulative.get(algorithm)! + response);
          const comparable = result.cost === null ? reference.objectiveCost === null : reference.objectiveCost !== null && Math.abs(result.cost - reference.objectiveCost) <= 1e-7 * Math.max(1, Math.abs(reference.objectiveCost));
          if (!comparable) throw new Error(`${algorithm}: optimal cost mismatch at ${scenario.id}`);
          const validation = validateFinalRoute(final, costs, source, target, { ...reference, objectiveCost: result.cost,
            status: result.cost === null ? "NO_PATH" : "SUCCESS", pathEdges: result.pathEdges,
            routeLengthM: result.cost === null ? null : result.pathEdges.reduce((sum, e) => sum + g.len[e], 0),
            estimatedFreeFlowS: result.cost === null ? null : result.pathEdges.reduce((sum, e) => sum + final.freeFlowS[e], 0) });
          if (validation) throw new Error(`${algorithm}: ${validation}`);
          const id = key(step, goal, algorithm);
          if (repetition >= 0 && !recording) {
            const values = samples.get(id) ?? []; values.push({ response, update: updateMs, search, cumulative: cumulative.get(algorithm)! }); samples.set(id, values);
          }
          if (recording) {
            const values = samples.get(id)!;
            const node = (v: number) => v < 0 ? -1 : g.orig[v], edge = (e: number) => g.origEdge[e];
            traces.set(id, { algorithm, objective: goal, verified: true, cost: result.cost, status: result.cost === null ? "NO_PATH" : "SUCCESS",
              distanceM: result.cost === null ? null : result.pathEdges.reduce((s, e) => s + g.len[e], 0),
              travelS: result.cost === null ? null : result.pathEdges.reduce((s, e) => s + timeCosts[e], 0),
              expanded: result.expanded, unique: result.unique, updatedArcs, pathEdges: result.pathEdges.map(edge), reused: result.reused.map(node),
              links: links.map(link => ({ from: node(link.from), to: node(link.to) })),
              trace: result.trace ? { order: result.trace.order.map(node), frames: result.trace.frames.map(f => ({ ...f, current: node(f.current), path: f.path.map(edge), best: f.best?.map(edge) ?? null })) } : null,
              responseMs: median(values.map(v => v.response)), updateMs: median(values.map(v => v.update)), searchMs: median(values.map(v => v.search)),
              cumulativeMs: median(values.map(v => v.cumulative)), q1Ms: median(values.map(v => v.response), 0.25), q3Ms: median(values.map(v => v.response), 0.75) });
          }
        }
      }
    }
  }
  const requests: ResearchResult["requests"] = [];
  if (request.mode === "replan") {
    progress?.("여러 경로 요청의 준비 비용을 비교하는 중…");
    const costs = edgeCosts(final, request.objective, normal), start = performance.now(), h = prepareHeuristic(final, final, request.objective, normal).scale;
    const hMs = performance.now() - start, cchStart = performance.now(), cch = new CchIndex(g, costs), cchMs = performance.now() - cchStart;
    for (const count of [1, 10, 100]) {
      const totals = { astar: [] as number[], cch: [] as number[] };
      for (let repeat = -1; repeat < 3; repeat++) for (const method of repeat % 2 ? ["cch", "astar"] as const : ["astar", "cch"] as const) {
        const began = performance.now();
        for (let i = 0; i < count; i++) {
          const s = i === 0 ? source : i * 127 % g.n, t = i === 0 ? target : (i * 313 + 79) % g.n;
          if (method === "astar") finalSearch(final, s, t, costs, "astar", { heuristicScale: h, smallerGTies: true }); else cch.query(s, t);
        }
        if (repeat >= 0) totals[method].push(performance.now() - began + (method === "astar" ? hMs : cchMs));
      }
      requests.push({ count, astarMs: median(totals.astar), cchMs: median(totals.cch) });
    }
  }
  const { road: omittedRoad, ...settings } = request;
  void omittedRoad;
  return { request: settings, computedAt: new Date().toISOString(), osmTimestamp: request.map === "road" ? request.road!.meta.osmTimestamp : null,
    osmSha256: request.map === "road" ? request.road!.meta.osmSha256 : null, nodes: g.n, edges: g.m, source: g.orig[source], target: g.orig[target], repeats,
    graph: request.map === "demo" ? { x: [...g.x], y: [...g.y], from: [...g.from], to: [...g.to], len: [...g.len], freeFlowS: [...final.freeFlowS], edgeId: final.edgeId } : null,
    preparation: [...preparation].map(([algorithm, value]) => ({ algorithm, ...value })), requests,
    steps: scenarios.map(({ scenario, label, description }, step) => {
      const current = edgeCosts(final, objective, scenario), previous = step ? edgeCosts(final, objective, scenarios[step - 1].scenario) : current;
      return { id: scenario.id, label, description, changedEdges: current.reduce((count, cost, e) => count + Number(cost !== previous[e]), 0),
        impactedIds: [...new Set([...(scenario.congestedEdgeIds ?? []), ...(scenario.closedEdgeIds ?? [])])], closedIds: scenario.closedEdgeIds ?? [],
        runs: objectives.flatMap(goal => algorithms.map(algorithm => traces.get(key(step, goal, algorithm))!)) };
    }) };
}
