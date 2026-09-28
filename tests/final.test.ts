import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildStudyGraph } from "../src/lib/study/graph.ts";
import { edgeCosts, finalSearch, prepareHeuristic, validateFinalRoute, type Scenario } from "../src/lib/study/finalSearch.ts";
import { edgeGeometry, graphSignature, roadGraph, syntheticGraph, type FinalGraph, type FinalRoadJson } from "../src/lib/study/finalGraph.ts";
import { csvLine } from "../src/lib/study/summary.ts";

function graph(edges: [number, number, number, number][], xy: [number, number][]): FinalGraph {
  const from = edges.map((e) => e[0]), to = edges.map((e) => e[1]);
  const g = buildStudyGraph({ lat: xy.map(() => 0), lng: xy.map(() => 0), x: xy.map((p) => p[0]), y: xy.map((p) => p[1]),
    from, to, len: edges.map((e) => e[2]) });
  const counters = new Map<string, number>();
  return { graph: g, kind: "synthetic", freeFlowS: Float64Array.from(edges.map((e) => e[3])),
    edgeId: edges.map((e) => { const pair = `${e[0]}:${e[1]}`, key = counters.get(pair) ?? 0;
      counters.set(pair, key + 1); return `${pair}:${key}`; }) };
}

test("parallel roads, direct and detour routes, and distinct objectives", () => {
  const g = graph([[0, 1, 8, 2], [0, 1, 4, 8], [0, 2, 2, 2], [2, 1, 2, 2]], [[0, 0], [1, 0], [0, 1]]);
  for (const algorithm of ["dfs", "dijkstra", "astar"] as const) {
    const objective = edgeCosts(g, "distance", { id: "normal" });
    const h = prepareHeuristic(g, g, "distance", { id: "normal" });
    const result = finalSearch(g, 0, 1, objective, algorithm, { timeLimitMs: 200, heuristicScale: h.scale });
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.objectiveCost, 4);
    assert.equal(validateFinalRoute(g, objective, 0, 1, result), null);
    if (algorithm === "dfs") assert.equal(result.completePaths, 3);
  }
  const time = edgeCosts(g, "time", { id: "normal" });
  const fastest = finalSearch(g, 0, 1, time, "dijkstra");
  assert.equal(fastest.objectiveCost, 2);
  assert.deepEqual(fastest.pathEdges, [0]);
});

test("one-way travel, zero cost, cycles, equal routes, and disconnected targets", () => {
  const g = graph([[0, 1, 0, 1], [1, 0, 1, 1], [1, 2, 2, 2], [0, 2, 2, 2]], [[0, 0], [1, 0], [2, 0], [3, 0]]);
  const costs = edgeCosts(g, "distance", { id: "normal" });
  for (const algorithm of ["dfs", "dijkstra", "astar"] as const) {
    const h = prepareHeuristic(g, g, "distance", { id: "normal" });
    const same = finalSearch(g, 0, 0, costs, algorithm, { heuristicScale: h.scale });
    assert.equal(same.status, "SUCCESS"); assert.equal(same.objectiveCost, 0); assert.deepEqual(same.pathEdges, []);
    const route = finalSearch(g, 0, 2, costs, algorithm, { heuristicScale: h.scale });
    assert.equal(route.objectiveCost, 2);
    assert.equal(validateFinalRoute(g, costs, 0, 2, route), null);
    assert.equal(finalSearch(g, 2, 0, costs, algorithm, { heuristicScale: h.scale }).status, "NO_PATH");
    assert.equal(finalSearch(g, 0, 3, costs, algorithm, { heuristicScale: h.scale }).status, "NO_PATH");
  }
});

test("directional closure, NO_PATH, and virtual congestion", () => {
  const g = graph([[0, 1, 10, 10], [1, 0, 10, 10], [1, 2, 10, 10]], [[0, 0], [1, 0], [2, 0]]);
  const closed: Scenario = { id: "closure_1", closedEdgeIds: [g.edgeId[0]] };
  assert.equal(finalSearch(g, 0, 2, edgeCosts(g, "distance", closed), "dijkstra").status, "NO_PATH");
  assert.equal(finalSearch(g, 1, 0, edgeCosts(g, "distance", closed), "dijkstra").status, "SUCCESS");
  const congestion: Scenario = { id: "congestion_3_0", congestedEdgeIds: [g.edgeId[0]], multiplier: 3 };
  assert.deepEqual([...edgeCosts(g, "distance", congestion)], [...edgeCosts(g, "distance", { id: "normal" })]);
  assert.equal(edgeCosts(g, "time", congestion)[0], 30);
  const wrong = finalSearch(g, 1, 0, edgeCosts(g, "distance", { id: "normal" }), "dijkstra");
  assert.notEqual(validateFinalRoute(g, edgeCosts(g, "distance", closed), 0, 2, wrong), null);
});

