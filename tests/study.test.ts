// 실험 코드 테스트 (PROJECT_BLUEPRINT 11절 1~2단계)
//   npm run test:study
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { planStudy, type StudyConfig } from "../src/lib/study/benchmark.ts";
import { CLASSROOM_SOURCE, CLASSROOM_TARGET, classroomGraph } from "../src/lib/study/classroom.ts";
import { FINDERS } from "../src/lib/study/finders.ts";
import { buildStudyGraph, largestSccMask, studyGraphFromJson, type StudyGraph } from "../src/lib/study/graph.ts";
import { seededRandom } from "../src/lib/study/rng.ts";
import { checkHeuristic, checkRoute, STUDY_ALGORITHMS } from "../src/lib/study/search.ts";
import { csvLine, parseCsv, rawRunFromCsv } from "../src/lib/study/summary.ts";
import { RAW_COLUMNS, type RawRun } from "../src/lib/study/benchmark.ts";
import { TupleHeap } from "../src/lib/study/tupleHeap.ts";
import { customizeCch, prepareCch, queryCch, updateCch } from "../src/lib/study/cch.ts";
import { LpaStar } from "../src/lib/study/lpa.ts";
import { classroomScene } from "../src/lib/study/classroomScenes.ts";

const NO_LIMIT = { timeLimitMs: null, heuristicScale: 0.999 };

/** 정답 확인용: 플로이드-워셜 (알고리즘과 독립적인 구현) */
function floyd(g: StudyGraph): number[][] {
  const d = Array.from({ length: g.n }, (_, i) => Array.from({ length: g.n }, (_, j) => (i === j ? 0 : Infinity)));
  for (let e = 0; e < g.m; e++) d[g.from[e]][g.to[e]] = Math.min(d[g.from[e]][g.to[e]], g.len[e]);
  for (let k = 0; k < g.n; k++) for (let i = 0; i < g.n; i++) for (let j = 0; j < g.n; j++) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
  return d;
}

/** 좌표를 가진 작은 무작위 방향 그래프. 도로 길이 ≥ 직선거리 (실제 도로처럼) */
function randomGraph(rand: () => number, n: number, edgeProb: number): StudyGraph {
  const x = Array.from({ length: n }, () => rand() * 1000);
  const y = Array.from({ length: n }, () => rand() * 1000);
  const from: number[] = [];
  const to: number[] = [];
  const len: number[] = [];
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) {
      if (a === b || rand() > edgeProb) continue;
      from.push(a);
      to.push(b);
      len.push(Math.hypot(x[a] - x[b], y[a] - y[b]) * (1 + rand() * 0.6));
    }
  return buildStudyGraph({ lat: y, lng: x, x, y, from, to, len });
}

