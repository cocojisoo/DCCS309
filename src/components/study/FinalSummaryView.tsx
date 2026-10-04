"use client";

import { useEffect, useState } from "react";
import { formatInt, formatMs } from "@/lib/format";
import { STUDY_ALGORITHMS, STUDY_ALGORITHM_BY_ID, type StudyAlgorithmId } from "@/lib/study/search";
import type { StudySummary } from "@/lib/study/summary";
import { TRAFFIC_SCENARIOS, type TrafficIndex } from "@/lib/study/traffic";
import ManyQueries from "./ManyQueries";
import { biggestLabel, normalQuality, pct } from "./metrics";
import { ALGO_STYLE, fetchJson, formatTravel } from "./shared";

/** 정상 상태 — 이론적인 성질과 입력이 커질 때의 장단점 */
const NORMAL: Record<StudyAlgorithmId, { shortest: string; fastest: string; plus: string; minus: string }> = {
  dfs: {
    shortest: "끝까지 돌면 보장",
    fastest: "끝까지 돌면 보장",
    plus: "원리가 단순하고 작은 지도에서는 오히려 가장 빠를 수 있음 (준비 작업 없음)",
    minus: "확인할 길의 수가 지수적으로 늘어 지도가 조금만 커져도 제한시간 안에 끝나지 못함 → 실제로는 답을 확인할 수 없음",
  },
  dijkstra: {
    shortest: "항상 보장",
    fastest: "보장 (비용을 이동시간으로 두면)",
    plus: "교차로마다 한 번씩만 확정해서 지도가 커져도 시간이 완만하게(거의 비례해서) 늘어남",
    minus: "도착점 방향을 몰라 반대쪽까지 같이 살펴봄 · 도로 상황이 바뀌면 처음부터 다시",
  },
  astar: {
    shortest: "보장 (힌트가 실제 거리를 넘지 않을 때)",
    fastest: "보장 (힌트 = 직선거리 ÷ 최고 속도)",
    plus: "다익스트라와 같은 답을 훨씬 적은 교차로만 보고 찾음",
    minus: "좌표가 필요 · 도로 상황이 바뀌면 처음부터 다시 · 매우 큰 지도에서는 여전히 많이 탐색",
  },
  cch: {
    shortest: "항상 보장",
    fastest: "보장 (커스터마이징한 비용 기준)",
    plus: "질의 때 보는 교차로가 매우 적어 큰 지도일수록 유리 · 비용이 바뀌어도 커스터마이징만 다시",
    minus: "지름길을 만드는 전처리 시간과 메모리가 필요 · 구현이 복잡",
  },
  lpa: {
    shortest: "항상 보장",
    fastest: "보장 (비용을 이동시간으로 두면)",
    plus: "같은 출발·도착을 다시 계산할 때 지난 결과를 재사용",
    minus: "처음 한 번은 A* 와 비슷하거나 조금 느림 · 교차로마다 기억할 값이 많아 메모리 사용이 큼",
  },
};

function Name({ id }: { id: StudyAlgorithmId }) {
  return (
    <span className="font-semibold whitespace-nowrap">
      <span className="swatch" style={{ background: ALGO_STYLE[id].color }} />
      {STUDY_ALGORITHM_BY_ID[id].name}
    </span>
  );
}

