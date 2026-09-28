// Version 3 official experiment. Never overwrites the legacy CSV or graph.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { edgeCosts, finalSearch, prepareHeuristic, validateFinalRoute, type FinalAlgorithm, type Objective, type Scenario } from "../../src/lib/study/finalSearch.ts";
import { graphSignature, roadGraph, roadRadius, syntheticGraph, type FinalGraph, type FinalRoadJson } from "../../src/lib/study/finalGraph.ts";
import { localIndex, pickFixedPairs, pickGrowingPairs, type OdPair } from "../../src/lib/study/od.ts";
import { deriveSeed, seededRandom, shuffle } from "../../src/lib/study/rng.ts";
import { csvLine } from "../../src/lib/study/summary.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputFlag = process.argv.indexOf("--output-id");
const outputId = outputFlag >= 0 ? process.argv[outputFlag + 1] : "final-v4";
if (!outputId || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(outputId)) throw new Error("--output-id must use 2-40 lowercase letters, digits, or hyphens");
const configPath = path.join(root, "configs/final-study.json");
const roadPath = path.join(root, "public/study/final/road.json");
const resultDir = path.join(root, "results", outputId);
const publicDir = path.join(root, "public/study", outputId);
const rawPath = path.join(resultDir, "raw_runs.csv");
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

interface Config {
  schema_version: number; seed: number;
  map: { radii_m: number[]; presentation_radii_m: number[] };
  synthetic: { sizes: number[]; presentation_sizes: number[]; extra_edge_probability: number };
  road: { common_pairs_max: number; growing_pairs_max: number; straight_distance_ratio: [number, number] };
  run: { repeats: number; warmup: number; dfs_time_limit_ms: number; max_trace_frames: number };
  conditions: { congested_edge_fraction: number; congestion_multipliers: number[]; closure_count: number };
  presentation: { default_od_rule: string; condition_case_rule: string };
}
interface Job {
  experimentId: "synthetic" | "road" | "condition";
  sizeLabel: string; radiusM: number | null; graph: FinalGraph; graphHash: string;
  od: OdPair; objective: Objective; scenario: Scenario; algorithms: FinalAlgorithm[];
}
interface Row {
  run_id: string; experiment_id: string; config_sha256: string; graph_sha256: string; workload_sha256: string;
  graph_nodes: number; graph_edges: number; radius_m: number | null; size_label: string; od_id: string;
  source: number; target: number; od_straight_m: number; objective: Objective; scenario_id: string;
  scenario_sha256: string; algorithm: FinalAlgorithm; repetition: number; status: string; search_ns: number;
  heuristic_prep_ns: number; objective_cost: number | null; route_length_m: number | null;
  estimated_free_flow_s: number | null; estimated_scenario_s: number | null; expanded_kind: string;
  expanded_count: number; unique_visited: number; complete_paths: number | null; relaxed_edges: number | null;
  heap_peak_entries: number | null; best_so_far: number | null; route_edge_ids: string; error_reason: string;
}
const columns: (keyof Row)[] = ["run_id", "experiment_id", "config_sha256", "graph_sha256", "workload_sha256", "graph_nodes", "graph_edges", "radius_m", "size_label", "od_id", "source", "target", "od_straight_m", "objective", "scenario_id", "scenario_sha256", "algorithm", "repetition", "status", "search_ns", "heuristic_prep_ns", "objective_cost", "route_length_m", "estimated_free_flow_s", "estimated_scenario_s", "expanded_kind", "expanded_count", "unique_visited", "complete_paths", "relaxed_edges", "heap_peak_entries", "best_so_far", "route_edge_ids", "error_reason"];