describe("손으로 만든 지도", () => {
  const g = classroomGraph();

  test("세 방법 모두 손 계산 정답 605m (S → A → D → F → T)", () => {
    for (const a of STUDY_ALGORITHMS) {
      const r = FINDERS[a.id](g, CLASSROOM_SOURCE, CLASSROOM_TARGET, NO_LIMIT);
      assert.equal(r.status, "SUCCESS", a.id);
      assert.equal(r.lengthM, 605, a.id);
      assert.deepEqual([...r.pathEdges.map((e) => g.to[e])], [2, 5, 6, 7], a.id);
      assert.equal(checkRoute(g, CLASSROOM_SOURCE, CLASSROOM_TARGET, r.pathEdges, r.lengthM!), null);
    }
  });

  test("DFS 는 같은 교차로를 여러 번 방문하고, 다익스트라/A* 는 한 번씩만", () => {
    const dfs = FINDERS.dfs(g, CLASSROOM_SOURCE, CLASSROOM_TARGET, NO_LIMIT);
    const dij = FINDERS.dijkstra(g, CLASSROOM_SOURCE, CLASSROOM_TARGET, NO_LIMIT);
    assert.ok(dfs.visitCount > dfs.uniqueVisited);
    assert.ok(dfs.completePaths! > 1);
    assert.equal(dij.visitCount, dij.uniqueVisited);
    assert.equal(dij.visitCount, 8);
  });

  test("A* 는 도착점 반대쪽 골목 W 를 보지 않는다", () => {
    const opts = { ...NO_LIMIT, recordTrace: true, maxFrames: 100 };
    const dij = FINDERS.dijkstra(g, CLASSROOM_SOURCE, CLASSROOM_TARGET, opts);
    const ast = FINDERS.astar(g, CLASSROOM_SOURCE, CLASSROOM_TARGET, opts);
    assert.ok(dij.trace!.order.includes(1));
    assert.ok(!ast.trace!.order.includes(1));
    assert.ok(ast.visitCount < dij.visitCount);
  });

  test("출발 = 도착이면 길이 0, 빈 경로, SUCCESS", () => {
    for (const a of STUDY_ALGORITHMS) {
      const r = FINDERS[a.id](g, 3, 3, NO_LIMIT);
      assert.equal(r.status, "SUCCESS");
      assert.equal(r.lengthM, 0);
      assert.deepEqual(r.pathEdges, []);
    }
  });

  test("일방통행으로 갈 수 없으면 NO_PATH", () => {
    const one = buildStudyGraph({ lat: [0, 0, 0], lng: [0, 1, 2], x: [0, 1, 2], y: [0, 0, 0], from: [0, 1], to: [1, 2], len: [1, 1] });
    for (const a of STUDY_ALGORITHMS) {
      assert.equal(FINDERS[a.id](one, 0, 2, NO_LIMIT).lengthM, 2, a.id);
      assert.equal(FINDERS[a.id](one, 2, 0, NO_LIMIT).status, "NO_PATH", a.id);
    }
  });

  test("기록(trace)을 켜도 결과는 같고, 장면 수는 제한 이하", () => {
    for (const a of STUDY_ALGORITHMS) {
      const r = FINDERS[a.id](g, CLASSROOM_SOURCE, CLASSROOM_TARGET, { ...NO_LIMIT, recordTrace: true, maxFrames: 5 });
      assert.equal(r.lengthM, 605);
      assert.ok(r.trace!.frames.length <= 5);
      assert.equal(r.trace!.frames.at(-1)!.step, r.visitCount);
    }
  });
});

describe("알고리즘 교실 장면", () => {
  const g = classroomGraph();
  const route = (path: number[]) => [CLASSROOM_SOURCE, ...path.map((e) => g.to[e])];

  test("DFS · 다익스트라 · A* · CCH 는 마지막 단계에서 S→A→D→F→T 를 보여 준다", () => {
    for (const id of ["dfs", "dijkstra", "astar", "cch"] as const) {
      const scene = classroomScene(id);
      const last = scene.steps.at(-1)!;
      assert.deepEqual(route(last.final!), [0, 2, 5, 6, 7], id);
    }
  });

  test("CCH 장면: 지름길을 만들고, 질의 단계가 있다", () => {
    const scene = classroomScene("cch");
    assert.ok(scene.shortcuts!.length > 0);
    assert.ok(scene.steps.some((s) => s.phase === "질의"));
    assert.equal(scene.ranks!.length, g.n);
  });

  test("LPA* 장면: D–F 혼잡 뒤 다시 계획한 경로는 S→A→C→F→T (645)", () => {
    const scene = classroomScene("lpa");
    const last = scene.steps.at(-1)!;
    assert.deepEqual(route(last.final!), [0, 2, 4, 6, 7]);
    const replans = scene.steps.filter((s) => s.phase === "다시 계획").length;
    const firsts = scene.steps.filter((s) => s.phase === "첫 계획").length;
    assert.ok(replans > 0 && replans < firsts + 1);
  });
});

describe("무작위 작은 지도 300개", () => {
  test("세 방법의 길이 = 플로이드-워셜 정답, 경로 검사 통과", () => {
    const rand = seededRandom(309);
    for (let k = 0; k < 300; k++) {
      const g = randomGraph(rand, 3 + Math.floor(rand() * 7), 0.15 + rand() * 0.4);
      const ref = floyd(g);
      const s = Math.floor(rand() * g.n);
      const t = Math.floor(rand() * g.n);
      for (const a of STUDY_ALGORITHMS) {
        const r = FINDERS[a.id](g, s, t, NO_LIMIT);
        if (ref[s][t] === Infinity) {
          assert.equal(r.status, "NO_PATH", `${a.id} #${k}`);
          continue;
        }
        assert.equal(r.status, "SUCCESS", `${a.id} #${k}`);
        assert.ok(Math.abs(r.lengthM! - ref[s][t]) < 1e-6, `${a.id} #${k}: ${r.lengthM} vs ${ref[s][t]}`);
        assert.equal(checkRoute(g, s, t, r.pathEdges, r.lengthM!), null);
      }
    }
  });
});

