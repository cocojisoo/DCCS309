import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parseCsv } from "../src/lib/study/summary.ts";
import { graphSignature, roadGraph, roadRadius, syntheticGraph, type FinalRoadJson } from "../src/lib/study/finalGraph.ts";

const resultPath = new URL("../results/final-v4/raw_runs.csv", import.meta.url);
const summaryPath = new URL("../public/study/final-v4/summary.json", import.meta.url);

test("official CSV and UI summary describe the same runs", () => {
  assert.ok(existsSync(resultPath) && existsSync(summaryPath), "run npm run final:run first");
  const rows = parseCsv(readFileSync(resultPath, "utf8"));
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  assert.equal(rows.length, summary.meta.raw_rows);
  assert.equal(new Set(rows.map((row) => row.run_id)).size, rows.length);
  assert.equal(summary.groups.reduce((sum: number, group: { runs: number }) => sum + group.runs, 0), rows.length);
  assert.equal(summary.od_medians.reduce((sum: number, item: { repeats: number }) => sum + item.repeats, 0), rows.length);
  assert.equal(summary.meta.config.run.repeats, 10);
  assert.equal(summary.meta.config_sha256,
    createHash("sha256").update(readFileSync(new URL("../configs/final-study.json", import.meta.url), "utf8").replace(/\r\n/g, "\n")).digest("hex"));
  assert.equal(summary.meta.mismatch_count, 0);
  for (const row of rows) {
    assert.equal(row.run_id.length, 64);
    assert.equal(row.run_id, createHash("sha256").update(JSON.stringify([row.workload_sha256, row.algorithm, Number(row.repetition)])).digest("hex"));
    assert.equal(row.config_sha256, summary.meta.config_sha256);
    assert.equal(row.graph_sha256.length, 64);
    assert.equal(row.workload_sha256.length, 64);
    assert.ok(Number(row.search_ns) >= 0);
    if (row.status !== "SUCCESS") assert.equal(row.objective_cost, "");
  }
  const compared = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = [row.experiment_id, row.size_label, row.od_id, row.objective, row.scenario_id, row.repetition].join("|");
    const hashes = compared.get(key) ?? new Set<string>();
    hashes.add(`${row.graph_sha256}|${row.config_sha256}|${row.workload_sha256}`);
    compared.set(key, hashes);
  }
  for (const hashes of compared.values()) assert.equal(hashes.size, 1);
  for (const item of summary.cases) for (const [algorithm, uiRow] of Object.entries(item.algorithms)) {
    const csv = rows.find((row) => row.experiment_id === item.experiment_id && row.size_label === item.size_label &&
      row.objective === item.objective && row.scenario_id === item.scenario_id && row.od_id === item.od_id &&
      row.algorithm === algorithm && row.repetition === "1");
    assert.ok(csv);
    assert.equal(csv.status, (uiRow as { status: string }).status);
    if (csv.status === "SUCCESS") assert.ok(Math.abs(Number(csv.objective_cost) - (uiRow as { objective_cost: number }).objective_cost) < 0.0001);
  }
});

test("saved graph hashes reproduce from the stored road snapshot and seed", () => {
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const road = JSON.parse(readFileSync(new URL("../public/study/final/road.json", import.meta.url), "utf8")) as FinalRoadJson;
  const original = roadGraph(road);
  const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(sha(graphSignature(original)), summary.meta.road_sha256);
  for (const stat of summary.meta.radius_stats as { radius_m: number; graph_sha256: string }[])
    assert.equal(sha(graphSignature(roadRadius(original, stat.radius_m).final)), stat.graph_sha256);
  const config = summary.meta.config;
  const synthetic = syntheticGraph(8, config.seed, config.synthetic.extra_edge_probability);
  const row = summary.cases.find((item: { experiment_id: string; size_label: string }) => item.experiment_id === "synthetic" && item.size_label === "n8");
  assert.equal(sha(graphSignature(synthetic)), row.algorithms.dijkstra.graph_sha256);
});

