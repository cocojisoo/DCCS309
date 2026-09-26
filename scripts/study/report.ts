// raw_runs.csv + study_meta.json → summary.csv, public/study/summary.json
// 그래프와 표는 전부 이 결과에서 다시 만든다 (손으로 숫자를 옮기지 않는다).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RawRun } from "../../src/lib/study/benchmark.ts";
import { csvLine, summarize, SUMMARY_COLUMNS, type StudySummary } from "../../src/lib/study/summary.ts";
import { PUBLIC_STUDY, rel, SUMMARY_CSV } from "./common.ts";

export type StudyMeta = Omit<StudySummary, "rows">;

export function writeReports(meta: StudyMeta, rows: RawRun[]) {
  const summaryRows = summarize(rows);
  writeFileSync(SUMMARY_CSV, [SUMMARY_COLUMNS.join(","), ...summaryRows.map((r) => csvLine(r, SUMMARY_COLUMNS))].join("\n") + "\n");
  mkdirSync(PUBLIC_STUDY, { recursive: true });
  const out = path.join(PUBLIC_STUDY, "summary.json");
  const summary: StudySummary = { ...meta, rows: summaryRows };
  writeFileSync(out, JSON.stringify(summary));
  console.log(`요약: ${rel(SUMMARY_CSV)}, ${rel(out)} (${summaryRows.length}줄)`);
}
