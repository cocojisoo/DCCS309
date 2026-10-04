import { STUDY_ALGORITHMS, type StudyAlgorithmId } from "@/lib/study/search";
import type { StudySummary, SummaryRow } from "@/lib/study/summary";

/** 정상 상태 실험에서 방법마다 뽑은 핵심 숫자 */
export interface NormalQuality {
  algo: StudyAlgorithmId;
  runs: number;
  success: number;
  timeout: number;
  /** 성공했지만 다른 방법(다익스트라)과 길이가 다른 실행 수 */
  wrong: number;
  /** 끝까지 푼 가장 큰 지도 (먼 경로 실험) */
  largestSolved?: SummaryRow;
  /** 처음 시간 초과가 난 크기 (같은 경로 / 먼 경로) */
  firstTimeout: { fixed?: SummaryRow; growing?: SummaryRow };
  /** 가장 큰 지도(먼 경로) 결과 */
  biggest?: SummaryRow;
}

export function biggestLabel(summary: StudySummary): string {
  return summary.ladder.reduce((a, b) => (b.nodes > a.nodes ? b : a)).label;
}

export function normalQuality(summary: StudySummary): NormalQuality[] {
  const big = biggestLabel(summary);
  const bySize = (a: SummaryRow, b: SummaryRow) => a.graph_nodes - b.graph_nodes;
  return STUDY_ALGORITHMS.map(({ id }) => {
    const rows = summary.rows.filter((r) => r.algorithm === id);
    const wrong = summary.log.mismatches.filter((m) => {
      const mine = m.lengths[id];
      const ref = m.lengths.dijkstra ?? Math.min(...Object.values(m.lengths));
      return mine !== undefined && Math.abs(mine - ref) > 0.01;
    }).length;
    return {
      algo: id,
      runs: rows.reduce((s, r) => s + r.runs, 0),
      success: rows.reduce((s, r) => s + r.success, 0),
      timeout: rows.reduce((s, r) => s + r.timeout, 0),
      wrong,
      largestSolved: rows.filter((r) => r.track === 2 && r.success === r.runs).sort(bySize).at(-1),
      firstTimeout: {
        fixed: rows.filter((r) => r.track === 1 && r.timeout > 0).sort(bySize)[0],
        growing: rows.filter((r) => r.track === 2 && r.timeout > 0).sort(bySize)[0],
      },
      biggest: rows.find((r) => r.track === 2 && r.size_label === big),
    };
  });
}

export const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(a === b ? 0 : 1)}%` : "—");
