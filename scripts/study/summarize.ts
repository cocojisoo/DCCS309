// raw_runs.csv 만으로 요약과 화면용 데이터를 다시 만든다 (실험을 다시 돌리지 않음)
//   npm run study:summarize
import { readFileSync } from "node:fs";
import { parseCsv, rawRunFromCsv } from "../../src/lib/study/summary.ts";
import { META_JSON, RAW_CSV } from "./common.ts";
import { writeReports, type StudyMeta } from "./report.ts";

function main() {
  const meta: StudyMeta = JSON.parse(readFileSync(META_JSON, "utf8"));
  const rows = parseCsv(readFileSync(RAW_CSV, "utf8")).map(rawRunFromCsv);
  writeReports(meta, rows);
}

main();