test("all UI traces exist and completed optimal costs agree", () => {
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  for (const item of summary.trace_index as { file: string; experiment_id: string; size_label: string;
    objective: string; scenario_id: string; od_id: string }[]) {
    const file = new URL(`../public${item.file}`, import.meta.url);
    assert.ok(existsSync(file), item.file);
    const trace = JSON.parse(readFileSync(file, "utf8"));
    const data = summary.cases.find((row: { experiment_id: string; size_label: string; objective: string;
      scenario_id: string; od_id: string }) => row.experiment_id === item.experiment_id && row.size_label === item.size_label &&
      row.objective === item.objective && row.scenario_id === item.scenario_id && row.od_id === item.od_id);
    assert.ok(data);
    for (const algorithm of ["dijkstra", "astar"]) {
      assert.equal(trace.runs[algorithm].status, data.algorithms[algorithm].status);
      if (trace.runs[algorithm].status === "SUCCESS")
        assert.ok(Math.abs(trace.runs[algorithm].objectiveCost - data.algorithms[algorithm].objective_cost) < 1e-6);
    }
  }
  for (const scene of summary.presentation as string[])
    assert.ok(scene === "results-summary" || summary.trace_index.some((entry: { id: string }) => entry.id === scene));
});

test("virtual congestion leaves distance-optimal cost unchanged", () => {
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const cases = summary.cases.filter((item: { experiment_id: string; objective: string }) =>
    item.experiment_id === "condition" && item.objective === "distance");
  for (const item of cases.filter((row: { scenario_id: string }) => row.scenario_id.startsWith("congestion"))) {
    const normal = cases.find((row: { scenario_id: string; od_id: string }) => row.scenario_id === "normal" && row.od_id === item.od_id);
    assert.ok(normal);
    assert.equal(item.dijkstra.status, normal.dijkstra.status);
    if (item.dijkstra.status === "SUCCESS") assert.ok(Math.abs(item.dijkstra.objective_cost - normal.dijkstra.objective_cost) < 1e-6);
  }
});

test("every selected condition edge belongs to the 5km experiment graph", () => {
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const road = JSON.parse(readFileSync(new URL("../public/study/final/road.json", import.meta.url), "utf8")) as FinalRoadJson;
  const graph = roadRadius(roadGraph(road), 5000).final;
  const available = new Set(graph.edgeId);
  const closed: string[] = [];
  for (const scenario of summary.meta.scenarios as { congestedEdgeIds?: string[]; closedEdgeIds?: string[] }[]) {
    for (const edgeId of [...(scenario.congestedEdgeIds ?? []), ...(scenario.closedEdgeIds ?? [])]) assert.ok(available.has(edgeId));
    closed.push(...(scenario.closedEdgeIds ?? []));
  }
  assert.equal(new Set(closed).size, 3);
});

test("small-input batch measurements are separate from official single runs", () => {
  const batchPath = new URL("../results/final-v4/batch_measurements.csv", import.meta.url);
  const batchJsonPath = new URL("../public/study/final-v4/batch_measurements.json", import.meta.url);
  assert.ok(existsSync(batchPath) && existsSync(batchJsonPath), "run npm run final:batch first");
  const rows = parseCsv(readFileSync(batchPath, "utf8"));
  const json = JSON.parse(readFileSync(batchJsonPath, "utf8"));
  const configHash = JSON.parse(readFileSync(summaryPath, "utf8")).meta.config_sha256;
  assert.equal(rows.length, 90);
  assert.equal(json.rows.length, rows.length);
  assert.ok(json.method.includes("not a single-run median"));
  for (const row of rows) {
    assert.equal(row.iterations, "1000");
    assert.ok(Number(row.mean_ns) > 0);
    assert.equal(row.config_sha256, configHash);
  }
});