export default function FinalSummaryView() {
  const [summary, setSummary] = useState<StudySummary | null | undefined>(undefined);
  const [traffic, setTraffic] = useState<TrafficIndex | null>(null);

  useEffect(() => {
    fetchJson<StudySummary>("/study/summary.json").then(setSummary);
    fetchJson<TrafficIndex>("/study/traffic/index.json").then(setTraffic);
  }, []);

  if (summary === undefined) return <p className="muted text-sm">불러오는 중…</p>;
  if (!summary)
    return (
      <p className="card text-sm">
        실험 결과가 없습니다. <code>npm run study:run</code> 과 <code>npm run study:traffic</code> 을 먼저 실행하세요.
      </p>
    );

  const q = normalQuality(summary);
  const by = (id: StudyAlgorithmId) => q.find((x) => x.algo === id)!;
  const big = summary.ladder.find((l) => l.label === biggestLabel(summary))!;
  const dfs = by("dfs");
  const dij = by("dijkstra").biggest;
  const ast = by("astar").biggest;
  const cch = by("cch").biggest;
  const tr = (s: string, a: StudyAlgorithmId) => traffic?.summary.find((r) => r.scenario === s && r.algorithm === a);
  const both = (a: StudyAlgorithmId) => tr("both", a);

  return (
    <div className="flex flex-col gap-8">
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="DFS 가 처음 무너진 크기"
          value={dfs.firstTimeout.growing ? `교차로 ${formatInt(dfs.firstTimeout.growing.graph_nodes)}개` : "무너지지 않음"}
          note={`${summary.config.run.dfs_time_limit_s}초 안에 모든 길을 확인하지 못한 첫 크기`}
        />
        <Stat
          label={`${big.label}(교차로 ${formatInt(big.nodes)}) A* 방문`}
          value={dij && ast ? `다익스트라의 ${((ast.median_visits / dij.median_visits) * 100).toFixed(0)}%` : "—"}
          note={dij && ast ? `${formatInt(Math.round(ast.median_visits))} vs ${formatInt(Math.round(dij.median_visits))}곳` : undefined}
        />
        <Stat
          label={`${big.label} CCH 질의 방문`}
          value={cch ? `${formatInt(Math.round(cch.median_visits))}곳` : "—"}
          note={cch && dij ? `탐색 시간 ${formatMs(cch.median_ms)} (다익스트라 ${formatMs(dij.median_ms)})` : undefined}
        />
        <Stat
          label="혼잡+폐쇄 뒤 다시 찾기 (본 교차로)"
          value={both("lpa") && both("astar") ? `LPA* ${formatInt(both("lpa")!.visited)} · A* ${formatInt(both("astar")!.visited)}` : "—"}
          note={both("cch") ? `CCH 는 지름길 ${formatInt(both("cch")!.recomputedArcs ?? 0)}개만 다시 계산` : undefined}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">1. 도로가 정상일 때</h2>
        <p className="text-sm muted">
          정상 상태는 모든 도로를 같은 속도({summary.config.travel?.car_speed_kmh ?? 30}km/h)로 달린다고 보므로 &lsquo;가장 짧은 경로&rsquo; = &lsquo;가장
          짧은 이동시간&rsquo;입니다. 측정값은 크기 {summary.ladder.length}단계 × 여러 경로 × {summary.config.run.repeats}회 반복 실험에서 나왔습니다.
        </p>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>방법</th>
                  <th className="!text-left">최소 경로 보장</th>
                  <th className="!text-left">최소 이동시간 보장</th>
                  <th className="!text-left">측정: 끝까지 찾은 비율 · 정답 일치</th>
                  <th className="!text-left">측정: 가장 큰 지도</th>
                  <th className="!text-left">입력이 커지면 — 장점</th>
                  <th className="!text-left">입력이 커지면 — 단점</th>
                </tr>
              </thead>
              <tbody>
                {STUDY_ALGORITHMS.map(({ id }) => {
                  const r = by(id);
                  const t = NORMAL[id];
                  return (
                    <tr key={id}>
                      <td>
                        <Name id={id} />
                      </td>
                      <td className="!text-left !whitespace-normal">{t.shortest}</td>
                      <td className="!text-left !whitespace-normal">{t.fastest}</td>
                      <td className="!text-left !whitespace-normal">
                        {pct(r.success, r.runs)} · {r.success === 0 ? "—" : r.wrong === 0 ? "찾은 경로 모두 최단" : `${r.wrong}번 다름`}
                        {r.timeout > 0 && <div className="text-xs badge-bad">시간 초과 {formatInt(r.timeout)}번</div>}
                      </td>
                      <td className="!text-left !whitespace-normal">
                        {!r.biggest
                          ? "—"
                          : r.biggest.timeout === r.biggest.runs
                            ? `${summary.config.run.dfs_time_limit_s}초 안에 못 끝남`
                            : `${formatMs(r.biggest.median_ms)} · ${formatInt(Math.round(r.biggest.median_visits))}곳 · 이동 ${formatTravel(r.biggest.median_route_s)}`}
                      </td>
                      <td className="!text-left !whitespace-normal text-sm">{t.plus}</td>
                      <td className="!text-left !whitespace-normal text-sm">{t.minus}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs faint mt-3">
            CCH 의 탐색 시간은 질의만 잰 값이고, 지름길을 만드는 전처리는 {big.label} 지도에서{" "}
            {formatMs(summary.log.cch?.find((c) => c.sizeLabel === big.label)?.prepMs ?? NaN)} 걸렸습니다 (지도마다 한 번).
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">2. 혼잡 · 폐쇄가 생겼을 때 (A*, CCH, LPA*)</h2>
        <p className="text-sm muted">
          혼잡 · 폐쇄 상황에서는 비용을 <b>이동시간</b>으로 두고 가장 빨리 도착하는 경로를 찾습니다.
          {traffic && ` (${traffic.size.title} 지도, 경로 ${traffic.pairs.length}개의 중간값)`}
        </p>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>방법</th>
                  <th className="!text-left">최소 경로(거리) 보장</th>
                  <th className="!text-left">최소 이동시간 보장</th>
                  <th className="!text-left">상황이 바뀌면 하는 일</th>
                  {TRAFFIC_SCENARIOS.map((s) => (
                    <th key={s.id}>{s.name}: 계산 · 본 교차로</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["astar", "cch", "lpa"] as const).map((id) => (
                  <tr key={id}>
                    <td>
                      <Name id={id} />
                    </td>
                    <td className="!text-left !whitespace-normal">
                      아니요 — 더 빠르면 더 긴 길을 고름
                    </td>
                    <td className="!text-left !whitespace-normal">예 (주어진 교통 정보 기준)</td>
                    <td className="!text-left !whitespace-normal text-sm">
                      {id === "astar" ? "바뀐 비용으로 처음부터 다시 탐색" : id === "cch" ? "바뀐 도로에 닿는 지름길만 다시 계산 + 짧은 질의" : "지난 탐색을 재사용해 어긋난 곳만 다시 계산"}
                    </td>
                    {TRAFFIC_SCENARIOS.map((s) => {
                      const r = tr(s.id, id);
                      return (
                        <td key={s.id}>
                          {r ? (
                            <>
                              {formatMs(r.searchMs)} · {formatInt(r.visited)}곳
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {traffic && <TrafficFacts traffic={traffic} />}
        </div>
        {traffic && <ManyQueries traffic={traffic} />}

        <article className="card prose-ko">
          <h2>왜 혼잡 상황에서는 A* 가 CCH · LPA* 보다 불리한가</h2>
          <ul>
            <li>
              실제 내비게이션에는 혼잡 · 사고 · 폐쇄 같은 실시간 교통 정보가 몇 분마다 들어옵니다. 정보가 바뀔 때마다 모든 사용자의 경로를 다시
              탐색(재탐색)해야 하므로, <b>한 번 바뀔 때 드는 계산 비용</b>이 곧 전체 비용이 됩니다.
            </li>
            <li>
              A* 는 지난 계산을 기억하지 않아서 정보가 바뀔 때마다 모든 경로를 <b>처음부터</b> 다시 탐색합니다. 지도가 크고 사용자가 많을수록 이 비용이
              그대로 쌓입니다.
            </li>
            <li>
              CCH 는 지도 모양(전처리)과 도로 비용(커스터마이징)을 나눠 두었기 때문에, 바뀐 도로에 닿는 지름길만 다시 계산하면 됩니다. 이 작업은 한 번
              하면 모든 사용자의 질의가 함께 쓰고, 질의 자체는 아주 적은 교차로만 봅니다.
            </li>
            <li>
              LPA* 는 지난 탐색 결과를 기억해 두었다가 바뀐 도로 때문에 &lsquo;앞뒤가 맞지 않게 된&rsquo; 교차로만 고칩니다. 바뀐 곳이 작을수록 다시 보는
              교차로가 크게 줄어듭니다.
            </li>
            <li>
              이 실험의 지도는 교차로 수천 개 규모라 A* 의 재탐색도 수 ms 안에 끝납니다. 그래서 절대 시간 차이는 작고, 경우에 따라 A* 가 더 빠를 수도
              있습니다. 차이가 결정적이 되는 것은 전국 도로망(교차로 수천만 개) · 수많은 사용자 · 1분 단위 갱신이 겹칠 때이고, 그래서 재탐색 비용을 줄이는
              CCH · 증분 탐색 같은 방법이 고안되고 있습니다.
            </li>
          </ul>
        </article>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">3. 실제 산업의 한계와 발전 방향</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <article className="card prose-ko">
            <h2>① 지금의 교통 정보만으로는 도착 시간을 정확히 알기 어렵습니다</h2>
            <p>
              지금 한산한 도로도 <b>내가 20분 뒤 도착할 때는 막힐 수 있습니다.</b> 사고 · 폐쇄도 예측이 어렵습니다. 구글이 공개한 사례에서는 실시간 교통
              정보와 과거 패턴을 결합해 앞으로의 이동 시간을 예측합니다. 발전 방향은 <b>도로에 진입할 시점의 교통을 예측하는 것</b>입니다 (
              <a href="https://deepmind.google/discover/blog/traffic-prediction-with-advanced-graph-neural-networks/" target="_blank" rel="noreferrer">
                Google DeepMind 교통 예측
              </a>
              ).
            </p>
            <p>여기서 정확성은 두 가지입니다.</p>
            <ul>
              <li>
                <b>탐색 정확성:</b> 입력받은 이동 시간을 기준으로 최적 경로를 찾았는가?
              </li>
              <li>
                <b>예측 정확성:</b> 입력한 이동 시간이 실제 주행 시간과 얼마나 비슷한가?
              </li>
            </ul>
            <p>A* · CCH · LPA* 가 최적 경로를 정확히 찾아도, 교통 예측이 틀리면 실제로 가장 빠른 길은 달라질 수 있습니다.</p>
          </article>
          <article className="card prose-ko">
            <h2>② 교통 정보를 자주 반영하면서 계산 비용도 줄여야 합니다</h2>
            <p>
              혼잡 · 폐쇄가 바뀔 때마다 검색을 반복하고, 여러 사용자의 요청도 처리해야 합니다. 발전 방향은 <b>변경된 부분만 갱신하거나, 미리 준비한 도로
              구조를 여러 검색에서 활용하는 것</b>입니다. CCH 는 이런 요구에 대응하는 방법이며 (
              <a href="https://arxiv.org/abs/1402.0402" target="_blank" rel="noreferrer">
                Dibbelt · Strasser · Wagner, Customizable Contraction Hierarchies
              </a>
              ), 이후 연구에서도 갱신 · 검색 · 메모리 사용을 개선하고 있습니다.
            </p>
          </article>
          <article className="card prose-ko">
            <h2>③ 결과 품질과 응답 속도를 함께 높이기 어렵습니다</h2>
            <p>
              교통 상황을 더 자세히 고려하고 후보 경로를 더 많이 검토하면 계산 부담이 늘 수 있습니다. 실제로 Google Routes API 는{" "}
              <b>교통 반영 수준과 응답 지연 사이의 선택</b>을 제공합니다 (
              <a href="https://developers.google.com/maps/documentation/routes" target="_blank" rel="noreferrer">
                Google Routes API 문서
              </a>
              ). 산업에서도 사용 목적에 맞는 균형을 정하는 것이 문제입니다.
            </p>
          </article>
          <article className="card prose-ko">
            <h2>④ 실제 도로의 조건이 복잡합니다</h2>
            <p>
              회전 금지, 차로 이용 자격, 차량 종류 등을 반영해야 합니다. 구글은 다인승 차량 전용 차로의 이동 시간을 별도로 예측하는 기능을 공개하기도
              했습니다. 발전 방향은 <b>사용자가 실제로 이용할 수 있는 도로 조건까지 포함한 경로 계산</b>입니다. 이 프로젝트의 모델(같은 속도, 교차로 ·
              횡단보도 고정 페널티, 거리 기반 비용)은 이런 조건을 반영하지 않았다는 한계가 있습니다.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}

function TrafficFacts({ traffic }: { traffic: TrafficIndex }) {
  const rows = TRAFFIC_SCENARIOS.map((s) => ({ s, r: traffic.summary.find((x) => x.scenario === s.id && x.algorithm === traffic.algorithms[0])! }));
  return (
    <ul className="text-sm mt-3 flex flex-col gap-1">
      {rows.map(({ s, r }) => (
        <li key={s.id}>
          <b>{s.name}</b>: 정상 경로 {formatTravel(r.normalTimeS)} →{" "}
          {r.normalRouteBlocked === r.pairs ? "정상 경로는 막혀서 갈 수 없음" : `정상 경로를 그대로 가면 ${formatTravel(r.normalRouteNowS)}`}
          {r.normalRouteBlocked > 0 && r.normalRouteBlocked < r.pairs && ` (막힌 경로 ${r.normalRouteBlocked}개 제외)`} · 새로 찾은 경로{" "}
          {formatTravel(r.routeTimeS)}, 경로가 바뀐 경우 {r.routeChanged}/{r.pairs}
        </li>
      ))}
      <li className="faint text-xs">
        세 방법은 모두 이동시간이 가장 짧은 같은 경로를 찾았습니다 (최소 이동시간 보장). 대신 거리는 정상 상태보다 길어질 수 있어 최소 경로(거리)는
        보장하지 않습니다.
      </li>
    </ul>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card">
      <div className="text-xs muted">{label}</div>
      <div className="text-2xl font-bold mt-1 num">{value}</div>
      {note && <div className="text-xs faint mt-1">{note}</div>}
    </div>
  );
}
