// 공식 실험 (PROJECT_BLUEPRINT 7.2 ~ 7.6)
//   npm run study:run
// 결과: results/raw_runs.csv (실패 포함 모든 실행), results/study_meta.json, results/summary.csv, public/study/summary.json
// 측정 직전마다 쓰레기 수집을 먼저 돌린다 (node --expose-gc). V8 은 GC 를 끌 수 없어서 이것이 가장 가까운 방법이다.
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { planStudy, RAW_COLUMNS, runStudy } from "../../src/lib/study/benchmark.ts";
import { csvLine, parseCsv, rawRunFromCsv } from "../../src/lib/study/summary.ts";
import { loadBase, loadConfig, META_JSON, RAW_CSV, rel, RESULTS } from "./common.ts";
import { writeReports, type StudyMeta } from "./report.ts";

function main() {
  const config = loadConfig();
  const { json, base } = loadBase();
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) console.warn("[주의] node --expose-gc 없이 실행했습니다. 측정 전 쓰레기 수집을 하지 않습니다.");

  const startedAt = new Date().toISOString();
  const plan = planStudy(base, config);
  if (plan.heuristic.violations > 0) {
    console.warn(`[주의] A* 힌트가 어긋나는 도로 ${plan.heuristic.violations}개. 원인을 해결하기 전까지 A* 결과는 공식 비교에 쓰지 않습니다 (8.4).`);
  }

  mkdirSync(RESULTS, { recursive: true });
  const fd = openSync(RAW_CSV, "w");
  writeSync(fd, RAW_COLUMNS.join(",") + "\n");
  let count = 0;
  const t0 = performance.now();
  const log = runStudy(plan, config, {
    gc,
    onProgress: (m) => console.log(`${((performance.now() - t0) / 1000).toFixed(0).padStart(5)}s ${m}`),
    onRow: (row) => {
      count++;
      // 한 줄씩 바로 써서 중간에 멈춰도 그때까지의 기록이 남는다
      writeSync(fd, csvLine(row, RAW_COLUMNS) + "\n");
    },
  });
  closeSync(fd);

  const meta: StudyMeta = {
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: { node: process.version, platform: `${process.platform} ${process.arch}`, gcBeforeEachRun: Boolean(gc) },
    config,
    graph: json.meta,
    ladder: plan.ladder.map((s) => ({ label: s.label, kind: s.kind, target: s.target, cutNodes: s.cutNodes, nodes: s.graph.n, edges: s.graph.m })),
    heuristic: plan.heuristic,
    pairs: { track1: plan.track1, track2: plan.track2 },
    log,
  };
  writeFileSync(META_JSON, JSON.stringify(meta, null, 2));
  console.log(`실행 ${count}번 → ${rel(RAW_CSV)} · 설정/쌍/제외 기록 → ${rel(META_JSON)}`);
  if (log.excluded.length) console.log(`제외된 쌍 ${log.excluded.length}개 (지도에 없는 교차로)`);
  if (log.mismatches.length) console.warn(`[주의] 성공한 방법끼리 길이가 다른 경우 ${log.mismatches.length}건. 속도 비교를 발표하기 전에 원인을 찾으세요 (7.6).`);
  else console.log("정답 확인: 성공한 방법끼리 길이 모두 일치 (0.01m 이내)");
  // 요약은 방금 쓴 CSV 를 다시 읽어서 만든다 → npm run study:summarize 와 결과가 똑같다
  writeReports(meta, parseCsv(readFileSync(RAW_CSV, "utf8")).map(rawRunFromCsv));
}

main();
