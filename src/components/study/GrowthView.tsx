"use client";

import { useState } from "react";
import { formatDistance, formatInt, formatMs } from "@/lib/format";
import { STUDY_ALGORITHMS } from "@/lib/study/search";
import type { StudySummary, SummaryRow } from "@/lib/study/summary";
import LogChart, { type LogSeries } from "./LogChart";
import { ALGO_STYLE, formatTravel } from "./shared";

const DASH: Record<string, string | undefined> = { dfs: "7 5", dijkstra: undefined, astar: "2 4", cch: "10 3 2 3", lpa: "4 2" };

export default function GrowthView({ summary }: { summary: StudySummary }) {
  const [track, setTrack] = useState<1 | 2>(2);
  const rows = summary.rows.filter((r) => r.track === track);
  const title = (label: string) => summary.ladder.find((l) => l.label === label);

  const seriesOf = (pick: (r: SummaryRow) => number, fmt: (v: number) => string): LogSeries[] =>
    STUDY_ALGORITHMS.map((a) => ({
      id: a.id,
      label: a.name,
      color: ALGO_STYLE[a.id].color,
      dash: DASH[a.id],
      points: rows
        .filter((r) => r.algorithm === a.id)
        .map((r) => ({
          x: r.graph_nodes,
          y: pick(r),
          cross: r.timeout > 0,
          label: `${r.size_label} (교차로 ${formatInt(r.graph_nodes)}) · ${fmt(pick(r))}${r.timeout ? ` · 시간 초과 ${r.timeout}/${r.runs}번` : ""}`,
        })),
    }));

  const limitMs = summary.config.run.dfs_time_limit_s * 1000;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabs" role="tablist" aria-label="트랙">
          <button role="tab" className="tab" aria-selected={track === 1} onClick={() => setTrack(1)}>
            같은 경로 · 지도만 키우기
          </button>
          <button role="tab" className="tab" aria-selected={track === 2} onClick={() => setTrack(2)}>
            먼 경로 · 거리도 함께 키우기
          </button>
        </div>
        <span className="text-xs faint">
          {track === 1
            ? `가장 작은 조각에서 고른 쌍 ${summary.pairs.track1.length}개를 모든 크기에서 똑같이 사용`
            : `크기마다 가장 먼 두 교차로 거리의 ${summary.config.track_growing_od.straight_distance_ratio.map((r) => r * 100).join("~")}% 떨어진 쌍 최대 ${summary.config.track_growing_od.pairs_max}개`}
        </span>
      </div>

      {summary.heuristic.violations > 0 && (
        <p className="card text-sm" style={{ borderColor: "var(--bad)" }}>
          A* 힌트가 어긋나는 도로가 {summary.heuristic.violations}개 있어, A* 결과는 공식 비교에 쓰지 않습니다 (설계도 8.4).
        </p>
      )}

      <LogChart
        title="지도 크기에 따른 탐색 시간"
        subtitle={`경로마다 ${summary.config.run.repeats}회 반복의 중간값 → 경로들의 중간값 · 가로·세로 모두 로그 눈금 · CCH 는 질의만 (전처리는 아래 표)`}
        xLabel="실제 교차로 수"
        yLabel="탐색 시간 (ms)"
        series={seriesOf((r) => r.median_ms, formatMs)}
        formatY={(v) => (v >= 1 ? `${v.toLocaleString("ko-KR")}ms` : `${v}ms`)}
        refLine={{ y: limitMs, label: `DFS 제한시간 ${summary.config.run.dfs_time_limit_s}초` }}
      />
      <LogChart
        title="지도 크기에 따른 방문 횟수"
        subtitle="교차로에 들어간 총 횟수 (같은 곳을 다시 들어가면 또 셈) · 쌍들의 중간값"
        xLabel="실제 교차로 수"
        yLabel="방문 횟수"
        series={seriesOf((r) => r.median_visits, formatInt)}
        formatY={(v) => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}K` : String(v))}
      />

      <details className="card">
        <summary className="cursor-pointer font-semibold">표로 보기 (summary.csv 와 같은 값)</summary>
        <div className="table-wrap mt-3">
          <table className="data">
            <thead>
              <tr>
                <th>크기</th>
                <th>교차로</th>
                <th>방법</th>
                <th>쌍</th>
                <th>성공 / 초과</th>
                <th>시간 중간값</th>
                <th>범위</th>
                <th>방문 중간값</th>
                <th>방문 ÷ 고유</th>
                <th>길이 중간값</th>
                <th>이동 시간</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.size_label}-${r.algorithm}`}>
                  <td>{r.algorithm === "dfs" ? title(r.size_label)?.label : ""}</td>
                  <td>{r.algorithm === "dfs" ? formatInt(r.graph_nodes) : ""}</td>
                  <td>
                    <span className="swatch" style={{ background: ALGO_STYLE[r.algorithm].color }} />
                    {STUDY_ALGORITHMS.find((a) => a.id === r.algorithm)!.name}
                  </td>
                  <td>{r.od_count}</td>
                  <td>
                    {r.success} / <span className={r.timeout ? "badge-bad" : ""}>{r.timeout}</span>
                  </td>
                  <td>{formatMs(r.median_ms)}</td>
                  <td className="faint">
                    {formatMs(r.min_ms)} ~ {formatMs(r.max_ms)}
                  </td>
                  <td>{formatInt(Math.round(r.median_visits))}</td>
                  <td>{r.median_visit_ratio.toFixed(r.median_visit_ratio >= 100 ? 0 : 2)}</td>
                  <td>{r.median_route_m === null ? "—" : formatDistance(r.median_route_m)}</td>
                  <td>{formatTravel(r.median_route_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {summary.log.cch?.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">CCH 를 쓰기 전에 한 번 드는 시간 (크기별)</summary>
          <p className="text-xs faint mt-2">
            전처리는 도로 모양만 보고 지름길을 만드는 일(지도가 바뀔 때만), 커스터마이징은 지름길에 비용을 채우는 일(비용이 바뀔 때마다)입니다.
            위 그래프의 CCH 탐색 시간에는 질의만 들어 있습니다.
          </p>
          <div className="table-wrap mt-2">
            <table className="data">
              <thead>
                <tr>
                  <th>크기</th>
                  <th>교차로</th>
                  <th>지름길</th>
                  <th>전처리</th>
                  <th>커스터마이징</th>
                </tr>
              </thead>
              <tbody>
                {summary.log.cch.map((c) => (
                  <tr key={c.sizeLabel}>
                    <td>{c.sizeLabel}</td>
                    <td>{formatInt(c.nodes)}</td>
                    <td>{formatInt(c.shortcuts)}</td>
                    <td>{formatMs(c.prepMs)}</td>
                    <td>{formatMs(c.customizeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
