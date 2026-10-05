import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dijkstraSearch } from "../src/lib/study/bestFirst.ts";
import { classroomGraph } from "../src/lib/study/classroom.ts";
import type { DemoFile } from "../src/lib/study/demo.ts";
import type { StudyGraphJson } from "../src/lib/study/graph.ts";
import { experimentGraph, replanSteps, requestPairs, runRoutingExperiment, verifyExperimentRoute, type ExperimentRequest } from "../src/lib/study/routingExperiments.ts";

const json: StudyGraphJson = JSON.parse(readFileSync("public/graph/study.json", "utf8"));
const file: DemoFile = JSON.parse(readFileSync("public/study/traces/r1000.json", "utf8"));
const od = file.pairs[0].od;
const request: ExperimentRequest = { kind: "many-queries", json, edgeIds: file.edgeIds, source: od.source, target: od.target, count: 30, scope: "local", scenario: "congestion", seed: 309, repeats: 3 };

test("새 실험 지도는 기존 시뮬레이션의 노드와 도로를 그대로 사용한다", () => {
  const g = experimentGraph(json, file.edgeIds);
  assert.equal(g.n, file.nodes);
  assert.deepEqual([...g.origEdge].sort((a, b) => a - b), [...file.edgeIds].sort((a, b) => a - b));
  assert.throws(() => experimentGraph(json, [json.from.length]), /도로 번호/);
});

test("요청은 서로 다르며 같은 조건에서 요청 수를 늘려도 앞쪽 요청이 유지된다", () => {
  const g = classroomGraph();
  const small = requestPairs(g, 10, 309, [0, 7]);
  const large = requestPairs(g, 30, 309, [0, 7]);
  assert.deepEqual(small, large.slice(0, 10));
  assert.equal(new Set(large.map(([s, t]) => `${s}:${t}`)).size, 30);
  assert.ok(large.every(([s, t]) => s !== t));
});

test("CCH는 한 번 반영한 비용을 여러 요청에 공유하며 모든 측정 응답을 정답 검사한다", () => {
  for (const scenario of ["normal", "congestion", "closure"] as const) {
    const r = runRoutingExperiment({ ...request, scenario });
    assert.equal(r.checkedCases, 30);
    assert.equal(r.checks, 30 * 2 * 3);
    assert.deepEqual(r.checkpoints, [1, 10, 30]);
    assert.equal(r.examples.length, 3);
    assert.ok(r.cchSetup);
    if (scenario === "normal") assert.equal(r.cchSetup.recomputed, 0);
    for (const algo of r.algorithms) {
      const m = r.metrics[algo]!;
      assert.equal(m.cumulativeMs.length, 30);
      assert.ok(m.cumulativeMs.every((n, i, ns) => n >= 0 && (i === 0 || n >= ns[i - 1])));
      assert.ok(m.withInitialMs.every((n, i) => n >= m.cumulativeMs[i]));
    }
  }
});

test("LPA*는 같은 출발·도착의 혼잡·폐쇄·해소 9회를 연속 처리하고 정상 경로로 복구한다", () => {
  for (const scope of ["local", "wide"] as const) {
    const r = runRoutingExperiment({ ...request, kind: "replanning", count: 9, scope });
    assert.equal(r.checks, 9 * 2 * 3);
    assert.equal(r.examples.length, 9);
    assert.deepEqual(r.eventLabels, ["혼잡", "폐쇄", "해소", "혼잡", "폐쇄", "해소", "혼잡", "폐쇄", "해소"]);
    if (scope === "local") assert.ok(r.changedRoads.every((n) => n === 1));
    const restored = r.examples.filter((e) => e.label === "해소");
    const expected = file.pairs[0].runs.dijkstra.lengthM;
    for (const e of restored) {
      assert.deepEqual(e.od, { source: od.source, target: od.target });
      assert.equal(e.changes.length, 0);
      assert.ok(Math.abs(e.runs.lpa!.lengthM! - expected!) < 0.01);
      assert.ok(Math.abs(e.runs.astar!.timeS! - e.runs.lpa!.timeS!) < 1e-6);
    }
  }
});

test("교통 변화 계획은 재현 가능하고 이전 비용 배열을 수정하지 않는다", () => {
  const g = classroomGraph();
  const normal = g.len.slice();
  const base = dijkstraSearch(g, 0, 7, { timeLimitMs: null, weights: normal });
  const before = normal.slice();
  const steps = replanSteps(g, normal, base.pathEdges, 6, "local", 309);
  assert.deepEqual(steps, replanSteps(g, normal, base.pathEdges, 6, "local", 309));
  assert.deepEqual(normal, before);
  assert.deepEqual(steps[2].weights, normal);
  assert.deepEqual(steps[5].weights, normal);
});

test("정답 검사는 폐쇄 도로를 지나는 잘못된 경로를 거부한다", () => {
  const g = classroomGraph();
  const w = g.len.slice();
  const r = dijkstraSearch(g, 0, 7, { timeLimitMs: null, weights: w });
  w[r.pathEdges[0]] = Infinity;
  const ref = dijkstraSearch(g, 0, 7, { timeLimitMs: null, weights: w });
  assert.throws(() => verifyExperimentRoute(g, 0, 7, w, r, ref));
});
