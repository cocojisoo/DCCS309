import type { Metadata } from "next";
import { ALGORITHMS } from "@/lib/algorithms";
import { PENALTY_SEC, SPEED_KMH } from "@/lib/config";

export const metadata: Metadata = { title: "알고리즘 · Route Lab" };

export default function AlgorithmsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">알고리즘</h1>
        <p className="muted text-sm mt-1">대시보드에서 비교하는 5가지 최단경로 알고리즘과 비용 모델입니다.</p>
      </div>

      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>알고리즘</th>
                <th className="!text-left">시간 복잡도</th>
                <th>최적 경로 보장</th>
              </tr>
            </thead>
            <tbody>
              {ALGORITHMS.map((a) => (
                <tr key={a.id}>
                  <td>
                    <b>{a.name}</b> <span className="faint">{a.short}</span>
                  </td>
                  <td className="!text-left">{a.complexity}</td>
                  <td>{a.optimal ? <span className="badge badge-good">✓ 보장</span> : <span className="badge badge-bad">✗ 보장 안 함</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        {ALGORITHMS.map((a) => (
          <article key={a.id} className="card prose-ko">
            <h2>
              {a.name} <span className="faint text-sm font-normal">{a.short}</span>
            </h2>
            <p>{a.summary}</p>
          </article>
        ))}
      </section>

      <section className="card prose-ko">
        <h2>비용 모델</h2>
        <ul>
          <li>
            간선 비용 = 간선 길이 ÷ 속도 (자동차 {SPEED_KMH.car}km/h, 도보 {SPEED_KMH.walk}km/h). 속도가 고정이므로 보정이 없으면 최단 시간 경로
            = 최단 거리 경로입니다.
          </li>
          <li>
            <b>현실 보정</b>을 켜면 자동차는 교차로를 지날 때마다 +{PENALTY_SEC.intersection}초, 도보는 횡단보도를 한 번 건널 때마다 +
            {PENALTY_SEC.crossing}초를 더합니다. 교차로는 service 도로를 제외한 도로가 3방향 이상 만나는 노드와 신호등 노드입니다.
            횡단보도 페널티는 OSM 횡단보도 way(<code>footway=crossing</code>) 길이에 비례해 나눠 붙이므로, 한 번 끝까지 건너면 정확히{" "}
            {PENALTY_SEC.crossing}초가 됩니다.
          </li>
          <li>
            A*와 탐욕 탐색의 휴리스틱은 목적지까지의 직선(하버사인) 거리 ÷ 속도입니다. 실제 비용보다 크지 않으므로(admissible) A*는 최적
            경로를 보장합니다.
          </li>
          <li>
            벨만-포드는 모든 간선을 반복해서 완화하므로 &lsquo;탐색 노드&rsquo;는 도달한 모든 노드 수이고, 간선 완화 횟수가 가장 많습니다.
          </li>
        </ul>
      </section>

      <section className="card prose-ko">
        <h2>데이터와 한계</h2>
        <ul>
          <li>
            도로망은 OpenStreetMap에서 받아 <code>scripts/build-graph.mjs</code>로 만든 정적 그래프(<code>public/graph/*.json</code>)입니다.
          </li>
          <li>차도: 일방통행을 반영하고, 주차장 통로·진입로 등 service 세부 도로와 통행 금지 도로를 제외합니다.</li>
          <li>
            인도: 보도·횡단보도·보행로·계단과 이면도로(residential 등)를 포함하고, 간선도로(primary 이상) 중심선은 보도가 태깅된 경우에만
            포함합니다.
          </li>
          <li>
            도로 중심선을 걸을 때 교차로에서 길을 건너는 것은 횡단보도로 태깅되어 있지 않으면 페널티가 붙지 않습니다. 그래서 도보 경로가
            이면도로 중심선을 선호하는 경향이 있습니다.
          </li>
        </ul>
      </section>
    </div>
  );
}