describe("비용을 바꾼 지도 (이동시간 · 혼잡 · 폐쇄)", () => {
  test("임의의 비용 배열에서도 다섯 방법이 플로이드-워셜 정답과 같다", () => {
    const rand = seededRandom(31);
    for (let k = 0; k < 200; k++) {
      const g = randomGraph(rand, 3 + Math.floor(rand() * 8), 0.2 + rand() * 0.4);
      // 길이 ≥ 직선거리이고 비용 ≥ 길이 이므로 힌트 0.999 는 그대로 안전하다
      const w = Float64Array.from(g.len, (l) => (rand() < 0.1 ? Infinity : l * (1 + rand() * 3)));
      const wg = buildStudyGraph({ lat: g.lat, lng: g.lng, x: g.x, y: g.y, from: g.from, to: g.to, len: w.map((c) => (c === Infinity ? 1e18 : c)) });
      const ref = floyd(wg);
      const s = Math.floor(rand() * g.n);
      const t = Math.floor(rand() * g.n);
      for (const a of STUDY_ALGORITHMS) {
        const r = FINDERS[a.id](g, s, t, { ...NO_LIMIT, weights: w });
        const expect = ref[s][t] >= 1e17 ? Infinity : ref[s][t];
        if (expect === Infinity) {
          assert.equal(r.status, "NO_PATH", `${a.id} #${k}`);
          continue;
        }
        assert.equal(r.status, "SUCCESS", `${a.id} #${k}`);
        assert.ok(Math.abs(r.cost! - expect) < 1e-6, `${a.id} #${k}: ${r.cost} vs ${expect}`);
        assert.equal(checkRoute(g, s, t, r.pathEdges, r.lengthM!), null, `${a.id} #${k}`);
      }
    }
  });

  test("CCH 부분 커스터마이징과 LPA* 재계획은 처음부터 다시 푼 다익스트라와 같다", () => {
    const rand = seededRandom(77);
    for (let k = 0; k < 120; k++) {
      const g = randomGraph(rand, 6 + Math.floor(rand() * 10), 0.25 + rand() * 0.3);
      const s = Math.floor(rand() * g.n);
      const t = Math.floor(rand() * g.n);
      let w = Float64Array.from(g.len);
      const metric = customizeCch(prepareCch(g), w);
      const lpa = new LpaStar(g, s, t, w, 0.999);
      lpa.compute();
      for (let round = 0; round < 4; round++) {
        // 혼잡(비용 증가), 정체 해소(감소), 폐쇄(Infinity) 를 섞어서 바꾼다
        const next = w.slice();
        const changed: number[] = [];
        for (let e = 0; e < g.m; e++) {
          if (rand() > 0.25) continue;
          const r = rand();
          next[e] = r < 0.2 ? Infinity : g.len[e] * (1 + r * 4);
          changed.push(e);
        }
        updateCch(metric, next, changed);
        for (const e of changed) lpa.setWeight(e, next[e]);
        w = next;
        const ref = FINDERS.dijkstra(g, s, t, { ...NO_LIMIT, weights: w });
        const viaCch = queryCch(metric, s, t, NO_LIMIT);
        const viaLpa = lpa.compute();
        for (const [name, r] of [["CCH", viaCch], ["LPA*", viaLpa]] as const) {
          assert.equal(r.status, ref.status, `${name} #${k}.${round}`);
          if (ref.status === "SUCCESS") {
            assert.ok(Math.abs(r.cost! - ref.cost!) < 1e-6, `${name} #${k}.${round}: ${r.cost} vs ${ref.cost}`);
            assert.equal(checkRoute(g, s, t, r.pathEdges, r.lengthM!), null);
          }
        }
      }
    }
  });
});

