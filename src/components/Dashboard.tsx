"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ALGORITHMS, ALGORITHM_BY_ID, type AlgorithmId } from "@/lib/algorithms";
import { edgesToLatLngs, runBenchmark, TIMING_RUNS, type BenchmarkResult, type ModeRun } from "@/lib/benchmark";
import { END, MODE_LABEL, PENALTY_SEC, SPEED_KMH, START, type Mode } from "@/lib/config";
import { formatDistance, formatDuration, formatInt, formatMs } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import { appendHistory } from "@/lib/history";
import GroupedBarChart, { type BarSeries } from "./GroupedBarChart";
import type { ExploredLayer, PathLayer } from "./RouteMap";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="map-box grid place-items-center muted">지도 불러오는 중…</div>,
});

const MODES: Mode[] = ["car", "walk"];
const MODE_COLOR: Record<Mode, string> = { car: "var(--car)", walk: "var(--walk)" };
const SERIES: BarSeries[] = MODES.map((m) => ({ key: m, label: MODE_LABEL[m], color: MODE_COLOR[m] }));

function exploredSegments(run: ModeRun, algo: AlgorithmId): [LatLng, LatLng][] {
  const r = run.runs.find((x) => x.algorithm === algo)!;
  const g = run.graph;
  return r.explored.map((e) => [
    [g.lat[g.from[e]], g.lng[g.from[e]]],
    [g.lat[g.to[e]], g.lng[g.to[e]]],
  ]);
}

