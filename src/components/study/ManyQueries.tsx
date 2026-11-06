"use client";

import { formatMs } from "@/lib/format";
import { STUDY_ALGORITHM_BY_ID, type StudyAlgorithmId } from "@/lib/study/search";
import { TRAFFIC_SCENARIOS, type TrafficIndex, type TrafficScenarioId } from "@/lib/study/traffic";
import { ALGO_STYLE } from "./shared";

const COUNTS = [1, 10, 100, 1000];

/**
 * 같은 교통 변화 뒤 경로 K 개를 다시 찾아야 할 때의 총 계산 시간 (측정 중간값으로 계산).
 *  - A*: 경로마다 처음부터 → K × 탐색
 *  - CCH: 커스터마이징은 한 번만 하고 모든 경로가 함께 씀 → 커스터마이징 + K × 질의
 *  - LPA*: 경로마다 자기 기억을 고침 → K × 다시 계획
 */
export function manyQueryCost(traffic: TrafficIndex, scenario: TrafficScenarioId, algo: StudyAlgorithmId, k: number): number | null {
  const r = traffic.summary.find((x) => x.scenario === scenario && x.algorithm === algo);
  if (!r) return null;
  if (algo === "cch" && r.customizeMs !== null && r.queryMs !== null) return r.customizeMs + k * r.queryMs;
  return k * r.searchMs;
}

export default function ManyQueries({ traffic, scenario = "both" }: { traffic: TrafficIndex; scenario?: TrafficScenarioId }) {
  const name = TRAFFIC_SCENARIOS.find((s) => s.id === scenario)!.name;
  return (
    <div className="card">
      <div className="font-semibold">Recomputing many routes after the same change ({name})</div>
      <p className="text-xs faint mt-0.5 mb-3">
        A real navigation service must recompute many users&apos; routes whenever traffic data changes. These values are calculated from the medians measured
        above: A* = K × search, CCH = 1 customization + K × query, LPA* = K × replan.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Method</th>
              {COUNTS.map((k) => (
                <th key={k}>
                  {k.toLocaleString("en-US")} {k === 1 ? "route" : "routes"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {traffic.algorithms.map((a) => {
              const vals = COUNTS.map((k) => manyQueryCost(traffic, scenario, a, k));
              return (
                <tr key={a}>
                  <td>
                    <span className="swatch" style={{ background: ALGO_STYLE[a].color }} />
                    {STUDY_ALGORITHM_BY_ID[a].name}
                  </td>
                  {vals.map((v, i) => {
                    const best = Math.min(...traffic.algorithms.map((b) => manyQueryCost(traffic, scenario, b, COUNTS[i]) ?? Infinity));
                    return (
                      <td key={i} className={v !== null && v === best ? "font-bold" : undefined}>
                        {v === null ? "—" : formatMs(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs faint mt-2">Bold = the cheapest method for that number of routes.</p>
    </div>
  );
}