test("DFS timeout leaves the candidate unconfirmed", () => {
  const g = syntheticGraph(18, 309, 0.8);
  const result = finalSearch(g, 0, 17, edgeCosts(g, "distance", { id: "normal" }), "dfs", { timeLimitMs: 0 });
  assert.equal(result.status, "TIMEOUT");
  assert.equal(result.objectiveCost, null);
  assert.deepEqual(result.pathEdges, []);
  assert.equal(validateFinalRoute(g, edgeCosts(g, "distance", { id: "normal" }), 0, 17, result), null);
});

test("A* consistency and independent small-graph optimum", () => {
  for (let n = 4; n <= 8; n++) {
    const g = syntheticGraph(n, 309, 0.5), costs = edgeCosts(g, "distance", { id: "normal" });
    const h = prepareHeuristic(g, g, "distance", { id: "normal" });
    assert.equal(h.fallbackReason, null);
    for (let e = 0; e < g.graph.m; e++) {
      const u = g.graph.from[e], v = g.graph.to[e], t = n - 1;
      const hu = h.scale * Math.hypot(g.graph.x[u] - g.graph.x[t], g.graph.y[u] - g.graph.y[t]);
      const hv = h.scale * Math.hypot(g.graph.x[v] - g.graph.x[t], g.graph.y[v] - g.graph.y[t]);
      assert.ok(hu <= costs[e] + hv + 1e-8);
    }
    const dist = Array.from({ length: n }, (_, u) => Array.from({ length: n }, (_, v) => u === v ? 0 : Infinity));
    for (let e = 0; e < g.graph.m; e++) dist[g.graph.from[e]][g.graph.to[e]] = Math.min(dist[g.graph.from[e]][g.graph.to[e]], costs[e]);
    for (let k = 0; k < n; k++) for (let u = 0; u < n; u++) for (let v = 0; v < n; v++)
      dist[u][v] = Math.min(dist[u][v], dist[u][k] + dist[k][v]);
    const d = finalSearch(g, 0, n - 1, costs, "dijkstra");
    const a = finalSearch(g, 0, n - 1, costs, "astar", { heuristicScale: h.scale });
    assert.ok(Math.abs(d.objectiveCost! - dist[0][n - 1]) < 1e-8);
    assert.ok(Math.abs(a.objectiveCost! - dist[0][n - 1]) < 1e-8);
  }
});

test("A* falls back to zero when a candidate coefficient is unsafe", () => {
  const original = graph([[0, 1, 10, 10]], [[0, 0], [1, 0]]);
  const altered = graph([[0, 1, 1, 1]], [[0, 0], [1, 0]]);
  const h = prepareHeuristic(original, altered, "distance", { id: "normal" });
  assert.equal(h.scale, 0);
  assert.match(h.fallbackReason ?? "", /consistency failed/);
  const result = finalSearch(altered, 0, 1, edgeCosts(altered, "distance", { id: "normal" }), "astar", { heuristicScale: h.scale });
  assert.equal(result.objectiveCost, 1);
});

test("fixed seed graph and hashes are repeatable; failed CSV cost is empty", () => {
  const a = graphSignature(syntheticGraph(12, 309, 0.45));
  const b = graphSignature(syntheticGraph(12, 309, 0.45));
  assert.deepEqual(a, b);
  const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
  assert.equal(sha(a), sha(b));
  assert.equal(csvLine({ status: "TIMEOUT", cost: null }, ["status", "cost"]), "TIMEOUT,");
});

test("saved OSM graph retains distinct directed parallel edges and source metadata", () => {
  const json = JSON.parse(readFileSync(new URL("../public/study/final/road.json", import.meta.url), "utf8")) as FinalRoadJson;
  const g = roadGraph(json);
  assert.ok(g.graph.n > 0 && g.graph.m > 0);
  assert.equal(new Set(g.edgeId).size, g.graph.m);
  assert.ok(json.meta.osmSha256.length === 64);
  const rawOsm = readFileSync(new URL("../scripts/.cache/osm-final-study.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(rawOsm).digest("hex"), json.meta.osmSha256);
  assert.ok(json.meta.osmTimestamp);
  assert.ok(json.meta.counts.parallelPairs > 0);
  assert.equal(json.geomStart.length, g.graph.m + 1);
  const geometry = edgeGeometry(json, 0);
  assert.deepEqual(geometry[0], [json.lat[json.from[0]], json.lng[json.from[0]]]);
  assert.deepEqual(geometry.at(-1), [json.lat[json.to[0]], json.lng[json.to[0]]]);
  for (let e = 0; e < g.graph.m; e++) {
    assert.ok(g.graph.len[e] > 0 && g.freeFlowS[e] > 0);
    assert.ok(json.osmWayIds[e].length > 0);
  }
});
