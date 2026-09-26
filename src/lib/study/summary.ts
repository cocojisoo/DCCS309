import type { RawRun, StudyConfig, StudyRunLog } from "./benchmark.ts";
import type { StudyGraphMeta } from "./graph.ts";
import type { OdPair } from "./od.ts";
import { STUDY_ALGORITHMS, type StudyAlgorithmId } from "./search.ts";

/** results/summary.csv 의 한 줄: 트랙 × 크기 × 방법 */
export interface SummaryRow {
  track: 1 | 2;
  size_label: string;
  graph_nodes: number;
  graph_edges: number;
  algorithm: StudyAlgorithmId;
  od_count: number;
  runs: number;
  success: number;
  timeout: number;
  no_path: number;
  error: number;
  timeout_ratio: number;
  /** 쌍마다 반복 5회 중간값을 구하고, 쌍들 사이의 중간값 / 최솟값 / 최댓값 */
  median_ms: number;
  min_ms: number;
  max_ms: number;
  median_visits: number;
  max_visits: number;
  median_unique: number;
  /** visit_count / unique_visited 의 중간값. 크면 같은 곳을 반복해서 봤다는 뜻 */
  median_visit_ratio: number;
  median_complete_paths: number | null;
  median_route_m: number | null;
}

export const SUMMARY_COLUMNS: (keyof SummaryRow)[] = [
  "track", "size_label", "graph_nodes", "graph_edges", "algorithm", "od_count", "runs", "success", "timeout",
  "no_path", "error", "timeout_ratio", "median_ms", "min_ms", "max_ms", "median_visits", "max_visits",
  "median_unique", "median_visit_ratio", "median_complete_paths", "median_route_m",
];

/** public/study/summary.json: 화면이 읽는 실험 결과 전체 */
export interface StudySummary {
  startedAt: string;
  finishedAt: string;
  environment: { node: string; platform: string; gcBeforeEachRun: boolean };
  config: StudyConfig;
  graph: StudyGraphMeta;
  ladder: { label: string; kind: "nodes" | "radius"; target: number; cutNodes: number; nodes: number; edges: number }[];
  heuristic: { scale: number; violations: number; examples: { edge: number; straightM: number; lengthM: number }[] };
  pairs: { track1: OdPair[]; track2: Record<string, { pairs: OdPair[]; diameterM: number }> };
  log: StudyRunLog;
  rows: SummaryRow[];
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function summarize(rows: RawRun[]): SummaryRow[] {
  const out: SummaryRow[] = [];
  const algoOrder = STUDY_ALGORITHMS.map((a) => a.id);
  for (const group of groupBy(rows, (r) => `${r.track}|${r.size_label}|${r.algorithm}`).values()) {
    const first = group[0];
    const byOd = [...groupBy(group, (r) => r.od_id).values()];
    const perOd = (pick: (r: RawRun) => number | null) =>
      byOd.map((runs) => median(runs.map(pick).filter((v): v is number => v !== null))).filter((v) => !Number.isNaN(v));
    const ms = perOd((r) => r.search_ms);
    const visits = perOd((r) => r.visit_count);
    const count = (s: RawRun["status"]) => group.filter((r) => r.status === s).length;
    const complete = perOd((r) => r.complete_paths);
    const route = perOd((r) => (r.status === "SUCCESS" ? r.route_length_m : null));
    out.push({
      track: first.track,
      size_label: first.size_label,
      graph_nodes: first.graph_nodes,
      graph_edges: first.graph_edges,
      algorithm: first.algorithm,
      od_count: byOd.length,
      runs: group.length,
      success: count("SUCCESS"),
      timeout: count("TIMEOUT"),
      no_path: count("NO_PATH"),
      error: count("ERROR"),
      timeout_ratio: count("TIMEOUT") / group.length,
      median_ms: median(ms),
      min_ms: Math.min(...ms),
      max_ms: Math.max(...ms),
      median_visits: median(visits),
      max_visits: Math.max(...visits),
      median_unique: median(perOd((r) => r.unique_visited)),
      median_visit_ratio: median(perOd((r) => (r.unique_visited ? r.visit_count / r.unique_visited : null))),
      median_complete_paths: complete.length ? median(complete) : null,
      median_route_m: route.length ? median(route) : null,
    });
  }
  return out.sort(
    (a, b) => a.track - b.track || a.graph_nodes - b.graph_nodes || a.size_label.localeCompare(b.size_label) || algoOrder.indexOf(a.algorithm) - algoOrder.indexOf(b.algorithm),
  );
}

/** CSV 한 칸. null 은 빈칸 (실패한 줄의 길이는 0 이 아니라 빈칸) */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined || (typeof v === "number" && Number.isNaN(v))) return "";
  const s = typeof v === "number" && !Number.isInteger(v) ? String(Math.round(v * 10000) / 10000) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine<T>(row: T, columns: (keyof T)[]): string {
  return columns.map((c) => csvCell(row[c])).join(",");
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const split = (line: string) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const [head, ...rest] = lines.map(split);
  return rest.map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""])));
}

/** raw_runs.csv 를 다시 읽어 RawRun 으로 (그래프를 CSV 만으로 다시 만들기 위함) */
export function rawRunFromCsv(r: Record<string, string>): RawRun {
  const num = (k: string) => Number(r[k]);
  const opt = (k: string) => (r[k] === "" ? null : Number(r[k]));
  return {
    run_id: num("run_id"),
    track: num("track") as 1 | 2,
    size_label: r.size_label,
    graph_nodes: num("graph_nodes"),
    graph_edges: num("graph_edges"),
    od_id: r.od_id,
    source: num("source"),
    target: num("target"),
    od_straight_m: num("od_straight_m"),
    algorithm: r.algorithm as StudyAlgorithmId,
    repetition: num("repetition"),
    status: r.status as RawRun["status"],
    search_ms: num("search_ms"),
    visit_count: num("visit_count"),
    unique_visited: num("unique_visited"),
    complete_paths: opt("complete_paths"),
    route_length_m: opt("route_length_m"),
    route_edge_ids: r.route_edge_ids,
    error_reason: r.error_reason,
  };
}
