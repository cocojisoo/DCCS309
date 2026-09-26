"use client";

import { formatInt, formatMs } from "@/lib/format";
import { STUDY_ALGORITHMS, type StudyAlgorithmId } from "@/lib/study/search";
import type { StudySummary, SummaryRow } from "@/lib/study/summary";
import { ALGO_STYLE } from "./shared";

type Cells = Record<StudyAlgorithmId, string>;

/** PROJECT_BLUEPRINT 1절 표 (예상) */
const EXPECTED: { label: string; cells: Cells }[] = [
  {
    label: "비유",
    cells: {
      dfs: "미로의 모든 갈림길을 하나씩 끝까지 다 가보기",
      dijkstra: "호수에 돌을 던진 것처럼 가까운 곳부터 동그랗게",
      astar: "도착점 쪽을 먼저 보면서 넓혀가기",
    },
  },
  {
    label: "정답 보장",
    cells: { dfs: "끝까지 다 돌면 보장", dijkstra: "항상 보장", astar: "힌트가 실제 거리보다 크지 않으면 보장" },
  },
  {
    label: "입력이 커지면",
    cells: { dfs: "확인할 길의 수가 폭발적으로 (지수적)", dijkstra: "O((V+E) log V)", astar: "최악은 다익스트라와 같지만 보통 더 적게" },
  },
  {
    label: "필요한 것",
    cells: { dfs: "도로 연결 정보", dijkstra: "도로 연결 정보", astar: "도로 연결 정보 + 교차로 좌표" },
  },
];

