"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ALGORITHMS, ALGORITHM_BY_ID, DFS_TIME_LIMIT_MS, type AlgorithmId } from "@/lib/algorithms";
import { edgesToLatLngs, runBenchmark, TIMING_RUNS, type BenchmarkResult, type ModeRun } from "@/lib/benchmark";
import { END, MODE_LABEL, PENALTY_SEC, SPEED_KMH, START, type Mode } from "@/lib/config";
import { formatDistance, formatDuration, formatInt, formatMs } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
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
  return r.explored.map(([a, b]) => [
    [g.lat[a], g.lng[a]],
    [g.lat[b], g.lng[b]],
  ]);
}

const STATUS_NOTE: Record<string, string> = { TIMEOUT: "시간 초과", NO_PATH: "길 없음", ERROR: "오류" };

const ALGO_CAPTION: Record<AlgorithmId, string> = {
  dfs: "모든 길을 끝까지 따라가 보므로 이 크기의 지도에서는 2초 안에 끝나지 못합니다.",
  dijkstra: "출발지에서 가까운 곳부터 동그랗게 퍼지며 확정합니다.",
  astar: "도착지까지 직선거리 힌트로 도착지 쪽을 먼저 봅니다.",
  cch: "미리 만들어 둔 지름길을 타고 출발지·도착지에서 '중요한 교차로' 쪽으로만 올라가 만나는 곳을 찾습니다.",
  lpa: "처음 한 번은 A* 와 비슷하게 찾고, 도로 상황이 바뀌면 바뀐 곳 근처만 다시 계산합니다 (혼잡·폐쇄 실험 참고).",
};

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
    ALGORITHMS.map((a) => {
      const rs = MODES.map((m) => [m, runsFor(m).find((r) => r.algorithm === a.id)!] as const);
      return {
        label: a.name,
        values: Object.fromEntries(rs.map(([m, r]) => [m, pick(r)])),
        notes: Object.fromEntries(rs.map(([m, r]) => [m, STATUS_NOTE[r.status] ?? "—"])),
      };
    });

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
            ? `옅은 선은 ${ALGORITHM_BY_ID[algo].name}이(가) 탐색한 ${algo === "cch" ? "지름길(미리 만들어 둔 shortcut, 직선으로 표시)" : "간선"}, 굵은 선은 찾은 경로입니다. ${ALGO_CAPTION[algo]}`
            : "▶ 시작을 누르면 모든 알고리즘을 차도·인도에서 실행하고, 선택한 알고리즘의 탐색 과정을 지도에 재생합니다."}
        </p>
      </section>

      {result && (
        <>
          <section className="grid md:grid-cols-3 gap-3">
            <GroupedBarChart
              title="소요 시간"
              subtitle="찾은 경로의 이동 시간 · 2초 안에 끝난 방법은 모두 같은 값"
              series={SERIES}
              rows={chartRows((r) => r.costSec)}
              format={formatDuration}
            />
            <GroupedBarChart
              title="탐색한 노드 수"
              subtitle="적을수록 효율적 · DFS 는 멈추기 전까지 들어간 노드, CCH 는 위로 올라간 노드"
              series={SERIES}
              rows={chartRows((r) => r.visited)}
              format={formatInt}
            />
            <GroupedBarChart
              title="탐색 시간"
              subtitle={`1회 평균, ${TIMING_RUNS}번 측정한 중앙값 · CCH 는 질의만 · 브라우저 성능에 따라 다름`}
              series={SERIES}
              rows={chartRows((r) => r.runtimeMs).map((row) => ({ ...row, notes: undefined }))}
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
                    <th>탐색 시간</th>
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
                          <td>{result.penalties && r.found ? `${formatDuration(r.penaltySec)} (${r.penaltyCount})` : "—"}</td>
                          <td>{formatInt(r.visited)}</td>
                          <td>{formatInt(r.relaxations)}</td>
                          <td>{formatMs(r.runtimeMs)}</td>
                          <td>
                            {r.optimal ? (
                              <span className="badge badge-good">✓ 최적</span>
                            ) : (
                              <span className="badge badge-bad">{r.found ? "✗ 비최적" : `✗ ${STATUS_NOTE[r.status]}`}</span>
                            )}
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
            <p className="text-xs faint mt-1">
              CCH 의 탐색 시간은 질의만 잰 값입니다. 쓰기 전에 한 번 드는 시간: 전처리(지도 모양만 보고 지름길 만들기) 차도{" "}
              {formatMs(result.modes.car.cch.prepMs)} · 인도 {formatMs(result.modes.walk.cch.prepMs)}, 커스터마이징(비용 채우기) 차도{" "}
              {formatMs(result.modes.car.cch.customizeMs)} · 인도 {formatMs(result.modes.walk.cch.customizeMs)}. DFS 는 한 번에 최대{" "}
              {DFS_TIME_LIMIT_MS / 1000}초만 돌립니다.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
