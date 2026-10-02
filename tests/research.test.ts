import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { CchIndex } from "../src/lib/study/cch.ts";
import { LpaSearch } from "../src/lib/study/lpa.ts";
import { buildStudyGraph, type StudyGraph } from "../src/lib/study/graph.ts";
import { roadGraph, roadRadius, syntheticGraph, type FinalRoadJson } from "../src/lib/study/finalGraph.ts";
import { edgeCosts, finalSearch } from "../src/lib/study/finalSearch.ts";
import { runResearch } from "../src/lib/study/research.ts";

function oracle(g: StudyGraph, costs: Float64Array) {
  const d = Array.from({ length: g.n }, (_, u) => Array.from({ length: g.n }, (_, v) => u === v ? 0 : Infinity));
  for (let e = 0; e < g.m; e++) d[g.from[e]][g.to[e]] = Math.min(d[g.from[e]][g.to[e]], costs[e]);
  for (let k = 0; k < g.n; k++) for (let u = 0; u < g.n; u++) for (let v = 0; v < g.n; v++) d[u][v] = Math.min(d[u][v], d[u][k] + d[k][v]);
  return d;
}
function check(g: StudyGraph, costs: Float64Array, s: number, t: number, result: { cost: number | null; pathEdges: number[] }, expected: number) {
  if (!Number.isFinite(expected)) { assert.equal(result.cost, null); assert.deepEqual(result.pathEdges, []); return; }
  assert.ok(Math.abs(result.cost! - expected) < 1e-7 * Math.max(1, expected));
  let v = s, total = 0;
  for (const e of result.pathEdges) { assert.equal(g.from[e], v); assert.ok(Number.isFinite(costs[e])); v = g.to[e]; total += costs[e]; }
  assert.equal(v, t); assert.ok(Math.abs(total - expected) < 1e-7 * Math.max(1, expected));
}

test("CCH all-pair costs and unpacking match independent Floyd-Warshall after increases, decreases and closures", () => {
  for (const n of [8, 17, 26]) {
    const final = syntheticGraph(n, 309, 0.22), g = final.graph;
    let costs = final.freeFlowS.slice();
    const cch = new CchIndex(g, costs);
    for (let round = 0; round < 8; round++) {
      if (round) costs = Float64Array.from(final.freeFlowS, (c, e) => (e + round) % 11 === 0 ? Infinity : c * (1 + ((e * 7 + round) % 4)));
      cch.update(costs);
      const expected = oracle(g, costs);
      for (let s = 0; s < n; s++) for (let t = 0; t < n; t++) check(g, costs, s, t, cch.query(s, t, round === 0 && s === 0), expected[s][t]);
    }
  }
});
test("LPA* preserves state through repeated directed updates and matches Floyd-Warshall", () => {
  for (const n of [8, 17, 26]) {
    const final = syntheticGraph(n, 309, 0.22), g = final.graph;
    const sessions = Array.from({ length: 5 }, (_, i) => new LpaSearch(g, i, n - 1 - i, final.freeFlowS, 0));
    for (let round = 0; round < 12; round++) {
      const costs = Float64Array.from(final.freeFlowS, (c, e) => round === 10 ? Infinity : round === 11 ? c : (e + round) % 7 === 0 ? Infinity : c * (1 + ((e + round) % 3)));
      const expected = oracle(g, costs);
      sessions.forEach((lpa, i) => check(g, costs, i, n - 1 - i, lpa.search(costs, true), expected[i][n - 1 - i]));
    }
  }
});
test("parallel edges, zero-cost cycles, equal alternatives, isolated vertices and restoration", () => {
  const g = buildStudyGraph({ lat: [0, 0, 0, 0], lng: [0, 0, 0, 0], x: [0, 1, 2, 3], y: [0, 0, 0, 0],
    from: [0, 0, 1, 1, 0], to: [1, 1, 0, 2, 2], len: [0, 2, 0, 2, 2] });
  const cch = new CchIndex(g, g.len), lpa = new LpaSearch(g, 0, 2, g.len, 0);
  for (const costs of [g.len, Float64Array.from([Infinity, 2, 0, 2, Infinity]), Float64Array.from([Infinity, Infinity, 0, 2, Infinity]), g.len]) {
    cch.update(costs); const expected = oracle(g, costs);
    check(g, costs, 0, 2, lpa.search(costs), expected[0][2]);
    for (let s = 0; s < 4; s++) for (let t = 0; t < 4; t++) check(g, costs, s, t, cch.query(s, t), expected[s][t]);
  }
});
test("CCH and LPA* match Dijkstra on saved 5km OSM directed multigraph with a consistent heuristic", () => {
  const json = JSON.parse(readFileSync(new URL("../public/study/final/road.json", import.meta.url), "utf8")) as FinalRoadJson;
  const final = roadRadius(roadGraph(json), 5000).final, g = final.graph, normal = final.freeFlowS;
  const cch = new CchIndex(g, normal);
  const s = 0, t = g.n - 1, lpa = new LpaSearch(g, s, t, normal, 0.01);
  // 0.01 seconds/metre is below all saved road travel-time ratios.
  for (const scenario of [{ id: "normal" }, { id: "congestion", congestedEdgeIds: final.edgeId.filter((_, e) => e % 7 === 0), multiplier: 3 },
    { id: "closed", closedEdgeIds: final.edgeId.filter((_, e) => e % 11 === 0) }, { id: "restored" }]) {
    const costs = edgeCosts(final, "time", scenario); cch.update(costs);
    for (let i = 0; i < 10; i++) {
      const from = i ? i * 127 % g.n : s, to = i ? (i * 313 + 79) % g.n : t;
      const expected = finalSearch(final, from, to, costs, "dijkstra").objectiveCost ?? Infinity;
      check(g, costs, from, to, cch.query(from, to), expected);
      if (!i) check(g, costs, s, t, lpa.search(costs), expected);
    }
  }
});

test("teaching experiment distinguishes distance and time and validates every sequential method including NO_PATH", () => {
  const common = { map: "demo", radius: 2000, objective: "time", change: "few", multiplier: 3, includeNoPath: true, repeats: 2 } as const;
  const routes = runResearch({ ...common, mode: "routes" });
  const congestion = routes.steps.find(s => s.id === "congestion")!;
  const shortest = congestion.runs.find(r => r.objective === "distance")!, fastest = congestion.runs.find(r => r.objective === "time")!;
  assert.equal(shortest.distanceM, 2000); assert.equal(shortest.travelS, 720);
  assert.equal(fastest.distanceM, 3000); assert.equal(fastest.travelS, 360);
  const replan = runResearch({ ...common, mode: "replan" });
  for (const step of replan.steps) for (const run of step.runs) {
    assert.equal(run.verified, true); assert.ok(run.responseMs >= 0);
    assert.equal(run.cost, step.runs[0].cost);
  }
  assert.ok(replan.steps.find(s => s.id === "no_path")!.runs.every(r => r.status === "NO_PATH"));
  assert.ok(replan.steps.at(-1)!.runs.every(r => r.cost === 240));
  assert.equal(replan.steps[0].runs.find(r => r.algorithm === "astar")!.expanded, replan.steps[0].runs.find(r => r.algorithm === "lpa")!.expanded);
  for (const algorithm of ["astar", "cch", "lpa"]) {
    const totals = replan.steps.map(s => s.runs.find(r => r.algorithm === algorithm)!.cumulativeMs);
    assert.ok(totals.every((v, i) => i === 0 || v >= totals[i - 1]));
  }
});