export default function Dashboard() {
  const [penalties, setPenalties] = useState(true);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [algo, setAlgo] = useState<AlgorithmId>("dijkstra");
  const [visible, setVisible] = useState<Record<Mode, boolean>>({ car: true, walk: true });
  const [replay, setReplay] = useState(0);

  async function start() {
    setStatus("running");
    setError("");
    try {
      const r = await runBenchmark(penalties, setProgress);
      setResult(r);
      setStatus("done");
      appendHistory(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  const mapLayers = useMemo(() => {
    if (!result) return { explored: [] as ExploredLayer[], paths: [] as PathLayer[] };
    const explored: ExploredLayer[] = [];
    const paths: PathLayer[] = [];
    for (const mode of MODES) {
      if (!visible[mode]) continue;
      const run = result.modes[mode];
      const r = run.runs.find((x) => x.algorithm === algo)!;
      explored.push({ color: MODE_COLOR[mode], segments: exploredSegments(run, algo) });
      paths.push({
        color: MODE_COLOR[mode],
        points: edgesToLatLngs(run.graph, r.pathEdges),
        label: `${MODE_LABEL[mode]} · ${ALGORITHM_BY_ID[algo].name} · ${formatDuration(r.costSec)}`,
        dash: mode === "walk" ? "10 7" : undefined,
      });
    }
    return { explored, paths };
  }, [result, algo, visible]);

  const runsFor = (mode: Mode) => result!.modes[mode].runs;
  const chartRows = (pick: (r: ModeRun["runs"][number]) => number) =>
    ALGORITHMS.map((a) => ({
      label: a.name,
      values: Object.fromEntries(MODES.map((m) => [m, pick(runsFor(m).find((r) => r.algorithm === a.id)!)])),
    }));

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {START.name} → {END.name}
          </h1>
          <p className="muted text-sm mt-1">
            자동차 {SPEED_KMH.car}km/h · 도보 {SPEED_KMH.walk}km/h 고정 속도로 5가지 최단경로 알고리즘을 차도와 인도에서 각각 실행합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={penalties} onChange={(e) => setPenalties(e.target.checked)} className="w-4 h-4" />
            현실 보정 (교차로 +{PENALTY_SEC.intersection}초 · 횡단보도 +{PENALTY_SEC.crossing}초)
          </label>
          <button className="btn btn-primary" onClick={start} disabled={status === "running"}>
            {status === "running" ? "실행 중…" : result ? "다시 실행" : "▶ 시작"}
          </button>
        </div>
      </section>

      {status === "running" && <div className="text-sm muted">{progress}</div>}
      {status === "error" && (
        <div className="card text-sm" style={{ borderColor: "var(--bad)" }}>
          실행 실패: {error}
        </div>
      )}

      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="tabs" role="tablist" aria-label="지도에 표시할 알고리즘">
            {ALGORITHMS.map((a) => (
              <button key={a.id} role="tab" className="tab" aria-selected={algo === a.id} onClick={() => setAlgo(a.id)}>
                {a.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {MODES.map((m) => (
              <label key={m} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={visible[m]} onChange={(e) => setVisible({ ...visible, [m]: e.target.checked })} />
                <span className="swatch" style={{ background: MODE_COLOR[m] }} />
                {MODE_LABEL[m]}
                {m === "walk" && <span className="faint text-xs">(점선)</span>}
              </label>
            ))}
            <button className="btn text-sm !py-1" onClick={() => setReplay((x) => x + 1)} disabled={!result}>
              ↻ 탐색 다시 보기
            </button>
          </div>
        </div>
        <RouteMap
          explored={mapLayers.explored}
          paths={mapLayers.paths}
          animationKey={result ? `${result.startedAt}|${algo}|${visible.car}|${visible.walk}|${replay}` : "empty"}
        />
        <p className="text-xs faint">
          {result
            ? `옅은 선은 ${ALGORITHM_BY_ID[algo].name}이(가) 탐색한 간선, 굵은 선은 찾은 경로입니다. ${ALGORITHM_BY_ID[algo].summary}`
            : "▶ 시작을 누르면 모든 알고리즘을 차도·인도에서 실행하고, 선택한 알고리즘의 탐색 과정을 지도에 재생합니다."}
        </p>
      </section>

      {result && (
        <>
          <section className="grid md:grid-cols-3 gap-3">
            <GroupedBarChart
              title="소요 시간"
              subtitle="최적 알고리즘은 모두 같은 값, 탐욕 탐색만 더 오래 걸림"
              series={SERIES}
              rows={chartRows((r) => r.costSec)}
              format={formatDuration}
            />
            <GroupedBarChart
              title="탐색한 노드 수"
              subtitle="적을수록 효율적 · 벨만-포드는 도달한 모든 노드"
              series={SERIES}
              rows={chartRows((r) => r.visited)}
              format={formatInt}
            />
            <GroupedBarChart
              title="실행 시간"
              subtitle={`1회 평균, ${TIMING_RUNS}번 측정한 중앙값 · 브라우저 성능에 따라 다름`}
              series={SERIES}
              rows={chartRows((r) => r.runtimeMs)}
              format={formatMs}
            />
          </section>

          <section className="card">
            <h2 className="font-semibold mb-3">상세 통계</h2>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>알고리즘</th>
                    <th>수단</th>
                    <th>경로 거리</th>
                    <th>소요 시간</th>
                    <th>보정 시간 (횟수)</th>
                    <th>탐색 노드</th>
                    <th>간선 완화</th>
                    <th>실행 시간</th>
                    <th>최적 경로</th>
                  </tr>
                </thead>
                <tbody>
                  {ALGORITHMS.flatMap((a) =>
                    MODES.map((m) => {
                      const r = runsFor(m).find((x) => x.algorithm === a.id)!;
                      return (
                        <tr key={`${a.id}-${m}`}>
                          <td>{m === "car" ? a.name : ""}</td>
                          <td>
                            <span className="swatch" style={{ background: MODE_COLOR[m] }} />
                            {m === "car" ? "자동차" : "도보"}
                          </td>
                          <td>{formatDistance(r.distanceM)}</td>
                          <td>{formatDuration(r.costSec)}</td>
                          <td>{result.penalties ? `${formatDuration(r.penaltySec)} (${r.penaltyCount})` : "—"}</td>
                          <td>{formatInt(r.visited)}</td>
                          <td>
                            {formatInt(r.relaxations)}
                            {r.rounds ? <span className="faint"> · {r.rounds}회 반복</span> : null}
                          </td>
                          <td>{formatMs(r.runtimeMs)}</td>
                          <td>
                            {r.optimal ? <span className="badge badge-good">✓ 최적</span> : <span className="badge badge-bad">✗ 비최적</span>}
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs faint mt-3">
              출발·도착 좌표는 가장 가까운 그래프 노드로 맞춥니다 (차도: 출발 {result.modes.car.snapStartM.toFixed(0)}m / 도착{" "}
              {result.modes.car.snapEndM.toFixed(0)}m, 인도: 출발 {result.modes.walk.snapStartM.toFixed(0)}m / 도착{" "}
              {result.modes.walk.snapEndM.toFixed(0)}m 이동). 그래프: 차도 노드 {formatInt(result.modes.car.graph.n)}개, 인도 노드{" "}
              {formatInt(result.modes.walk.graph.n)}개 · OSM 기준 시각 {result.modes.car.graph.meta.osmTimestamp ?? "알 수 없음"}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
