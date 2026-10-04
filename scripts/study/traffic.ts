// 혼잡 · 폐쇄 실험 (명세서 3절)
//   npm run study:traffic
// 정상 상태 → 혼잡 / 폐쇄 / 혼잡+폐쇄 로 바뀌었을 때 A*, CCH, LPA* 가 새 경로를 찾는 데 드는 계산과 결과를 잰다.
// 결과: results/traffic_runs.csv (반복 한 번마다 한 줄), public/study/traffic/index.json, public/study/traffic/<경로>.json
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { planStudy } from "../../src/lib/study/benchmark.ts";
import { ladderTitle } from "../../src/lib/study/ladder.ts";
import { localIndex } from "../../src/lib/study/od.ts";
import { csvLine } from "../../src/lib/study/summary.ts";
import {
  makeTrafficDemo,
  runTrafficOd,
  summarizeTraffic,
  TRAFFIC_COLUMNS,
  trafficTargets,
  type TrafficIndex,
  type TrafficOd,
} from "../../src/lib/study/traffic.ts";
import { loadBase, loadConfig, PUBLIC_STUDY, rel, RESULTS } from "./common.ts";

function main() {
  const config = loadConfig();
  const { base } = loadBase();
  const gc = (globalThis as { gc?: () => void }).gc;
  const plan = planStudy(base, config);
  const { step, pairs } = trafficTargets(plan.ladder, plan.track2, config);
  console.log(`지도 ${step.label} (교차로 ${step.graph.n}) · 경로 ${pairs.length}개 · 방법 ${config.traffic.algorithms.join(", ")}`);

  mkdirSync(RESULTS, { recursive: true });
  const csv = path.join(RESULTS, "traffic_runs.csv");
  const fd = openSync(csv, "w");
  writeSync(fd, TRAFFIC_COLUMNS.join(",") + "\n");
  const dir = path.join(PUBLIC_STUDY, "traffic");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const results: TrafficOd[] = [];
  for (const [i, od] of pairs.entries()) {
    const s = localIndex(step.graph, od.source);
    const t = localIndex(step.graph, od.target);
    const r = runTrafficOd(step.graph, s, t, od.id, config, gc, (row) => writeSync(fd, csvLine(row, TRAFFIC_COLUMNS) + "\n"));
    results.push(r);
    const demo = makeTrafficDemo(step, od, r, config);
    writeFileSync(path.join(dir, `${od.id}.json`), JSON.stringify(demo));
    for (const cs of r.cases) {
      const parts = Object.entries(cs.runs).map(([a, run]) => `${a} ${run!.searchMs.toFixed(3)}ms/${run!.visited}곳/${run!.timeS?.toFixed(1)}초`);
      console.log(`  경로 ${i + 1} ${cs.scenario.padEnd(10)} 정상 ${r.normal.timeS.toFixed(1)}초 → 정상 경로 그대로 ${cs.normalRouteNowS?.toFixed(1) ?? "막힘"} · ${parts.join(" · ")}`);
    }
  }
  closeSync(fd);

  const index: TrafficIndex = {
    size: { label: step.label, title: ladderTitle(step.kind, step.target), nodes: step.graph.n, edges: step.graph.m },
    algorithms: config.traffic.algorithms,
    pairs: pairs.map((p) => ({ odId: p.id, straightM: p.straightM })),
    summary: summarizeTraffic(results, config),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  console.log(`기록: ${rel(csv)}, ${rel(dir)}`);
}

main();
