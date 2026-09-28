"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import LogChart from "./LogChart";

export type Algorithm = "dfs" | "dijkstra" | "astar";
export type Objective = "distance" | "time";
type Tab = "overview" | "synthetic" | "road" | "condition" | "results" | "presentation" | "method";
interface RunRow {
  algorithm: Algorithm; status: string; search_ns: number; objective_cost: number | null;
  route_length_m: number | null; estimated_free_flow_s: number | null; estimated_scenario_s: number | null;
  expanded_kind: string; expanded_count: number; unique_visited: number; complete_paths: number | null;
  relaxed_edges: number | null; heap_peak_entries: number | null; best_so_far: number | null;
  route_edge_ids: string;
}
export interface Case {
  experiment_id: string; size_label: string; objective: Objective; scenario_id: string; od_id: string;
  algorithms: Partial<Record<Algorithm, RunRow>>; dijkstra?: RunRow;
}
interface SummaryGroup {
  key: string; experiment_id: string; size_label: string; graph_nodes: number; graph_edges: number;
  objective: Objective; scenario_id: string; algorithm: Algorithm; od_count: number; runs: number;
  success: number; timeout: number; no_path: number; error: number;
  median_search_ns: number | null; q1_search_ns: number | null; q3_search_ns: number | null;
  median_expanded: number | null;
}
interface OdMedian {
  key: string; experiment_id: string; size_label: string; objective: Objective; scenario_id: string;
  od_id: string; algorithm: Algorithm; repeats: number; success: number; timeout: number;
  objective_cost: number | null; median_search_ns: number | null; median_expanded: number | null;
  median_complete_paths: number | null;
}
interface TraceEntry {
  id: string; file: string; label: string; experiment_id: string; size_label: string;
  objective: Objective; scenario_id: string; od_id: string;
}
export interface Summary {
  meta: {
    osm_timestamp: string | null; osm_sha256: string; config_sha256: string; raw_rows: number;
    radius_stats: { radius_m: number; nodes: number; edges: number; excluded_nodes: number; excluded_edges: number; actual_radius_m: number }[];
    common_od: { id: string }[]; growing_od: Record<string, { id: string }[]>;
    scenarios: { id: string; congestedEdgeIds?: string[]; closedEdgeIds?: string[] }[];
    condition_case: { scenario_id: string; od_id: string; objective: Objective } | null;
    config: { seed: number; run: { repeats: number; dfs_time_limit_ms: number }; road: { straight_distance_ratio: number[] } };
    status_counts: Record<string, number>;
  };
  groups: SummaryGroup[];
  od_medians: OdMedian[];
  cases: Case[];
  change_counts: { scenario_id: string; route_changed: number; unchanged: number; no_path: number; total: number }[];
  trace_index: TraceEntry[];
  presentation: string[];
}
export interface Frame { step: number; visited: number; current: number; path: number[]; best: number[] | null }
interface TraceRun {
  status: string; objectiveCost: number | null; bestSoFar: number | null; pathEdges: number[];
  expandedCount: number; uniqueVisited: number; completePaths: number | null;
  trace: { order: number[]; frames: Frame[] } | null;
}
export interface TraceFile {
  experimentId: string; sizeLabel: string; radiusM: number | null; objective: Objective; scenarioId: string;
  od: { source: number; target: number; id: string };
  graph: { x: number[]; y: number[]; from: number[]; to: number[] } | null;
  runs: Partial<Record<Algorithm, TraceRun>>;
}
export interface RoadJson {
  meta: { center: [number, number] };
  lat: number[]; lng: number[]; from: number[]; to: number[]; geomStart: number[]; geom: number[];
  edgeId: string[];
}
interface BatchData {
  method: string;
  rows: { size_label: string; algorithm: Algorithm; mean_ns: number }[];
}

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "개요" }, { id: "synthetic", label: "가상 도로" },
  { id: "road", label: "조치원 도로" }, { id: "condition", label: "도로 조건" },
  { id: "results", label: "측정 결과" }, { id: "presentation", label: "발표 모드" },
  { id: "method", label: "방법과 한계" },
];
const algorithmNames: Record<Algorithm, string> = { dfs: "DFS", dijkstra: "Dijkstra", astar: "A*" };
const algorithmColors: Record<Algorithm, string> = { dfs: "#d63a3a", dijkstra: "#2a78d6", astar: "#e8741f" };
const statusNames: Record<string, string> = { SUCCESS: "완료", TIMEOUT: "시간 초과", NO_PATH: "도달 불가", ERROR: "검증 오류" };
const scenarioNames: Record<string, string> = { normal: "정상", congestion_1_5: "가상 혼잡 1.5배",
  congestion_3_0: "가상 혼잡 3배", closure_1: "방향 도로 폐쇄 1", closure_2: "방향 도로 폐쇄 2", closure_3: "방향 도로 폐쇄 3" };
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? "—" : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const millis = (ns: number | null | undefined) => ns === null || ns === undefined ? "—" : `${number(ns / 1e6, 3)} ms`;

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string }[] }) {
  return <label className="flex min-w-36 flex-col gap-1 text-sm font-medium">{label}
    <select className="final-select" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

function RunCard({ algorithm, row, trace, objective, showTravelTime }: { algorithm: Algorithm; row?: RunRow; trace?: TraceRun;
  objective: Objective; showTravelTime: boolean }) {
  const status = row?.status ?? trace?.status ?? "ERROR";
  return <article className="card min-w-0" style={{ borderTop: `4px solid ${algorithmColors[algorithm]}` }}>
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{algorithmNames[algorithm]}</h3>
      <span className={`badge ${status === "SUCCESS" ? "badge-good" : "badge-bad"}`}>{statusNames[status] ?? status}</span></div>
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      <dt className="muted">최소 비용 ({objective === "distance" ? "m" : "s"})</dt><dd className="num text-right">{status === "SUCCESS" ? number(row?.objective_cost ?? trace?.objectiveCost, 3) : "미확정"}</dd>
      <dt className="muted">검색시간</dt><dd className="num text-right">{millis(row?.search_ns)}</dd>
      {showTravelTime && <><dt className="muted">차량 추정시간</dt><dd className="num text-right">{status === "SUCCESS" ? `${number(row?.estimated_scenario_s, 1)} s` : "미확정"}</dd></>}
      <dt className="muted">탐색 작업량</dt><dd className="num text-right">{number(row?.expanded_count ?? trace?.expandedCount, 0)}</dd>
      <dt className="muted">서로 다른 노드</dt><dd className="num text-right">{number(row?.unique_visited ?? trace?.uniqueVisited, 0)}</dd>
      <dt className="muted">완료 경로</dt><dd className="num text-right">{number(row?.complete_paths ?? trace?.completePaths, 0)}</dd>
      {algorithm !== "dfs" && <><dt className="muted">완화한 간선</dt><dd className="num text-right">{number(row?.relaxed_edges, 0)}</dd>
        <dt className="muted">최대 힙 크기</dt><dd className="num text-right">{number(row?.heap_peak_entries, 0)}</dd></>}
    </dl>
    {status === "TIMEOUT" && <p className="mt-3 text-sm muted">2초에 중단했습니다. 발견한 후보는 {number(row?.best_so_far ?? trace?.bestSoFar, 2)}이며 최적값으로 확정하지 않습니다.</p>}
  </article>;
}

export function RoadCanvas({ trace, road, algorithm, frame, normalRoute, impacted }: {
  trace: TraceFile; road: RoadJson | null; algorithm: Algorithm; frame: Frame | null;
  normalRoute?: string[]; impacted?: Set<string>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = trace.runs[algorithm];
  useEffect(() => {
    const element = canvas.current, context = element?.getContext("2d");
    if (!element || !context || !run) return;
    const width = 840, height = 470, margin = 32;
    element.width = width; element.height = height;
    context.fillStyle = getComputedStyle(element).getPropertyValue("--surface").trim() || "#fff";
    context.fillRect(0, 0, width, height);
    const synthetic = trace.graph;
    if (!synthetic && !road) return;
    const radius = trace.radiusM ?? 5000;
    const center = road?.meta.center ?? [0, 0];
    const kx = 6371008.8 * Math.PI / 180 * Math.cos(center[0] * Math.PI / 180);
    const ky = 6371008.8 * Math.PI / 180;
    const point = synthetic ? (v: number): [number, number] => [synthetic.x[v], synthetic.y[v]] :
      (v: number): [number, number] => [(road!.lng[v] - center[1]) * kx, (road!.lat[v] - center[0]) * ky];
    const limits = synthetic ? { minX: Math.min(...synthetic.x), maxX: Math.max(...synthetic.x), minY: Math.min(...synthetic.y), maxY: Math.max(...synthetic.y) } :
      { minX: -radius, maxX: radius, minY: -radius, maxY: radius };
    const rangeX = Math.max(1, limits.maxX - limits.minX), rangeY = Math.max(1, limits.maxY - limits.minY);
    const scale = Math.min((width - margin * 2) / rangeX, (height - margin * 2) / rangeY);
    const ox = (width - rangeX * scale) / 2, oy = (height - rangeY * scale) / 2;
    const map = ([x, y]: [number, number]): [number, number] => [ox + (x - limits.minX) * scale, height - (oy + (y - limits.minY) * scale)];
    const edgeCount = synthetic ? synthetic.from.length : road!.from.length;
    const edgeId = (e: number) => synthetic ? `${synthetic.from[e]}:${synthetic.to[e]}:0` : road!.edgeId[e];
    const drawEdge = (e: number) => {
      const from = synthetic ? synthetic.from[e] : road!.from[e], to = synthetic ? synthetic.to[e] : road!.to[e];
      const a = point(from), b = point(to);
      if (!synthetic && (Math.abs(a[0]) > radius || Math.abs(a[1]) > radius || Math.abs(b[0]) > radius || Math.abs(b[1]) > radius)) return;
      context.beginPath();
      const [sx, sy] = map(a); context.moveTo(sx, sy);
      if (!synthetic) for (let i = road!.geomStart[e]; i < road!.geomStart[e + 1]; i += 2) {
        const [x, y] = map([(road!.geom[i + 1] - center[1]) * kx, (road!.geom[i] - center[0]) * ky]);
        context.lineTo(x, y);
      }
      const [tx, ty] = map(b); context.lineTo(tx, ty); context.stroke();
    };
    context.strokeStyle = "#aaa9a4"; context.globalAlpha = 0.55; context.lineWidth = synthetic ? 1.5 : 0.7;
    for (let e = 0; e < edgeCount; e++) drawEdge(e);
    context.globalAlpha = 1;
    if (impacted?.size) {
      context.strokeStyle = "#d63a3a"; context.lineWidth = 2; context.globalAlpha = 0.7;
      for (let e = 0; e < edgeCount; e++) if (impacted.has(edgeId(e))) drawEdge(e);
      context.globalAlpha = 1;
    }
    const byId = new Map((road?.edgeId ?? []).map((id, e) => [id, e]));
    const drawRoute = (edges: number[], color: string, lineWidth: number, dashed = false) => {
      context.strokeStyle = color; context.lineWidth = lineWidth; context.setLineDash(dashed ? [6, 4] : []);
      for (const edge of edges) drawEdge(edge);
      context.setLineDash([]);
    };
    if (normalRoute && road) drawRoute(normalRoute.map((id) => byId.get(id)).filter((e): e is number => e !== undefined), "#555", 4, true);
    if (frame) {
      const visited = run.trace?.order.slice(0, frame.visited) ?? [];
      context.fillStyle = algorithmColors[algorithm]; context.globalAlpha = 0.65;
      for (const node of visited) {
        const [x, y] = map(point(node)); context.beginPath(); context.arc(x, y, synthetic ? 3 : 2, 0, 2 * Math.PI); context.fill();
      }
      context.globalAlpha = 1;
      drawRoute(frame.path, algorithmColors[algorithm], 3);
      if (frame.current >= 0) { const [x, y] = map(point(frame.current)); context.beginPath(); context.fillStyle = "#111";
        context.arc(x, y, 5, 0, 2 * Math.PI); context.fill(); }
    }
    if (trace.od.source >= 0 && trace.od.target >= 0) {
      for (const [node, color] of [[trace.od.source, "#178450"], [trace.od.target, "#a02d8a"]] as [number, string][]) {
        const [x, y] = map(point(node)); context.beginPath(); context.fillStyle = color;
        context.arc(x, y, 7, 0, 2 * Math.PI); context.fill();
        context.font = "bold 15px sans-serif"; context.fillText(node === trace.od.source ? "출발" : "도착", x + 10, y - 10);
      }
    }
  }, [trace, road, algorithm, frame, run, normalRoute, impacted]);
  return <canvas ref={canvas} className="w-full rounded-lg border" style={{ borderColor: "var(--border)", aspectRatio: "840 / 470", maxHeight: 340, objectFit: "contain" }}
    role="img" aria-label={`${algorithmNames[algorithm]} 도로망 탐색 장면. 출발은 초록색, 도착은 보라색입니다.`} />;
}

function Playback({ trace, road, sample, normalRoute, impacted }: { trace: TraceFile | null; road: RoadJson | null;
  sample?: Case; normalRoute?: string[]; impacted?: Set<string> }) {
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false);
  const count = Math.max(1, ...Object.values(trace?.runs ?? {}).map((run) => run.trace?.frames.length ?? 0));
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setFrame((n) => {
      if (n + 1 >= count) { setPlaying(false); return count - 1; }
      return n + 1;
    }), 160);
    return () => window.clearInterval(timer);
  }, [playing, count]);
  if (!trace) return <div className="card muted">탐색 기록을 불러오는 중입니다.</div>;
  const algorithms = Object.keys(trace.runs) as Algorithm[];
  const selectedFrame = (run?: TraceRun): Frame | null => {
    const frames = run?.trace?.frames;
    if (!frames?.length) return null;
    return frames[Math.round(frame * (frames.length - 1) / Math.max(1, count - 1))];
  };
  return <div className="space-y-4">
    <div className="card flex flex-wrap items-center gap-2" aria-label="탐색 재생 조작">
      <button className="btn" onClick={() => { setFrame(0); setPlaying(false); }}>처음</button>
      <button className="btn btn-primary" onClick={() => setPlaying((value) => !value)}>{playing ? "일시정지" : "재생"}</button>
      <button className="btn" onClick={() => { setFrame(count - 1); setPlaying(false); }}>결과로 이동</button>
      <span className="ml-auto text-sm muted num">장면 {frame + 1} / {count}</span>
    </div>
    <div className={`grid gap-4 ${algorithms.length === 3 ? "xl:grid-cols-3" : "lg:grid-cols-2"}`}>
      {algorithms.map((algorithm) => <div key={algorithm} className="space-y-3">
        <RoadCanvas trace={trace} road={road} algorithm={algorithm} frame={selectedFrame(trace.runs[algorithm])}
          normalRoute={normalRoute} impacted={impacted} />
        <RunCard algorithm={algorithm} row={sample?.algorithms[algorithm]} trace={trace.runs[algorithm]}
          objective={trace.objective} showTravelTime={trace.experimentId !== "synthetic"} />
      </div>)}
    </div>
    <p className="text-sm muted">카드의 검색시간은 공식 측정 1회차 값입니다. DFS 작업량은 경로 접두 상태 수이고, Dijkstra/A* 작업량은 확정한 노드 수입니다.</p>
  </div>;
}