export default function TradeoffView({ summary }: { summary: StudySummary }) {
  const rowsOf = (track: 1 | 2, algo: StudyAlgorithmId) => summary.rows.filter((r) => r.track === track && r.algorithm === algo);
  const bySize = (a: SummaryRow, b: SummaryRow) => a.graph_nodes - b.graph_nodes;
  const firstTimeout = (track: 1 | 2, algo: StudyAlgorithmId) => rowsOf(track, algo).filter((r) => r.timeout > 0).sort(bySize)[0];
  const largestSolved = (track: 1 | 2, algo: StudyAlgorithmId) =>
    rowsOf(track, algo).filter((r) => r.success === r.runs).sort(bySize).at(-1);
  const biggest = summary.ladder.reduce((a, b) => (b.nodes > a.nodes ? b : a));
  const at = (track: 1 | 2, algo: StudyAlgorithmId, label: string) => rowsOf(track, algo).find((r) => r.size_label === label);
  const sizeText = (r?: SummaryRow) => (r ? `교차로 ${formatInt(r.graph_nodes)}개 (${r.size_label})` : "없음");

  const dij = at(2, "dijkstra", biggest.label);
  const ast = at(2, "astar", biggest.label);
  const astarShare = dij && ast ? ast.median_visits / dij.median_visits : null;
  const dfsFail1 = firstTimeout(1, "dfs");
  const dfsFail2 = firstTimeout(2, "dfs");
  const dfsSolved = largestSolved(2, "dfs");

  const measured: { label: string; cells: Cells }[] = [
    {
      label: "끝까지 푼 가장 큰 지도 (트랙 2)",
      cells: Object.fromEntries(STUDY_ALGORITHMS.map((a) => [a.id, sizeText(largestSolved(2, a.id))])) as Cells,
    },
    {
      label: "처음 시간 초과가 난 크기 (트랙 1 / 트랙 2)",
      cells: Object.fromEntries(
        STUDY_ALGORITHMS.map((a) => {
          const t1 = firstTimeout(1, a.id);
          const t2 = firstTimeout(2, a.id);
          return [a.id, !t1 && !t2 ? "없음" : `${t1 ? formatInt(t1.graph_nodes) : "없음"} / ${t2 ? formatInt(t2.graph_nodes) : "없음"}`];
        }),
      ) as Cells,
    },
    {
      label: `가장 큰 지도(${biggest.label}, 교차로 ${formatInt(biggest.nodes)}) 걸린 시간 중간값`,
      cells: Object.fromEntries(
        STUDY_ALGORITHMS.map((a) => {
          const r = at(2, a.id, biggest.label);
          return [a.id, !r ? "—" : r.timeout === r.runs ? `${summary.config.run.dfs_time_limit_s}초 안에 못 끝남` : formatMs(r.median_ms)];
        }),
      ) as Cells,
    },
    {
      label: "가장 큰 지도 방문 횟수 중간값",
      cells: Object.fromEntries(
        STUDY_ALGORITHMS.map((a) => {
          const r = at(2, a.id, biggest.label);
          if (!r) return [a.id, "—"];
          const base = `${formatInt(Math.round(r.median_visits))}번${r.timeout ? " (중단 시점)" : ""}`;
          return [a.id, a.id === "astar" && astarShare !== null ? `${base} · 다익스트라의 ${(astarShare * 100).toFixed(0)}%` : base];
        }),
      ) as Cells,
    },
    {
      label: "방문 ÷ 서로 다른 교차로 (DFS 가 끝까지 푼 가장 큰 지도)",
      cells: Object.fromEntries(
        STUDY_ALGORITHMS.map((a) => {
          const r = dfsSolved ? at(2, a.id, dfsSolved.size_label) : undefined;
          return [a.id, r ? `${r.median_visit_ratio.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}배` : "—"];
        }),
      ) as Cells,
    },
  ];

  const mismatches = summary.log.mismatches.length;
  return (
    <div className="flex flex-col gap-4">
      <section className="grid sm:grid-cols-3 gap-3">
        <Stat label="DFS 가 처음 무너진 크기 (트랙 2)" value={dfsFail2 ? `교차로 ${formatInt(dfsFail2.graph_nodes)}개` : "무너지지 않음"} note={dfsFail1 ? `트랙 1: 교차로 ${formatInt(dfsFail1.graph_nodes)}개` : undefined} />
        <Stat
          label={`${biggest.label}에서 A* 방문 수`}
          value={astarShare === null ? "—" : `다익스트라의 ${(astarShare * 100).toFixed(0)}%`}
          note={dij && ast ? `${formatInt(Math.round(ast.median_visits))} vs ${formatInt(Math.round(dij.median_visits))}번 (트랙 2 중간값)` : undefined}
        />
        <Stat
          label="성공한 방법끼리 길이 불일치"
          value={`${mismatches}건`}
          note={mismatches ? "속도 비교를 발표하기 전에 원인을 찾아야 함 (7.6)" : "모든 반복에서 0.01m 이내로 일치"}
          bad={mismatches > 0}
        />
      </section>

      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th></th>
                {STUDY_ALGORITHMS.map((a) => (
                  <th key={a.id} className="!text-left">
                    <span className="swatch" style={{ background: ALGO_STYLE[a.id].color }} />
                    {a.name} <span className="faint font-normal">({a.role})</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EXPECTED.map((row) => (
                <tr key={row.label}>
                  <td className="muted">{row.label}</td>
                  {STUDY_ALGORITHMS.map((a) => (
                    <td key={a.id} className="!text-left !whitespace-normal">
                      {row.cells[a.id]}
                    </td>
                  ))}
                </tr>
              ))}
              {measured.map((row) => (
                <tr key={row.label}>
                  <td className="!whitespace-normal">
                    <span className="badge mr-1">측정</span>
                    {row.label}
                  </td>
                  {STUDY_ALGORITHMS.map((a) => (
                    <td key={a.id} className="!text-left !whitespace-normal font-semibold">
                      {row.cells[a.id]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs faint mt-3">
          위 네 줄은 설계 단계의 예상, &lsquo;측정&rsquo; 줄은 {new Date(summary.finishedAt).toLocaleString("ko-KR")}에 끝난 실험의{" "}
          <code>summary.csv</code> 에서 자동으로 채운 값입니다. 실행 환경: Node {summary.environment.node} ({summary.environment.platform}).
        </p>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <article className="card prose-ko">
          <h2>실제 서비스는?</h2>
          <p>
            공개 길찾기 엔진 OSRM 은 지도를 미리 계산해 두는 방식(CH, MLD)을, Valhalla 는 양쪽에서 동시에 찾는 A* 를 쓴다고 문서에 적혀 있습니다.
            이 실험은 그 기초가 되는 방법들을 비교한 것이며, 상용 앱과 속도를 비교한 것은 아닙니다.
          </p>
        </article>
        <article className="card prose-ko">
          <h2>한계</h2>
          <ul>
            <li>거리만 비교했습니다 (신호, 정체, 제한속도 없음).</li>
            <li>한 지역(조치원), 한 시점({summary.graph.osmTimestamp?.slice(0, 10) ?? "알 수 없음"})의 OSM 지도입니다.</li>
            <li>JavaScript(Node) 구현이라 절대 속도는 실제 서비스와 다르고, 측정 중 GC 를 완전히 끌 수 없어 측정 직전마다 수집만 해 둡니다.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}

function Stat({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs muted">{label}</div>
      <div className="text-2xl font-bold mt-1 num" style={bad ? { color: "var(--bad)" } : undefined}>
        {value}
      </div>
      {note && <div className="text-xs faint mt-1">{note}</div>}
    </div>
  );
}
