import type { AlgorithmId } from "./algorithms";
import type { BenchmarkResult } from "./benchmark";
import type { Mode } from "./config";

/** 브라우저 localStorage 에 쌓는 실행 기록 (/logs 페이지에서 조회) */
export interface HistoryEntry {
  at: string;
  penalties: boolean;
  results: Record<Mode, Record<AlgorithmId, { etaSec: number; distanceM: number; visited: number; runtimeMs: number; optimal: boolean }>>;
}

const KEY = "route-lab:history";
const MAX = 50;

export function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendHistory(b: BenchmarkResult) {
  const results = {} as HistoryEntry["results"];
  for (const mode of ["car", "walk"] as Mode[]) {
    results[mode] = {} as HistoryEntry["results"][Mode];
    for (const r of b.modes[mode].runs) {
      results[mode][r.algorithm] = {
        etaSec: r.costSec,
        distanceM: r.distanceM,
        visited: r.visited,
        runtimeMs: r.runtimeMs,
        optimal: r.optimal,
      };
    }
  }
  try {
    localStorage.setItem(KEY, JSON.stringify([{ at: b.startedAt, penalties: b.penalties, results }, ...readHistory()].slice(0, MAX)));
  } catch {
    // 저장 공간이 없거나 막혀 있어도 대시보드는 동작해야 한다
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 무시
  }
}
