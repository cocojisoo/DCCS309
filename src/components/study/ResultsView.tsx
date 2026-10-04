"use client";

import { formatDistance, formatInt, formatMs } from "@/lib/format";
import { STUDY_ALGORITHM_BY_ID, type StudyAlgorithmId } from "@/lib/study/search";
import type { StudySummary } from "@/lib/study/summary";
import { TRAFFIC_SCENARIOS, type TrafficIndex } from "@/lib/study/traffic";
import GroupedBarChart from "../GroupedBarChart";
import GrowthView from "./GrowthView";
import ManyQueries from "./ManyQueries";
import { biggestLabel, normalQuality, pct } from "./metrics";
import { ALGO_STYLE, formatTravel } from "./shared";

/** 지금까지 한 모든 실험의 결과: 정상 상태(크기별) + 혼잡 · 폐쇄 */
export default function ResultsView({ summary, traffic }: { summary: StudySummary; traffic: TrafficIndex | null }) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">① 정상 상태: 가장 짧은 경로와 가장 짧은 이동시간을 찾았나</h2>
        <NormalTable summary={summary} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">② 정상 상태: 지도가 커지면 탐색 시간과 방문 횟수는</h2>
        <GrowthView summary={summary} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">③ 혼잡 · 폐쇄: 탐색 시간과 경로는 어떻게 바뀌나</h2>
        {traffic ? (
          <TrafficResults traffic={traffic} />
        ) : (
          <p className="card text-sm">
            혼잡 · 폐쇄 실험 결과가 없습니다. <code>npm run study:traffic</code> 을 실행하세요.
          </p>
        )}
      </section>
    </div>
  );
}

function Name({ id }: { id: StudyAlgorithmId }) {
  return (
    <>
      <span className="swatch" style={{ background: ALGO_STYLE[id].color }} />
      {STUDY_ALGORITHM_BY_ID[id].name}
    </>
  );
}

