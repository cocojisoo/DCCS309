// 공식 실험 전 가능성 확인 (PROJECT_BLUEPRINT 7.1)
//   npm run study:check
// 크기마다 DFS 를 한 번씩 돌려 어느 크기부터 제한시간을 넘기는지 보고, results/feasibility.json 에 남긴다.
// 이 결과로 configs/study.json 의 크기 목록을 확정하고 커밋한 뒤에 공식 실험을 돌린다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { planStudy, timedRun } from "../../src/lib/study/benchmark.ts";
import { haversine } from "../../src/lib/graph.ts";
import { localIndex } from "../../src/lib/study/od.ts";
import { centerNode } from "../../src/lib/study/ladder.ts";
import { loadBase, loadConfig, rel, RESULTS } from "./common.ts";

const JOCHIWON_STATION = { lat: 36.6010014, lng: 127.2952359 };

function main() {
  const config = loadConfig();
  const { json, base } = loadBase();
  const plan = planStudy(base, config);
  const c = centerNode(base);
  const toStation = haversine(base.lat[c], base.lng[c], JOCHIWON_STATION.lat, JOCHIWON_STATION.lng);

  console.log(`지도: 교차로 ${base.n}, 도로 ${base.m} · OSM ${json.meta.osmTimestamp}`);
  console.log(`중심 교차로 (${base.lat[c].toFixed(5)}, ${base.lng[c].toFixed(5)}) · 조치원역 후문까지 직선 ${toStation.toFixed(0)}m`);
  console.log(`A* 힌트 검사 (×${plan.heuristic.scale}): 어긋나는 도로 ${plan.heuristic.violations}개`);
  console.log(`트랙 1 쌍 ${plan.track1.length}개: ${plan.track1.map((p) => `${p.id}(${p.straightM.toFixed(0)}m)`).join(", ")}`);
  console.log("");
  console.log("크기        목표   자른 뒤  SCC 후  도로   트랙2쌍  DFS(트랙1 첫 쌍)           DFS(트랙2 첫 쌍)           다익스트라  A*");

  const sizes = [];
  for (const step of plan.ladder) {
    const g = step.graph;
    const t2 = plan.track2[step.label];
    const tryPair = (od?: { source: number; target: number }) => {
      if (!od) return null;
      const s = localIndex(g, od.source);
      const t = localIndex(g, od.target);
      if (s < 0 || t < 0) return null;
      const dfs = timedRun("dfs", g, s, t, config);
      const dij = timedRun("dijkstra", g, s, t, config);
      const ast = timedRun("astar", g, s, t, config);
      return {
        dfs: { status: dfs.result.status, ms: dfs.ms, visits: dfs.result.visitCount, unique: dfs.result.uniqueVisited, lengthM: dfs.result.lengthM },
        dijkstra: { ms: dij.ms, visits: dij.result.visitCount, lengthM: dij.result.lengthM },
        astar: { ms: ast.ms, visits: ast.result.visitCount, lengthM: ast.result.lengthM },
      };
    };
    const a = tryPair(plan.track1[0]);
    const b = tryPair(t2.pairs[0]);
    sizes.push({ label: step.label, kind: step.kind, target: step.target, cutNodes: step.cutNodes, nodes: g.n, edges: g.m, track2Pairs: t2.pairs.length, diameterM: t2.diameterM, track1: a, track2: b });

    const fmt = (r: typeof a) => (r ? `${r.dfs.status.padEnd(7)} ${r.dfs.ms.toFixed(1).padStart(7)}ms ${String(r.dfs.visits).padStart(9)}회` : "(쌍 없음)".padEnd(26));
    const ref = b ?? a;
    console.log(
      `${step.label.padEnd(10)} ${String(step.target).padStart(5)} ${String(step.cutNodes).padStart(8)} ${String(g.n).padStart(7)} ${String(g.m).padStart(6)} ${String(t2.pairs.length).padStart(7)}  ${fmt(a)}  ${fmt(b)}  ${ref ? `${ref.dijkstra.visits}회`.padStart(9) : ""}  ${ref ? `${ref.astar.visits}회` : ""}`,
    );
  }

  const finished = sizes.filter((s) => [s.track1, s.track2].some((r) => r?.dfs.status === "SUCCESS")).length;
  const failed = sizes.filter((s) => [s.track1, s.track2].some((r) => r?.dfs.status === "TIMEOUT")).length;
  const firstFail = sizes.find((s) => [s.track1, s.track2].some((r) => r?.dfs.status === "TIMEOUT"));
  const verdict = finished >= 4 && failed >= 4;
  console.log("");
  console.log(`DFS 가 끝난 크기 ${finished}단계, 시간 초과 난 크기 ${failed}단계${firstFail ? ` (처음 시간 초과: ${firstFail.label}, 교차로 ${firstFail.nodes})` : ""}`);
  console.log(verdict ? "→ 목표(각각 4단계 이상) 충족" : "→ 목표(각각 4단계 이상) 미충족: size_ladder 를 조정해야 합니다 (7.1)");

  mkdirSync(RESULTS, { recursive: true });
  const out = path.join(RESULTS, "feasibility.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        node: process.version,
        config,
        graph: { nodes: base.n, edges: base.m, osmTimestamp: json.meta.osmTimestamp, osmSha256: json.meta.osmSha256 },
        center: { lat: base.lat[c], lng: base.lng[c], toJochiwonStationM: toStation },
        heuristic: plan.heuristic,
        sizes,
        verdict: { dfsFinishedSizes: finished, dfsTimeoutSizes: failed, ok: verdict },
      },
      null,
      2,
    ),
  );
  console.log(`기록: ${rel(out)}`);
}

main();