function percentile(values: number[], portion: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * portion, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

function scenarios(full: FinalGraph, c: Config): Scenario[] {
  const ids = [...full.edgeId].sort();
  const shuffled = shuffle(ids, seededRandom(deriveSeed(c.seed, "conditions:edges")));
  const congestedEdgeIds = shuffled.slice(0, Math.max(1, Math.floor(ids.length * c.conditions.congested_edge_fraction)));
  const result: Scenario[] = [{ id: "normal" },
    ...c.conditions.congestion_multipliers.map((multiplier) => ({ id: `congestion_${multiplier.toFixed(1).replace(".", "_")}`,
      congestedEdgeIds, multiplier }))];
  for (let i = 0; i < c.conditions.closure_count; i++) result.push({ id: `closure_${i + 1}`, closedEdgeIds: [shuffled[congestedEdgeIds.length + i]] });
  const normalDistance = edgeCosts(full, "distance", result[0]);
  for (const scenario of result.filter((s) => s.id.startsWith("congestion"))) {
    const altered = edgeCosts(full, "distance", scenario);
    for (let e = 0; e < altered.length; e++) if (altered[e] !== normalDistance[e]) throw new Error("congestion changed distance cost");
  }
  return result;
}

function selectedOds(steps: Map<number, FinalGraph>, c: Config) {
  const smallest = steps.get(c.map.radii_m[0])!;
  const all = [...steps.values()];
  const common = pickFixedPairs(smallest.graph, c.road.common_pairs_max * 4, c.seed)
    .filter((od) => all.every((step) => localIndex(step.graph, od.source) >= 0 && localIndex(step.graph, od.target) >= 0))
    .slice(0, c.road.common_pairs_max)
    .map((od, i) => ({ ...od, id: `C-${String(i + 1).padStart(2, "0")}` }));
  if (!common.length) throw new Error("no OD pair common to all radii");
  const growing = new Map<number, OdPair[]>();
  for (const [radius, final] of steps) {
    const pairs = pickGrowingPairs(final.graph, `r${radius}`, c.road.growing_pairs_max,
      c.road.straight_distance_ratio, c.seed).pairs
      .map((od, i) => ({ ...od, id: `G-${radius}-${String(i + 1).padStart(2, "0")}` }));
    if (!pairs.length) throw new Error(`no growing OD pair at ${radius}m`);
    growing.set(radius, pairs);
  }
  return { common, growing };
}

function runOne(job: Job, algorithm: FinalAlgorithm, repetition: number, config: Config, configHash: string, originalRoad: FinalGraph): Row {
  const g = job.graph.graph;
  const source = job.experimentId === "synthetic" ? job.od.source : localIndex(g, job.od.source);
  const target = job.experimentId === "synthetic" ? job.od.target : localIndex(g, job.od.target);
  const costs = edgeCosts(job.graph, job.objective, job.scenario);
  const heuristic = algorithm === "astar" ? prepareHeuristic(job.experimentId === "synthetic" ? job.graph : originalRoad,
    job.graph, job.objective, job.scenario) : null;
  const scenarioHash = hash(job.scenario);
  const workloadHash = hash({ experimentId: job.experimentId, sizeLabel: job.sizeLabel,
    configHash, graphHash: job.graphHash, od: job.od, objective: job.objective,
    scenarioHash, seed: config.seed, timeLimitMs: config.run.dfs_time_limit_ms });
  const row: Row = { run_id: hash([workloadHash, algorithm, repetition]), experiment_id: job.experimentId,
    config_sha256: configHash, graph_sha256: job.graphHash, workload_sha256: workloadHash,
    graph_nodes: g.n, graph_edges: g.m, radius_m: job.radiusM, size_label: job.sizeLabel,
    od_id: job.od.id, source: job.od.source, target: job.od.target, od_straight_m: job.od.straightM,
    objective: job.objective, scenario_id: job.scenario.id, scenario_sha256: scenarioHash, algorithm,
    repetition, status: "ERROR", search_ns: 0, heuristic_prep_ns: heuristic?.prepNs ?? 0,
    objective_cost: null, route_length_m: null, estimated_free_flow_s: null, estimated_scenario_s: null,
    expanded_kind: algorithm === "dfs" ? "path_prefix" : "settled_node", expanded_count: 0,
    unique_visited: 0, complete_paths: null, relaxed_edges: null, heap_peak_entries: null,
    best_so_far: null, route_edge_ids: "", error_reason: "" };
  const t0 = performance.now();
  try {
    const result = finalSearch(job.graph, source, target, costs, algorithm,
      { timeLimitMs: config.run.dfs_time_limit_ms, heuristicScale: heuristic?.scale ?? 0 });
    row.search_ns = Math.round((performance.now() - t0) * 1e6);
    const invalid = validateFinalRoute(job.graph, costs, source, target, result);
    if (invalid) throw new Error(invalid);
    row.status = result.status; row.objective_cost = result.objectiveCost;
    row.route_length_m = result.routeLengthM; row.estimated_free_flow_s = result.estimatedFreeFlowS;
    if (result.status === "SUCCESS") {
      const timeCosts = edgeCosts(job.graph, "time", job.scenario);
      row.estimated_scenario_s = result.pathEdges.reduce((sum, e) => sum + timeCosts[e], 0);
    }
    row.expanded_count = result.expandedCount; row.unique_visited = result.uniqueVisited;
    row.complete_paths = result.completePaths; row.relaxed_edges = result.relaxedEdges;
    row.heap_peak_entries = result.heapPeakEntries; row.best_so_far = result.bestSoFar;
    row.route_edge_ids = result.pathEdges.map((e) => job.graph.edgeId[e]).join(" ");
    if (heuristic?.fallbackReason) row.error_reason = `h=0: ${heuristic.fallbackReason}`;
  } catch (error) {
    row.search_ns = Math.round((performance.now() - t0) * 1e6);
    row.status = "ERROR"; row.objective_cost = null; row.route_length_m = null;
    row.route_edge_ids = ""; row.error_reason = error instanceof Error ? error.message : String(error);
  }
  return row;
}

function summarize(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = [row.experiment_id, row.size_label, row.objective, row.scenario_id, row.algorithm].join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped].map(([key, group]) => {
    const byOd = new Map<string, Row[]>();
    for (const row of group) byOd.set(row.od_id, [...(byOd.get(row.od_id) ?? []), row]);
    const perOd = [...byOd.values()].map((runs) => percentile(runs.filter((r) => r.status === "SUCCESS").map((r) => r.search_ns), 0.5))
      .filter((v): v is number => v !== null);
    const expanded = [...byOd.values()].map((runs) => percentile(runs.map((r) => r.expanded_count), 0.5))
      .filter((v): v is number => v !== null);
    return { key, experiment_id: group[0].experiment_id, size_label: group[0].size_label,
      radius_m: group[0].radius_m, graph_nodes: group[0].graph_nodes, graph_edges: group[0].graph_edges,
      objective: group[0].objective, scenario_id: group[0].scenario_id, algorithm: group[0].algorithm,
      od_count: byOd.size, runs: group.length, success: group.filter((r) => r.status === "SUCCESS").length,
      timeout: group.filter((r) => r.status === "TIMEOUT").length,
      no_path: group.filter((r) => r.status === "NO_PATH").length,
      error: group.filter((r) => r.status === "ERROR").length,
      median_search_ns: percentile(perOd, 0.5), q1_search_ns: percentile(perOd, 0.25), q3_search_ns: percentile(perOd, 0.75),
      median_expanded: percentile(expanded, 0.5), q1_expanded: percentile(expanded, 0.25), q3_expanded: percentile(expanded, 0.75) };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function summarizeOds(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = [row.experiment_id, row.size_label, row.objective, row.scenario_id, row.od_id, row.algorithm].join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped].map(([key, group]) => {
    const completed = group.filter((r) => r.status === "SUCCESS");
    return { key, experiment_id: group[0].experiment_id, size_label: group[0].size_label,
      objective: group[0].objective, scenario_id: group[0].scenario_id, od_id: group[0].od_id,
      algorithm: group[0].algorithm, repeats: group.length,
      success: completed.length, timeout: group.filter((r) => r.status === "TIMEOUT").length,
      no_path: group.filter((r) => r.status === "NO_PATH").length,
      error: group.filter((r) => r.status === "ERROR").length,
      objective_cost: percentile(completed.map((r) => r.objective_cost!), 0.5),
      median_search_ns: percentile(completed.map((r) => r.search_ns), 0.5),
      median_expanded: percentile(group.map((r) => r.expanded_count), 0.5),
      median_complete_paths: percentile(group.map((r) => r.complete_paths).filter((v): v is number => v !== null), 0.5) };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function traceFile(job: Job, config: Config, originalRoad: FinalGraph) {
  const source = job.experimentId === "synthetic" ? job.od.source : localIndex(job.graph.graph, job.od.source);
  const target = job.experimentId === "synthetic" ? job.od.target : localIndex(job.graph.graph, job.od.target);
  const costs = edgeCosts(job.graph, job.objective, job.scenario);
  const algorithms: FinalAlgorithm[] = job.experimentId === "condition" ? ["dijkstra", "astar"] : ["dfs", "dijkstra", "astar"];
  const runs = Object.fromEntries(algorithms.map((algorithm) => {
    const h = algorithm === "astar" ? prepareHeuristic(job.experimentId === "synthetic" ? job.graph : originalRoad,
      job.graph, job.objective, job.scenario) : null;
    const result = finalSearch(job.graph, source, target, costs, algorithm,
      { timeLimitMs: config.run.dfs_time_limit_ms, heuristicScale: h?.scale ?? 0, recordTrace: true, maxFrames: config.run.max_trace_frames });
    return [algorithm, { ...result, pathEdges: result.pathEdges.map((e) => job.graph.graph.origEdge[e]),
      trace: result.trace ? { order: result.trace.order.map((v) => job.graph.graph.orig[v]),
        frames: result.trace.frames.map((f) => ({ ...f, current: f.current < 0 ? -1 : job.graph.graph.orig[f.current],
          path: f.path.map((e) => job.graph.graph.origEdge[e]), best: f.best?.map((e) => job.graph.graph.origEdge[e]) ?? null })) } : null }];
  }));
  return { experimentId: job.experimentId, sizeLabel: job.sizeLabel, radiusM: job.radiusM,
    objective: job.objective, scenarioId: job.scenario.id, od: job.od,
    graph: job.experimentId === "synthetic" ? graphSignature(job.graph) : null, runs };
}

function main() {
  if (existsSync(resultDir) || existsSync(publicDir)) throw new Error(`results already exist in ${outputId}; choose a new --output-id for another run`);
  const configText = readFileSync(configPath, "utf8"), config = JSON.parse(configText) as Config;
  const configHash = hash(configText.replace(/\r\n/g, "\n")), roadJson = JSON.parse(readFileSync(roadPath, "utf8")) as FinalRoadJson;
  const fullRoad = roadGraph(roadJson), roadHash = hash(graphSignature(fullRoad));
  const steps = new Map(config.map.radii_m.map((radius) => [radius, roadRadius(fullRoad, radius).final]));
  const radiusStats = config.map.radii_m.map((radius) => {
    const s = roadRadius(fullRoad, radius);
    return { radius_m: radius, nodes: s.final.graph.n, edges: s.final.graph.m, cut_nodes: s.cutNodes,
      cut_edges: s.cutEdges, excluded_nodes: s.excludedNodes, excluded_edges: s.excludedEdges,
      actual_radius_m: s.actualRadiusM, graph_sha256: hash(graphSignature(s.final)) };
  });
  const od = selectedOds(steps, config);
  const conditionGraph = steps.get(5000);
  if (!conditionGraph) throw new Error("5km road graph is required for condition scenarios");
  const conditions = scenarios(conditionGraph, config);
  const jobs: Job[] = [];
  for (const n of config.synthetic.sizes) {
    const graph = syntheticGraph(n, config.seed, config.synthetic.extra_edge_probability);
    jobs.push({ experimentId: "synthetic", sizeLabel: `n${n}`, radiusM: null, graph,
      graphHash: hash(graphSignature(graph)), od: { id: `S-${n}`, track: 1, source: 0, target: n - 1,
        straightM: Math.hypot(graph.graph.x[0] - graph.graph.x[n - 1], graph.graph.y[0] - graph.graph.y[n - 1]) },
      objective: "distance", scenario: { id: "normal" }, algorithms: ["dfs", "dijkstra", "astar"] });
  }
  for (const radius of config.map.radii_m) {
    const graph = steps.get(radius)!, graphHash = hash(graphSignature(graph));
    const pairs = [...od.common, ...od.growing.get(radius)!];
    for (const objective of ["distance", "time"] as Objective[]) for (const pair of pairs) {
      const representative = pair.id === od.common[0].id || pair.id === od.growing.get(radius)![0].id;
      jobs.push({ experimentId: "road", sizeLabel: `r${radius}`, radiusM: radius, graph, graphHash,
        od: pair, objective, scenario: { id: "normal" },
        algorithms: representative ? ["dfs", "dijkstra", "astar"] : ["dijkstra", "astar"] });
    }
  }
  const large = conditionGraph, largeHash = hash(graphSignature(large));
  for (const scenario of conditions) for (const objective of ["distance", "time"] as Objective[])
    for (const pair of [...od.common, ...od.growing.get(5000)!])
      jobs.push({ experimentId: "condition", sizeLabel: "r5000", radiusM: 5000, graph: large, graphHash: largeHash,
        od: pair, objective, scenario, algorithms: ["dijkstra", "astar"] });

  const rows: Row[] = [], mismatch: string[] = [];
  const startedAt = new Date().toISOString();
  let completedJobs = 0;
  for (const job of jobs) {
    for (let w = 0; w < config.run.warmup; w++) for (const algorithm of job.algorithms)
      runOne(job, algorithm, 0, config, configHash, fullRoad);
    const rand = seededRandom(deriveSeed(config.seed, `order:${job.experimentId}:${job.sizeLabel}:${job.od.id}:${job.objective}:${job.scenario.id}`));
    for (let repetition = 1; repetition <= config.run.repeats; repetition++) {
      const batch = shuffle(job.algorithms, rand).map((algorithm) => runOne(job, algorithm, repetition, config, configHash, fullRoad));
      const success = batch.filter((r) => r.status === "SUCCESS");
      if (success.length > 1 && Math.max(...success.map((r) => r.objective_cost!)) - Math.min(...success.map((r) => r.objective_cost!)) > 1e-6) {
        mismatch.push(`${job.experimentId}/${job.sizeLabel}/${job.od.id}/${job.objective}/${job.scenario.id}/${repetition}`);
        for (const row of batch) { row.status = "ERROR"; row.error_reason = "algorithm objective costs disagree"; row.objective_cost = null; }
      }
      rows.push(...batch);
    }
    completedJobs++;
    if (completedJobs % 20 === 0) console.log(`[final-study] ${completedJobs}/${jobs.length} workloads; ${rows.length} raw rows`);
  }
  if (mismatch.length) throw new Error(`cost mismatch in ${mismatch.length} workloads: ${mismatch.slice(0, 3).join(", ")}`);
  const groups = summarize(rows), odMedians = summarizeOds(rows);
  const statusCounts = Object.fromEntries(["SUCCESS", "TIMEOUT", "NO_PATH", "ERROR"].map((status) => [status, rows.filter((r) => r.status === status).length]));
  const cases = jobs
    .map((job) => ({ experiment_id: job.experimentId, size_label: job.sizeLabel, radius_m: job.radiusM,
      objective: job.objective, scenario_id: job.scenario.id, od_id: job.od.id,
      algorithms: Object.fromEntries(job.algorithms.map((algorithm) => [algorithm,
        rows.find((r) => r.experiment_id === job.experimentId && r.size_label === job.sizeLabel &&
          r.objective === job.objective && r.scenario_id === job.scenario.id && r.od_id === job.od.id &&
          r.algorithm === algorithm && r.repetition === 1)])),
      dijkstra: rows.find((r) => r.experiment_id === job.experimentId && r.size_label === job.sizeLabel &&
        r.objective === job.objective && r.scenario_id === job.scenario.id && r.od_id === job.od.id && r.algorithm === "dijkstra" && r.repetition === 1) }));
  const changeCounts = conditions.map((scenario) => {
    const changed = cases.filter((c) => c.experiment_id === "condition" && c.scenario_id === scenario.id);
    let routeChanged = 0, unchanged = 0, noPath = 0;
    for (const c of changed) {
      const normal = cases.find((x) => x.experiment_id === "condition" && x.scenario_id === "normal" &&
        x.objective === c.objective && x.od_id === c.od_id);
      if (c.dijkstra?.status === "NO_PATH") noPath++;
      else if (c.dijkstra?.route_edge_ids !== normal?.dijkstra?.route_edge_ids) routeChanged++;
      else unchanged++;
    }
    return { scenario_id: scenario.id, route_changed: routeChanged, unchanged, no_path: noPath, total: changed.length };
  });
  const conditionCase = cases.filter((c) => c.experiment_id === "condition" && c.scenario_id !== "normal")
    .sort((a, b) => `${a.scenario_id}|${a.od_id}|${a.objective}`.localeCompare(`${b.scenario_id}|${b.od_id}|${b.objective}`))
    .find((c) => c.dijkstra?.route_edge_ids !== cases.find((x) => x.experiment_id === "condition" &&
      x.scenario_id === "normal" && x.objective === c.objective && x.od_id === c.od_id)?.dijkstra?.route_edge_ids)
    ?? cases.find((c) => c.experiment_id === "condition" && c.scenario_id !== "normal")!;

  mkdirSync(resultDir, { recursive: true }); mkdirSync(path.join(publicDir, "traces"), { recursive: true });
  writeFileSync(rawPath, [columns.join(","), ...rows.map((r) => csvLine(r, columns))].join("\n") + "\n");
  writeFileSync(path.join(resultDir, "summary.csv"), [Object.keys(groups[0]).join(","),
    ...groups.map((g) => csvLine(g, Object.keys(g) as (keyof typeof g)[]))].join("\n") + "\n");
  writeFileSync(path.join(resultDir, "od_medians.csv"), [Object.keys(odMedians[0]).join(","),
    ...odMedians.map((row) => csvLine(row, Object.keys(row) as (keyof typeof row)[]))].join("\n") + "\n");
  const meta = { started_at: startedAt, finished_at: new Date().toISOString(), config_sha256: configHash,
    road_sha256: roadHash, osm_sha256: roadJson.meta.osmSha256, osm_timestamp: roadJson.meta.osmTimestamp,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? "unknown" },
    config, radius_stats: radiusStats, common_od: od.common, growing_od: Object.fromEntries(od.growing),
    scenarios: conditions, status_counts: statusCounts, raw_rows: rows.length, mismatch_count: mismatch.length,
    condition_counts: changeCounts, condition_case: conditionCase ? { scenario_id: conditionCase.scenario_id,
      od_id: conditionCase.od_id, objective: conditionCase.objective } : null };
  writeFileSync(path.join(resultDir, "meta.json"), JSON.stringify(meta, null, 2));
  const traceIndex: { id: string; file: string; label: string; experiment_id: string; size_label: string;
    objective: Objective; scenario_id: string; od_id: string }[] = [];
  const traceJobs = [
    ...config.synthetic.presentation_sizes.map((n) => jobs.find((j) => j.experimentId === "synthetic" && j.sizeLabel === `n${n}`)!),
    ...config.map.presentation_radii_m.flatMap((radius) => (["distance", "time"] as Objective[])
      .flatMap((objective) => [od.common[0].id, od.growing.get(radius)![0].id].map((odId) =>
        jobs.find((j) => j.experimentId === "road" && j.radiusM === radius &&
          j.objective === objective && j.od.id === odId)!))),
    ...conditions.flatMap((scenario) => (["distance", "time"] as Objective[]).map((objective) =>
      jobs.find((j) => j.experimentId === "condition" && j.scenario.id === scenario.id &&
        j.objective === objective && j.od.id === conditionCase.od_id)!)),
  ];
  for (const [i, job] of traceJobs.entries()) {
    const file = `scene-${i + 1}.json`, id = `scene-${i + 1}`;
    writeFileSync(path.join(publicDir, "traces", file), JSON.stringify(traceFile(job, config, fullRoad)));
    traceIndex.push({ id, file: `/study/${outputId}/traces/${file}`, label: `${job.experimentId} ${job.sizeLabel} ${job.scenario.id}`,
      experiment_id: job.experimentId, size_label: job.sizeLabel, objective: job.objective,
      scenario_id: job.scenario.id, od_id: job.od.id });
  }
  const presentation = [
    ...config.synthetic.presentation_sizes.map((n) => traceIndex.find((t) => t.experiment_id === "synthetic" && t.size_label === `n${n}`)!.id),
    ...config.map.presentation_radii_m.map((radius) => traceIndex.find((t) => t.experiment_id === "road" &&
      t.size_label === `r${radius}` && t.objective === "distance" && t.od_id === od.growing.get(radius)![0].id)!.id),
    traceIndex.find((t) => t.experiment_id === "condition" && t.scenario_id === conditionCase.scenario_id &&
      t.objective === conditionCase.objective)!.id,
    "results-summary",
  ];
  const summary = { meta, presentation,
    groups, od_medians: odMedians, change_counts: changeCounts, cases, trace_index: traceIndex };
  writeFileSync(path.join(publicDir, "summary.json"), JSON.stringify(summary));
  console.log(`[final-study] ${rows.length} raw rows; ${groups.length} summary groups; ${traceIndex.length} presentation scenes`);
  console.log(`[final-study] statuses ${JSON.stringify(statusCounts)}; mismatches ${mismatch.length}`);
}

main();
