// 발표용 탐색 기록을 미리 만든다 (PROJECT_BLUEPRINT 9절 "애니메이션 만드는 방법")
//   npm run study:traces
// 결과: public/study/traces/index.json, public/study/traces/<크기>.json
// 화면은 이 기록을 재생만 하고, 발표 중에 알고리즘을 다시 돌리지 않는다.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { planStudy } from "../../src/lib/study/benchmark.ts";
import { makeDemo, type DemoIndexEntry } from "../../src/lib/study/demo.ts";
import { loadBase, loadConfig, PUBLIC_STUDY, rel } from "./common.ts";

function main() {
  const config = loadConfig();
  const { base } = loadBase();
  const plan = planStudy(base, config);
  const dir = path.join(PUBLIC_STUDY, "traces");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const index: DemoIndexEntry[] = [];
  for (const step of plan.ladder) {
    // 장면 ③ (먼 출발·도착)이 기본으로 보이도록 트랙 2 쌍을 앞에 둔다
    const pairs = [...plan.track2[step.label].pairs.slice(0, config.demo.growing_pairs), ...plan.track1.slice(0, config.demo.fixed_pairs)];
    const demo = makeDemo(step, pairs, config);
    const file = path.join(dir, `${step.label}.json`);
    const text = JSON.stringify(demo);
    writeFileSync(file, text);
    index.push({
      label: demo.label,
      title: demo.title,
      nodes: demo.nodes,
      edges: demo.edges,
      pairs: demo.pairs.map((p) => ({ id: p.od.id, track: p.od.track, straightM: p.od.straightM })),
    });
    const dfs = demo.pairs.map((p) => p.runs.dfs.status).join("/");
    console.log(`${step.label.padEnd(6)} 교차로 ${String(demo.nodes).padStart(5)} · 쌍 ${demo.pairs.length} · DFS ${dfs} · ${(text.length / 1024).toFixed(0)}KB`);
  }
  // 교차로 수 순서로 정렬해 크기 슬라이더가 작은 지도 → 큰 지도 순서가 되게 한다
  index.sort((a, b) => a.nodes - b.nodes);
  writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  console.log(`기록: ${rel(dir)}`);
}

main();