export default function FinalStudyView({ evidenceOnly = false }: { evidenceOnly?: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null), [road, setRoad] = useState<RoadJson | null>(null);
  const [batchData, setBatchData] = useState<BatchData | null>(null);
  const [error, setError] = useState<string | null>(null), [tab, setTab] = useState<Tab>(evidenceOnly ? "results" : "overview");
  const [syntheticSize, setSyntheticSize] = useState("8"), [radius, setRadius] = useState("500");
  const [objective, setObjective] = useState<Objective>("distance"), [odType, setOdType] = useState("growing");
  const [scenarioId, setScenarioId] = useState("normal"), [scene, setScene] = useState(0);
  const [loadedTrace, setLoadedTrace] = useState<{ id: string; data: TraceFile } | null>(null);
  useEffect(() => {
    Promise.all([fetch("/study/final-v4/summary.json").then((r) => { if (!r.ok) throw new Error("결과 파일을 읽을 수 없습니다"); return r.json() as Promise<Summary>; }),
      fetch("/study/final/road.json").then((r) => { if (!r.ok) throw new Error("도로 파일을 읽을 수 없습니다"); return r.json() as Promise<RoadJson>; }),
      fetch("/study/final-v4/batch_measurements.json").then((r) => r.ok ? r.json() as Promise<BatchData> : null)])
      .then(([loadedSummary, loadedRoad, loadedBatch]) => { setSummary(loadedSummary); setRoad(loadedRoad); setBatchData(loadedBatch); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);
  const roadOd = summary ? (odType === "common" ? summary.trace_index.find((entry) => entry.experiment_id === "road" && entry.size_label === `r${radius}` && entry.objective === objective && entry.od_id.startsWith("C-"))?.od_id :
    summary.trace_index.find((entry) => entry.experiment_id === "road" && entry.size_label === `r${radius}` && entry.objective === objective && entry.od_id.startsWith("G-"))?.od_id) : undefined;
  const presentationId = summary?.presentation[scene];
  const entry = summary?.trace_index.find((candidate) => {
    if (tab === "synthetic") return candidate.experiment_id === "synthetic" && candidate.size_label === `n${syntheticSize}`;
    if (tab === "road") return candidate.experiment_id === "road" && candidate.size_label === `r${radius}` && candidate.objective === objective && candidate.od_id === roadOd;
    if (tab === "condition") return candidate.experiment_id === "condition" && candidate.scenario_id === scenarioId && candidate.objective === objective;
    if (tab === "presentation") return candidate.id === presentationId;
    return false;
  });
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    fetch(entry.file).then((response) => { if (!response.ok) throw new Error("탐색 기록을 읽을 수 없습니다"); return response.json() as Promise<TraceFile>; })
      .then((loaded) => { if (alive) setLoadedTrace({ id: entry.id, data: loaded }); })
      .catch((caught) => { if (alive) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { alive = false; };
  }, [entry]);
  const trace = loadedTrace && entry && loadedTrace.id === entry.id ? loadedTrace.data : null;
  const sample = summary?.cases.find((candidate) => candidate.experiment_id === entry?.experiment_id &&
    candidate.size_label === entry?.size_label && candidate.objective === entry?.objective &&
    candidate.scenario_id === entry?.scenario_id && candidate.od_id === entry?.od_id);
  const normal = summary?.cases.find((candidate) => candidate.experiment_id === "condition" && candidate.scenario_id === "normal" &&
    candidate.objective === entry?.objective && candidate.od_id === entry?.od_id);
  const normalRoute = useMemo(() => normal?.dijkstra?.route_edge_ids.split(" ").filter(Boolean), [normal]);
  const impacted = useMemo(() => new Set(summary?.meta.scenarios.find((value) => value.id === entry?.scenario_id)?.congestedEdgeIds ??
    summary?.meta.scenarios.find((value) => value.id === entry?.scenario_id)?.closedEdgeIds ?? []), [summary, entry]);
  if (error) return <p className="card text-sm" role="alert">{error}. <code>npm run final:graph</code>과 <code>npm run final:run</code> 결과를 확인하세요.</p>;
  if (!summary) return <p className="card muted" role="status">최종 실험 데이터를 불러오는 중입니다.</p>;
  const selectedScenario = summary.change_counts.find((item) => item.scenario_id === scenarioId);
  const syntheticGroups = summary.groups.filter((group) => group.experiment_id === "synthetic" && group.scenario_id === "normal");
  const roadGroups = summary.groups.filter((group) => group.experiment_id === "road" && group.scenario_id === "normal" && group.objective === objective);
  const firstTimeout = summary.groups.filter((group) => group.experiment_id === "synthetic" && group.algorithm === "dfs" && group.timeout > 0)
    .sort((a, b) => a.graph_nodes - b.graph_nodes)[0];
  const orderedGroups = [...syntheticGroups, ...roadGroups].sort((a, b) =>
    (a.experiment_id === b.experiment_id ? 0 : a.experiment_id === "synthetic" ? -1 : 1) ||
    a.graph_nodes - b.graph_nodes || ["dfs", "dijkstra", "astar"].indexOf(a.algorithm) - ["dfs", "dijkstra", "astar"].indexOf(b.algorithm));
  return <div className="space-y-5">
    <div className="tabs" role="tablist" aria-label="최종 연구 화면">{tabs.filter((item) => !evidenceOnly || item.id === "results" || item.id === "method").map((item) => <button key={item.id} role="tab"
      aria-selected={tab === item.id} className="tab" onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    {tab === "overview" && <div className="space-y-4">
      <section className="card"><p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>DCCS309 C1 · 최종 도로망 실험</p>
        <h2 className="mt-2 text-2xl font-bold">같은 길찾기 문제를 세 방법으로 풀면 무엇이 달라질까?</h2>
        <p className="mt-3 muted">가상 도로와 조치원 차량 도로망에서 DFS, Dijkstra, A*의 최소 비용과 탐색 작업량·컴퓨터 검색시간을 비교합니다.</p></section>
      <div className="grid gap-3 md:grid-cols-3">{(["dfs", "dijkstra", "astar"] as Algorithm[]).map((algorithm) => <div className="card" key={algorithm}>
        <strong style={{ color: algorithmColors[algorithm] }}>{algorithmNames[algorithm]}</strong><p className="mt-2 text-sm muted">{algorithm === "dfs" ? "가능한 단순 경로를 모두 확인합니다. 2초 뒤에도 끝나지 않으면 최적값은 미확정입니다." : algorithm === "dijkstra" ? "음이 아닌 비용에서 최소 비용을 보장하는 기준 알고리즘입니다." : "검증한 직선거리 하한으로 탐색 순서를 정합니다. 최소 비용은 Dijkstra와 같아야 합니다."}</p></div>)}</div>
      <section className="card grid gap-3 text-sm md:grid-cols-2"><p><strong>자료</strong><br />OpenStreetMap 차량 도로 · 기준 시각 {summary.meta.osm_timestamp ?? "기록 없음"}</p>
        <p><strong>전체 지도</strong><br />{number(summary.meta.radius_stats.at(-1)?.nodes, 0)}개 노드 · {number(summary.meta.radius_stats.at(-1)?.edges, 0)}개 방향 간선(5km 부분 그래프)</p>
        <p><strong>비용과 시간</strong><br />거리 비용 m, 추정 이동시간 s, 컴퓨터 검색시간 ms를 구분합니다.</p>
        <p><strong>자료 해석</strong><br />혼잡은 가상 조정이며 실제 교통량, 신호, 사고 정보가 아닙니다.</p></section>
    </div>}
    {tab === "synthetic" && <section className="space-y-4"><div className="card flex flex-wrap gap-3">
      <Select label="가상 도로 크기" value={syntheticSize} onChange={setSyntheticSize} options={[8, 16, 24].map((n) => ({ value: String(n), label: `${n}노드` }))} />
      <p className="self-end text-sm muted">출발 0 → 도착 {Number(syntheticSize) - 1} · 같은 그래프와 거리 비용 · 시드 309</p></div>
      <Playback key={entry?.id} trace={trace} road={null} sample={sample} /></section>}
    {tab === "road" && <section className="space-y-4"><div className="card flex flex-wrap gap-3">
      <Select label="도로 범위" value={radius} onChange={setRadius} options={[500, 2000, 5000].map((n) => ({ value: String(n), label: `${n / 1000}km` }))} />
      <Select label="최소화할 비용" value={objective} onChange={(value) => setObjective(value as Objective)} options={[{ value: "distance", label: "거리 최소 (m)" }, { value: "time", label: "추정 이동시간 최소 (s)" }]} />
      <Select label="출발·도착 유형" value={odType} onChange={setOdType} options={[{ value: "common", label: "모든 크기에 공통" }, { value: "growing", label: "지도 크기에 대응" }]} />
      <p className="w-full text-sm muted">{odType === "growing" ? "규모 대응 유형은 지도 크기와 출발·도착 거리의 효과가 함께 변합니다." : "공통 유형은 모든 크기에 포함되는 같은 출발·도착 쌍을 사용합니다."} 추정 이동시간은 실제 교통상황을 반영하지 않습니다.</p></div>
      <Playback key={entry?.id} trace={trace} road={road} sample={sample} /></section>}
    {tab === "condition" && <section className="space-y-4"><div className="card flex flex-wrap gap-3">
      <Select label="도로 조건" value={scenarioId} onChange={setScenarioId} options={summary.meta.scenarios.map((value) => ({ value: value.id, label: scenarioNames[value.id] ?? value.id }))} />
      <Select label="최소화할 비용" value={objective} onChange={(value) => setObjective(value as Objective)} options={[{ value: "distance", label: "거리 최소 (m)" }, { value: "time", label: "추정 이동시간 최소 (s)" }]} />
      <p className="w-full text-sm muted">5km 차량 도로망 · 동일 출발·도착. 회색 점선은 정상 경로, 색 실선은 선택 조건 경로입니다. 빨간 선은 영향받은 방향 도로입니다.</p></div>
      {selectedScenario && <div className="grid gap-3 sm:grid-cols-4">{[["경로 변경", selectedScenario.route_changed], ["변화 없음", selectedScenario.unchanged], ["도달 불가", selectedScenario.no_path], ["전체 표본", selectedScenario.total]].map(([label, value]) => <div className="card" key={label}><p className="muted text-sm">{label}</p><p className="num text-xl font-bold">{value}</p></div>)}</div>}
      <Playback key={entry?.id} trace={trace} road={road} sample={sample} normalRoute={normalRoute} impacted={impacted} />
      <div className="card table-wrap"><h2 className="font-bold">정상 경로와 선택 조건 비교</h2>
        <table className="data mt-3"><thead><tr><th>조건</th><th>상태</th><th>최소 비용 ({objective === "distance" ? "m" : "s"})</th><th>경로 거리 m</th><th>추정 이동시간 s</th><th>검색시간 ms</th><th>확정 노드</th></tr></thead>
          <tbody>{[["정상", normal?.dijkstra], ["선택 조건", sample?.dijkstra]] .map(([label, value]) => {
            const row = value as RunRow | undefined;
            return <tr key={label as string}><td>{label as string}</td><td>{row ? statusNames[row.status] ?? row.status : "—"}</td>
              <td>{number(row?.objective_cost, 2)}</td><td>{number(row?.route_length_m, 1)}</td>
              <td>{number(row?.estimated_scenario_s, 1)}</td><td>{number(row ? row.search_ns / 1e6 : null, 3)}</td>
              <td>{number(row?.expanded_count, 0)}</td></tr>;
          })}</tbody></table></div>
      <p className="text-sm muted">한 사례의 경로 변화는 위 전체 집계와 함께 해석해야 합니다. 거리 목적에서 가상 혼잡은 길이 비용을 바꾸지 않습니다.</p></section>}
    {tab === "results" && <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">{Object.entries(summary.meta.status_counts).map(([status, count]) => <div className="card" key={status}><p className="text-sm muted">{statusNames[status] ?? status}</p><p className="num text-xl font-bold">{number(count, 0)}</p></div>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LogChart title="실제 도로 노드 수 대비 검색시간" subtitle="거리 목적 · 완료된 Dijkstra/A*의 OD별 중앙값" xLabel="실제 노드 수" yLabel="검색시간 (ms)" showTimeoutLegend={false}
          formatY={(value) => number(value, 2)} series={(["dijkstra", "astar"] as Algorithm[]).map((algorithm) => ({ id: algorithm,
            label: algorithmNames[algorithm], color: algorithmColors[algorithm], points: roadGroups.filter((group) => group.algorithm === algorithm && group.median_search_ns !== null)
              .map((group) => ({ x: group.graph_nodes, y: group.median_search_ns! / 1e6, label: `${group.size_label} · ${group.graph_edges}간선` })) }))} />
        <LogChart title="가상 입력 크기 대비 탐색 작업량" subtitle="DFS는 경로 접두 상태, Dijkstra/A*는 확정 노드. 시간 초과 작업량도 포함" xLabel="노드 수" yLabel="작업량" showTimeoutLegend={false}
          formatY={(value) => number(value, 0)} series={(["dfs", "dijkstra", "astar"] as Algorithm[]).map((algorithm) => ({ id: algorithm,
            label: algorithmNames[algorithm], color: algorithmColors[algorithm], points: syntheticGroups.filter((group) => group.algorithm === algorithm && group.median_expanded !== null)
              .map((group) => ({ x: group.graph_nodes, y: group.median_expanded!, label: group.size_label })) }))} />
      </div>
      <div className="card"><h2 className="text-lg font-bold">입력 크기와 검색시간</h2><p className="mt-1 text-sm muted">각 출발·도착 쌍의 10회 중앙값을 구한 뒤 전체 쌍의 중앙값과 사분위 범위(IQR)를 표시합니다. DFS 시간 초과는 완료시간 비교에서 제외합니다.</p>
        <div className="mt-4 table-wrap"><table className="data"><thead><tr><th>실험</th><th>크기</th><th>방법</th><th>노드/간선</th><th>중앙값 ms</th><th>IQR ms</th><th>탐색 작업량</th><th>완료/시간 초과</th></tr></thead><tbody>
          {orderedGroups.map((group) => <tr key={group.key}><td>{group.experiment_id === "synthetic" ? "가상" : "조치원"}</td><td>{group.size_label}</td><td>{algorithmNames[group.algorithm]}</td>
            <td>{number(group.graph_nodes, 0)} / {number(group.graph_edges, 0)}</td><td>{number(group.median_search_ns === null ? null : group.median_search_ns / 1e6, 3)}</td>
            <td>{group.q1_search_ns === null || group.q3_search_ns === null ? "—" : `${number(group.q1_search_ns / 1e6, 3)}–${number(group.q3_search_ns / 1e6, 3)}`}</td>
            <td>{number(group.median_expanded, 0)}</td><td>{group.success} / {group.timeout}</td></tr>)}</tbody></table></div></div>
      <div className="card"><h2 className="text-lg font-bold">DFS가 처음 시간 초과한 크기</h2><p className="mt-2 muted">{firstTimeout ? `${firstTimeout.size_label} (${firstTimeout.graph_nodes}노드)` : "시험한 가상 크기에서 시간 초과 없음"}.</p>
        <div className="mt-3 table-wrap"><table className="data"><thead><tr><th>크기</th><th>상태</th><th>완료 경로 수 중앙값</th><th>후보 비용(1회차)</th></tr></thead><tbody>
          {summary.od_medians.filter((item) => item.experiment_id === "synthetic" && item.algorithm === "dfs")
            .sort((a, b) => Number(a.size_label.slice(1)) - Number(b.size_label.slice(1)))
            .map((item) => <tr key={item.size_label}><td>{item.size_label}</td>
              <td>{item.timeout ? "시간 초과 포함" : "완료"}</td><td>{number(item.median_complete_paths, 0)}</td>
              <td>{number(summary.cases.find((c) => c.experiment_id === "synthetic" && c.size_label === item.size_label)?.algorithms.dfs?.best_so_far, 2)}</td></tr>)}</tbody></table></div></div>
      <div className="card"><h2 className="text-lg font-bold">같은 출발·도착에서 Dijkstra와 A*</h2><p className="mt-1 text-sm muted">5km 거리 목적 · 각 출발·도착 쌍의 10회 중앙값입니다.</p>
        <div className="mt-3 table-wrap"><table className="data"><thead><tr><th>출발·도착</th><th>Dijkstra 비용 m</th><th>A* 비용 m</th><th>Dijkstra ms</th><th>A* ms</th><th>확정 노드 D / A*</th></tr></thead><tbody>
          {summary.od_medians.filter((item) => item.experiment_id === "road" && item.size_label === "r5000" && item.objective === "distance" && item.algorithm === "dijkstra")
            .map((d) => { const a = summary.od_medians.find((item) => item.experiment_id === "road" && item.size_label === "r5000" &&
              item.objective === "distance" && item.od_id === d.od_id && item.algorithm === "astar");
              return <tr key={d.od_id}><td>{d.od_id}</td><td>{number(d.objective_cost, 2)}</td><td>{number(a?.objective_cost, 2)}</td>
                <td>{millis(d.median_search_ns)}</td><td>{millis(a?.median_search_ns)}</td>
                <td>{number(d.median_expanded, 0)} / {number(a?.median_expanded, 0)}</td></tr>; })}</tbody></table></div></div>
      <div className="card"><h2 className="text-lg font-bold">도로 조건별 전체 표본</h2><div className="mt-3 table-wrap"><table className="data"><thead><tr><th>조건</th><th>변경</th><th>미변경</th><th>도달 불가</th><th>전체</th></tr></thead><tbody>{summary.change_counts.map((item) => <tr key={item.scenario_id}><td>{item.scenario_id}</td><td>{item.route_changed}</td><td>{item.unchanged}</td><td>{item.no_path}</td><td>{item.total}</td></tr>)}</tbody></table></div></div>
      {batchData && <div className="card"><h2 className="text-lg font-bold">작은 입력의 별도 묶음 측정</h2>
        <p className="mt-1 text-sm muted">각 묶음에서 검색을 1,000번 연속 실행한 뒤 1회 평균을 구했습니다. 공식 단일 실행 중앙값과 다른 지표이며 반복문 비용이 포함됩니다.</p>
        <div className="mt-3 table-wrap"><table className="data"><thead><tr><th>크기</th><th>방법</th><th>묶음 수</th><th>묶음 평균의 중앙값 ms</th></tr></thead><tbody>
          {[4, 6, 8].flatMap((n) => (["dfs", "dijkstra", "astar"] as Algorithm[]).map((algorithm) => {
            const values = batchData.rows.filter((row) => row.size_label === `n${n}` && row.algorithm === algorithm)
              .map((row) => row.mean_ns / 1e6).sort((a, b) => a - b);
            return <tr key={`${n}-${algorithm}`}><td>n{n}</td><td>{algorithmNames[algorithm]}</td><td>{values.length}</td>
              <td>{number(values.length ? (values[4] + values[5]) / 2 : null, 4)}</td></tr>;
          }))}</tbody></table></div></div>}
      <p className="text-sm muted">원본 실행값 {number(summary.meta.raw_rows, 0)}행은 <code>results/final-v4/raw_runs.csv</code>에 보존됩니다. 매우 짧은 시간은 탐색 작업량과 함께 해석하세요.</p></section>}
    {tab === "presentation" && <section className="space-y-4"><div className="card flex flex-wrap items-center gap-2">
      <button className="btn" disabled={scene === 0} onClick={() => setScene((n) => Math.max(0, n - 1))}>이전 장면</button>
      <span className="mx-auto font-semibold">발표 장면 {scene + 1} / {summary.presentation.length}</span>
      <button className="btn btn-primary" disabled={scene + 1 === summary.presentation.length} onClick={() => setScene((n) => Math.min(summary.presentation.length - 1, n + 1))}>다음 장면</button>
      <p className="w-full text-center text-sm muted">재생을 건너뛰고 결과로 바로 이동할 수 있습니다.</p></div>
      {presentationId === "results-summary" ? <div className="card"><h2 className="text-lg font-bold">전체 결과 요약</h2><p className="mt-2 muted">총 {number(summary.meta.raw_rows, 0)}회 실행 · 결과의 중앙값과 IQR은 측정 결과 탭에서 확인할 수 있습니다.</p>
        <p className="mt-2 muted">실제 측정값을 바탕으로 최소 비용 일치, DFS 시간 초과, A* 탐색량과 검색시간의 차이를 설명하세요.</p></div> :
        <Playback key={entry?.id} trace={trace} road={road} sample={sample} normalRoute={entry?.experiment_id === "condition" ? normalRoute : undefined} impacted={entry?.experiment_id === "condition" ? impacted : undefined} />}</section>}
    {tab === "method" && <section className="card prose-ko space-y-4"><h2>자료와 재현 방법</h2>
      <p>OpenStreetMap 차량 도로 자료를 공개 Overpass API에서 받았습니다. 출처 시각은 {summary.meta.osm_timestamp ?? "기록 없음"}입니다. 원본 OSM SHA-256은 <code>{summary.meta.osm_sha256}</code>, 설정 SHA-256은 <code>{summary.meta.config_sha256}</code>입니다.</p>
      <p>중심에서 0.5·1·2·3·5km 반경을 잘라 가장 큰 강연결요소를 사용합니다. 강연결요소는 선택한 교차로들 사이를 양방향으로 오갈 수 있는 부분입니다. 일방통행과 평행 도로는 방향 간선으로 보존합니다.</p>
      <div className="table-wrap"><table className="data"><thead><tr><th>설정 반경</th><th>실제 최대 반경</th><th>노드</th><th>방향 간선</th><th>제외 노드/간선</th><th>유효 출발·도착 쌍</th></tr></thead>
        <tbody>{summary.meta.radius_stats.map((item) => <tr key={item.radius_m}><td>{item.radius_m / 1000}km</td>
          <td>{number(item.actual_radius_m / 1000, 2)}km</td><td>{number(item.nodes, 0)}</td><td>{number(item.edges, 0)}</td>
          <td>{number(item.excluded_nodes, 0)} / {number(item.excluded_edges, 0)}</td>
          <td>{(summary.meta.common_od?.length ?? 0) + (summary.meta.growing_od?.[String(item.radius_m)]?.length ?? 0)}</td></tr>)}</tbody></table></div>
      <p>기본 난수 시드는 {summary.meta.config.seed}, 공식 반복은 각 조건 {summary.meta.config.run.repeats}회, DFS 제한은 {summary.meta.config.run.dfs_time_limit_ms / 1000}초입니다. 발표 사례는 결과를 보기 전에 정한 정렬 규칙으로 고릅니다.</p>
      <p>OSM 최고속도 제한값을 해석할 수 있으면 사용하고, 없으면 도로 종류별 설정 속도를 사용합니다. 추정 이동시간은 자유 흐름 가정의 값이며 실제 차량 도착시간이 아닙니다. 알고리즘 검색시간과 별도입니다.</p>
      <p>A*의 하한 계수는 원본 방향 간선의 비용÷직선거리에서 안전한 최솟값을 구합니다. 일관성 검사가 실패하면 힌트를 0으로 낮춥니다. 완료된 경로는 방향·연결·폐쇄·비용을 검증하고 알고리즘 사이 비용도 대조합니다.</p>
      <p>가상 혼잡은 일부 도로의 시간 비용만 1.5배 또는 3배로 바꾸고, 폐쇄는 특정 방향 간선 하나만 막습니다. 신호, 회전 지연, 실시간 교통량, 사고는 반영하지 않았습니다. 향후 실측 교통, 시간 의존 비용, 양방향 A*, CH/MLD를 연구할 수 있습니다.</p>
    </section>}
  </div>;
}