function NormalTable({ summary }: { summary: StudySummary }) {
  const q = normalQuality(summary);
  const big = summary.ladder.find((l) => l.label === biggestLabel(summary))!;
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>방법</th>
              <th>끝까지 찾은 실행</th>
              <th>최단 거리 경로</th>
              <th>최소 이동시간</th>
              <th>끝까지 푼 가장 큰 지도</th>
              <th>
                가장 큰 지도({big.label}) 탐색 시간
              </th>
              <th>그때 이동 시간</th>
            </tr>
          </thead>
          <tbody>
            {q.map((r) => {
              const allRight = r.wrong === 0;
              return (
                <tr key={r.algo}>
                  <td>
                    <Name id={r.algo} />
                  </td>
                  <td>
                    {formatInt(r.success)} / {formatInt(r.runs)} <span className="faint">({pct(r.success, r.runs)})</span>
                  </td>
                  <td>
                    {r.success === 0 ? "—" : allRight ? <span className="badge badge-good">찾은 것은 모두 최단</span> : <span className="badge badge-bad">{r.wrong}번 다름</span>}
                    {r.timeout > 0 && <div className="text-xs badge-bad">시간 초과 {formatInt(r.timeout)}번은 확인 못 함</div>}
                  </td>
                  <td>
                    {r.success === 0 ? "—" : allRight ? <span className="badge badge-good">찾은 것은 모두 최소</span> : <span className="badge badge-bad">{r.wrong}번 다름</span>}
                  </td>
                  <td>{r.largestSolved ? `교차로 ${formatInt(r.largestSolved.graph_nodes)}개` : "없음"}</td>
                  <td>
                    {!r.biggest ? "—" : r.biggest.timeout === r.biggest.runs ? <span className="badge-bad">{summary.config.run.dfs_time_limit_s}초 안에 못 끝남</span> : formatMs(r.biggest.median_ms)}
                  </td>
                  <td>{formatTravel(r.biggest?.median_route_s)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs faint mt-3">
        정상 상태는 모든 도로를 같은 속도({summary.config.travel?.car_speed_kmh ?? 30}km/h)로 달린다고 보므로 가장 짧은 경로가 곧 가장 빠른 경로입니다.
        &lsquo;최단&rsquo;은 같은 출발·도착에서 다른 방법(다익스트라)과 길이가 0.01m 안으로 같다는 뜻입니다. 모든 실행: 크기{" "}
        {summary.ladder.length}단계 × 경로 × {summary.config.run.repeats}회 반복.
      </p>
    </div>
  );
}

function TrafficResults({ traffic }: { traffic: TrafficIndex }) {
  const algos = traffic.algorithms;
  const scen = TRAFFIC_SCENARIOS;
  const get = (s: string, a: StudyAlgorithmId) => traffic.summary.find((r) => r.scenario === s && r.algorithm === a)!;
  const series = scen.map((s, i) => ({ key: s.id, label: s.name, color: ["var(--jam)", "var(--closed)", "var(--text-2)"][i] }));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm muted">
        {traffic.size.title} 지도(교차로 {formatInt(traffic.size.nodes)}개), 경로 {traffic.pairs.length}개의 중간값입니다. 계산 시간은 상황이 바뀐 뒤 새
        경로를 내놓기까지 걸린 시간입니다 (A*: 처음부터 다시, CCH: 바뀐 지름길만 + 질의, LPA*: 바뀐 곳 근처만).
      </p>
      <div className="grid md:grid-cols-2 gap-3">
        <GroupedBarChart
          title="상황이 바뀐 뒤 계산 시간"
          subtitle="5회 측정 중간값 → 경로들의 중간값"
          series={series}
          rows={algos.map((a) => ({ label: STUDY_ALGORITHM_BY_ID[a].name, values: Object.fromEntries(scen.map((s) => [s.id, get(s.id, a).searchMs])) }))}
          format={formatMs}
        />
        <GroupedBarChart
          title="다시 찾으면서 본 교차로"
          subtitle="적을수록 지난 계산을 많이 재사용한 것"
          series={series}
          rows={algos.map((a) => ({ label: STUDY_ALGORITHM_BY_ID[a].name, values: Object.fromEntries(scen.map((s) => [s.id, get(s.id, a).visited])) }))}
          format={formatInt}
        />
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>상황</th>
                <th>방법</th>
                <th>성공</th>
                <th>정상 경로 · 이동시간</th>
                <th>새 경로 · 이동시간</th>
                <th>정상 경로를 그대로 가면</th>
                <th>경로가 바뀐 경우</th>
                <th>계산 시간</th>
                <th>본 교차로</th>
              </tr>
            </thead>
            <tbody>
              {scen.flatMap((s) =>
                algos.map((a, i) => {
                  const r = get(s.id, a);
                  return (
                    <tr key={`${s.id}-${a}`}>
                      <td>{i === 0 ? s.name : ""}</td>
                      <td>
                        <Name id={a} />
                      </td>
                      <td>
                        {r.success} / {r.pairs}
                      </td>
                      <td>
                        {formatDistance(r.normalLengthM)} · {formatTravel(r.normalTimeS)}
                      </td>
                      <td>
                        {formatDistance(r.routeLengthM ?? NaN)} · {formatTravel(r.routeTimeS)}
                      </td>
                      <td>
                        {r.normalRouteNowS === null ? "—" : formatTravel(r.normalRouteNowS)}
                        {r.normalRouteBlocked > 0 && <span className="badge-bad text-xs"> 막힘 {r.normalRouteBlocked}개</span>}
                      </td>
                      <td>
                        {r.routeChanged} / {r.pairs}
                      </td>
                      <td>
                        {formatMs(r.searchMs)}
                        {a === "cch" && r.customizeMs !== null && (
                          <div className="text-xs faint">
                            지름길 {formatInt(r.recomputedArcs ?? 0)}개 {formatMs(r.customizeMs)} + 질의 {formatMs(r.queryMs ?? NaN)}
                          </div>
                        )}
                      </td>
                      <td>{formatInt(r.visited)}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs faint mt-3">
          거리 · 이동시간 · &lsquo;그대로 가면&rsquo;은 경로들의 중간값이고, 폐쇄로 정상 경로를 갈 수 없는 경로는 &lsquo;그대로 가면&rsquo; 중간값에서
          뺐습니다. 세 방법 모두 이동시간이 가장 짧은 경로를 찾으므로 경로 관련 값은 같고, 차이는 계산 시간과 본 교차로 수에 있습니다.
        </p>
      </div>
      <ManyQueries traffic={traffic} />
    </div>
  );
}
