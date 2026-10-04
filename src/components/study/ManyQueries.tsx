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
      <div className="font-semibold">같은 변화 뒤 경로 여러 개를 다시 찾을 때 ({name})</div>
      <p className="text-xs faint mt-0.5 mb-3">
        실제 내비게이션은 교통 정보가 바뀔 때마다 많은 사용자의 경로를 다시 찾습니다. 위에서 잰 중간값으로 계산한 값입니다: A* = K × 탐색, CCH =
        커스터마이징 1번 + K × 질의, LPA* = K × 다시 계획.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>방법</th>
              {COUNTS.map((k) => (
                <th key={k}>경로 {k.toLocaleString("ko-KR")}개</th>
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
      <p className="text-xs faint mt-2">굵은 글씨 = 그 개수에서 가장 적게 드는 방법.</p>
    </div>
  );
}