describe("DFS 제한시간", () => {
  test("완전 그래프에서 제한시간을 넘기면 TIMEOUT, 길이는 비움", () => {
    const g = randomGraph(seededRandom(1), 14, 1);
    const r = FINDERS.dfs(g, 0, 13, { timeLimitMs: 20 });
    assert.equal(r.status, "TIMEOUT");
    assert.equal(r.lengthM, null);
    assert.ok(r.visitCount > 1000);
  });
});

describe("우선순위 큐", () => {
  test("(a, b, c) 순서로 꺼낸다", () => {
    const rand = seededRandom(7);
    const heap = new TupleHeap();
    const keys: [number, number, number][] = [];
    for (let i = 0; i < 500; i++) {
      const k: [number, number, number] = [Math.floor(rand() * 10), Math.floor(rand() * 5), i];
      keys.push(k);
      heap.push(...k, i);
    }
    keys.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    for (const k of keys) assert.equal(heap.pop(), k[2]);
  });

  test("A* 동점이면 지금까지 거리가 긴 쪽(−거리가 작은 쪽)을 먼저", () => {
    const heap = new TupleHeap();
    heap.push(100, -30, 0, 1);
    heap.push(100, -70, 1, 2);
    assert.equal(heap.pop(), 2);
  });
});

describe("CSV", () => {
  test("실패한 줄의 길이는 빈칸으로 쓰고 다시 읽으면 null", () => {
    const row: RawRun = {
      run_id: 1, track: 2, size_label: "n200", graph_nodes: 192, graph_edges: 458, od_id: "T2-n200-1", source: 3, target: 9,
      od_straight_m: 812.5, algorithm: "dfs", repetition: 1, status: "TIMEOUT", search_ms: 2000.1, visit_count: 80000000,
      unique_visited: 190, complete_paths: 12, route_length_m: null, route_time_s: null, route_edge_ids: "", error_reason: "",
    };
    const line = csvLine(row, RAW_COLUMNS);
    assert.ok(line.includes(",12,,,,"));
    const back = rawRunFromCsv(parseCsv(`${RAW_COLUMNS.join(",")}\n${line}\n`)[0]);
    assert.deepEqual(back, row);
  });
});

const GRAPH = "public/graph/study.json";
describe("실제 조치원 지도", { skip: !existsSync(GRAPH) && "study.json 없음" }, () => {
  const json = JSON.parse(readFileSync(GRAPH, "utf8"));
  const base = studyGraphFromJson(json);
  const config: StudyConfig = JSON.parse(readFileSync("configs/study.json", "utf8"));

  test("형식: 도로 길이는 모두 양수, 교차로 번호는 범위 안", () => {
    assert.equal(base.from.length, base.len.length);
    for (let e = 0; e < base.m; e++) {
      assert.ok(base.len[e] > 0);
      assert.ok(base.from[e] < base.n && base.to[e] < base.n && base.from[e] !== base.to[e]);
    }
  });

  test("같은 두 교차로 사이 도로는 하나만", () => {
    const seen = new Set<number>();
    for (let e = 0; e < base.m; e++) {
      const k = base.from[e] * base.n + base.to[e];
      assert.ok(!seen.has(k));
      seen.add(k);
    }
  });

  test("A* 힌트 안전 확인: 어긋나는 도로 0개", () => {
    assert.deepEqual(checkHeuristic(base, config.astar.heuristic_scale), []);
  });

  test("크기 사다리: 모든 조각이 강연결, 출발·도착 쌍은 시드 고정", () => {
    const a = planStudy(base, config);
    const b = planStudy(base, config);
    for (const step of a.ladder) {
      assert.ok(largestSccMask(step.graph).every((x) => x === 1), step.label);
      const [lo, hi] = config.track_growing_od.straight_distance_ratio;
      for (const p of a.track2[step.label].pairs) {
        assert.notEqual(p.source, p.target);
        assert.ok(p.straightM >= lo * a.track2[step.label].diameterM - 1e-6 && p.straightM <= hi * a.track2[step.label].diameterM + 1e-6);
      }
    }
    assert.deepEqual(a.track1, b.track1);
    assert.deepEqual(a.track2, b.track2);
  });
});
