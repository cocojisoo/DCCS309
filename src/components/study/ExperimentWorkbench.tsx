"use client";

import { useEffect, useState } from "react";
import FinalStudyView, { RoadCanvas, type Algorithm, type Objective, type Summary, type TraceFile, type RoadJson, type Frame } from "./FinalStudyView";

const names: Record<Algorithm, string> = { dfs: "DFS", dijkstra: "Dijkstra", astar: "A*" };
const colors: Record<Algorithm, string> = { dfs: "#d63a3a", dijkstra: "#2a78d6", astar: "#e8741f" };
const roles: Record<Algorithm, string> = { dfs: "가능한 경로를 모두 확인", dijkstra: "가까운 곳부터 확정", astar: "도착 방향을 고려해 탐색" };
const conditions = [{ id: "normal", label: "정상" }, { id: "congestion_1_5", label: "혼잡 1.5배" }, { id: "congestion_3_0", label: "혼잡 3배" }, { id: "closure_1", label: "폐쇄 1" }, { id: "closure_2", label: "폐쇄 2" }, { id: "closure_3", label: "폐쇄 3" }];
const fmt = (v: number | null | undefined, digits = 2) => v == null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: digits });
type Experiment = "synthetic" | "road" | "condition";
const experiments: { id: Experiment; title: string; detail: string }[] = [
  { id: "synthetic", title: "1. 교차로를 늘리면?", detail: "가상 도로 · 8 → 16 → 24개" },
  { id: "road", title: "2. 지도를 넓히면?", detail: "조치원 · 0.5 → 2 → 5km" },
  { id: "condition", title: "3. 도로가 막히면?", detail: "같은 5km 지도 · 혼잡과 폐쇄" },
];

export default function ExperimentWorkbench() {
  const [data, setData] = useState<{ summary: Summary; road: RoadJson } | null>(null);
  const [error, setError] = useState("");
  const [experiment, setExperiment] = useState<Experiment>("synthetic");
  const [size, setSize] = useState(0);
  const [objective, setObjective] = useState<Objective>("distance");
  const [common, setCommon] = useState(true);
  const [condition, setCondition] = useState("normal");
  const [evidence, setEvidence] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; trace: TraceFile } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("저장된 실험 자료를 불러오지 못했습니다. 새로고침해 주세요."); return r.json(); });
    Promise.all([read("/study/final-v4/summary.json"), read("/study/final/road.json")])
      .then(([summary, road]) => { if (alive) setData({ summary, road }); })
      .catch(e => { if (alive) setError(String(e.message)); });
    return () => { alive = false; };
  }, []);
  const n = [8, 16, 24][size], radius = [500, 2000, 5000][size];
  const actualObjective = experiment === "synthetic" ? "distance" : objective;
  const entry = data?.summary.trace_index.find(t => t.experiment_id === experiment &&
    (experiment === "synthetic" ? t.size_label === `n${n}` : experiment === "road" ?
      t.size_label === `r${radius}` && t.objective === actualObjective && t.od_id.startsWith(common ? "C-" : "G-") :
      t.scenario_id === condition && t.objective === actualObjective));
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    fetch(entry.file).then(r => { if (!r.ok) throw new Error("탐색 기록을 불러오지 못했습니다."); return r.json(); })
      .then(trace => { if (alive) { setLoaded({ id: entry.id, trace }); setError(""); } })
      .catch(e => { if (alive) setError(String(e.message)); });
    return () => { alive = false; };
  }, [entry]);
  if (error) return <div role="alert" className="card">{error}</div>;
  if (!data) return <div role="status" className="card">실험실을 준비하고 있습니다…</div>;
  const { summary, road } = data;
  const stat = summary.meta.radius_stats.find(s => s.radius_m === (experiment === "condition" ? 5000 : radius));
  const trace = loaded?.id === entry?.id ? loaded?.trace ?? null : null;
  const nodes = experiment === "synthetic" ? n : stat?.nodes;
  const edges = experiment === "synthetic" ? summary.groups.find(g => g.experiment_id === "synthetic" && g.size_label === `n${n}`)?.graph_edges : stat?.edges;
  const changeExperiment = (next: Experiment) => { setExperiment(next); setSize(0); setCondition("normal"); setObjective(next === "condition" ? "time" : "distance"); };
  return <div className="lab-workbench">
    <div className="lab-experiments" aria-label="실험 선택">{experiments.map(e => <button key={e.id} aria-pressed={experiment === e.id} onClick={() => changeExperiment(e.id)}>
      <strong>{e.title}</strong><span>{e.detail}</span></button>)}</div>
    <section className="card lab-settings" aria-label="실험 조건">
      <div className="lab-section-title"><span className="lab-step">01</span><h2>실험 조건</h2><span className="muted text-sm">한 번에 한 조건씩 바꿔 비교하세요</span></div>
      <div className="lab-controls">
        {experiment !== "condition" ? <fieldset><legend>{experiment === "synthetic" ? "입력 크기 = 교차로 수" : "입력 크기 = 탐색할 지도 반경"}</legend>
          <div className="lab-segments">{[0, 1, 2].map(i => <button key={i} aria-pressed={size === i} onClick={() => setSize(i)}><span>{["작게", "중간", "크게"][i]}</span><strong>{experiment === "synthetic" ? `${[8, 16, 24][i]}개` : `${[0.5, 2, 5][i]}km`}</strong></button>)}</div>
        </fieldset> : <label>도로 상태<select className="final-select" value={condition} onChange={e => setCondition(e.target.value)}>{conditions.map(c => <option value={c.id} key={c.id}>{c.label}</option>)}</select></label>}
        {experiment !== "synthetic" && <label>찾을 경로<select className="final-select" value={objective} onChange={e => setObjective(e.target.value as Objective)}><option value="distance">거리가 가장 짧은 길</option><option value="time">추정 이동시간이 가장 짧은 길</option></select></label>}
        {experiment === "road" && <label>출발·도착 선택<select className="final-select" value={common ? "common" : "growing"} onChange={e => setCommon(e.target.value === "common")}><option value="common">고정 · 지도 크기만 비교</option><option value="growing">지도와 함께 이동거리도 확대</option></select></label>}
      </div>
      <p className="lab-explanation">{experiment === "synthetic" ? "교차로가 늘면 선택할 수 있는 길도 늘어납니다. 크기를 한 단계씩 올려 DFS가 모든 경로를 확인할 수 있는지 보세요. 크기별로 별도 생성한 지도이며 출발·도착도 달라집니다." : experiment === "road" ? common ? "출발·도착을 고정하고 주변 도로망만 넓힙니다. 반경이 커질 때 탐색할 교차로와 도로가 얼마나 늘어나는지 비교하세요." : "지도 범위와 출발·도착 거리가 함께 커집니다. 지도 크기만의 효과로 해석하지 않도록 주의하세요." : "지도와 출발·도착을 고정합니다. 혼잡은 일부 도로의 추정시간만 늘리고, 폐쇄는 한 방향 도로를 막습니다. 경로가 그대로일 수도 있습니다."}</p>
      <div className="lab-context" aria-label="현재 실험 조건"><strong>{experiment === "synthetic" ? "가상 도로" : `조치원 ${experiment === "condition" ? 5 : radius / 1000}km`}</strong><span>교차로 {fmt(nodes, 0)}개</span><span>방향 도로 {fmt(edges, 0)}개</span><span>{actualObjective === "distance" ? "거리 최소 · m" : "추정시간 최소 · 초"}</span><span>{experiment === "condition" ? conditions.find(c => c.id === condition)?.label : "정상 도로"}</span><span>{experiment === "condition" ? "Dijkstra · A* 비교" : "DFS 제한 2초"}</span></div>
    </section>
    {trace && entry ? <ExperimentPlayer key={entry.id} trace={trace} road={road} summary={summary} /> : <div className="card" role="status">선택한 조건의 탐색 기록을 불러오고 있습니다…</div>}
    <div className="lab-bottom"><button className="btn" onClick={() => { if (experiment !== "condition" && size < 2) setSize(size + 1); else changeExperiment(experiment === "synthetic" ? "road" : experiment === "road" ? "condition" : "synthetic"); }}>{experiment !== "condition" && size < 2 ? "다음 크기와 비교 →" : experiment === "synthetic" ? "실제 조치원 도로로 →" : experiment === "road" ? "혼잡·폐쇄 실험으로 →" : "처음 실험으로 →"}</button><button className="btn" aria-expanded={evidence} onClick={() => setEvidence(!evidence)}>{evidence ? "전체 측정표 닫기" : "전체 측정표·연구 방법 보기"}</button></div>
    {evidence && <FinalStudyView evidenceOnly />}
  </div>;
}

function ExperimentPlayer({ trace, road, summary }: { trace: TraceFile; road: RoadJson; summary: Summary }) {
  const [algorithm, setAlgorithm] = useState<Algorithm>(trace.experimentId === "condition" ? "dijkstra" : "dfs");
  const [progress, setProgress] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing || progress >= 100) return;
    const timer = window.setInterval(() => setProgress(p => Math.min(100, p + speed)), 120);
    return () => window.clearInterval(timer);
  }, [playing, speed, progress]);
  const isPlaying = playing && progress < 100;
  const algorithms = Object.keys(trace.runs) as Algorithm[];
  const run = trace.runs[algorithm]!;
  const frames = run.trace?.frames ?? [];
  const frame: Frame | null = progress === 0 ? null : frames[Math.min(frames.length - 1, Math.floor(progress / 100 * (frames.length - 1)))] ?? null;
  const done = progress === 100;
  const matches = (c: { experiment_id: string; size_label: string; objective: string; scenario_id: string; od_id: string }) => c.experiment_id === trace.experimentId && c.size_label === trace.sizeLabel && c.objective === trace.objective && c.scenario_id === trace.scenarioId && c.od_id === trace.od.id;
  const sample = summary.cases.find(matches);
  const medians = summary.od_medians.filter(matches);
  const normal = summary.cases.find(c => c.experiment_id === "condition" && c.scenario_id === "normal" && c.objective === trace.objective && c.od_id === trace.od.id)?.dijkstra;
  const scenario = summary.meta.scenarios.find(s => s.id === trace.scenarioId);
  const impacted = new Set([...(scenario?.congestedEdgeIds ?? []), ...(scenario?.closedEdgeIds ?? [])]);
  const current = sample?.dijkstra;
  const changed = current?.route_edge_ids !== normal?.route_edge_ids;
  const counts = summary.change_counts.find(c => c.scenario_id === trace.scenarioId);
  const d = medians.find(m => m.algorithm === "dijkstra"), a = medians.find(m => m.algorithm === "astar");
  return <section className="card lab-player">
    <div className="lab-section-title"><span className="lab-step">02</span><h2>탐색 과정을 살펴보세요</h2><span className="lab-status" role="status">{done ? "재생 완료" : playing ? "재생 중" : progress ? "일시정지" : "재생 준비"}</span></div>
    <p className="text-sm muted mb-3">저장된 실험 기록을 느리게 재생합니다. 아래 알고리즘을 바꾸면 같은 조건의 탐색 과정을 볼 수 있습니다.</p>
    <div className="lab-algorithms" aria-label="지도에 표시할 알고리즘">{algorithms.map(id => <button key={id} aria-pressed={algorithm === id} onClick={() => setAlgorithm(id)} style={{ borderTopColor: colors[id] }}><strong>{names[id]}</strong><span>{roles[id]}</span></button>)}</div>
    <div className="lab-map"><RoadCanvas trace={trace} road={trace.experimentId === "synthetic" ? null : road} algorithm={algorithm} frame={frame} normalRoute={trace.experimentId === "condition" ? normal?.route_edge_ids.split(" ").filter(Boolean) : undefined} impacted={impacted} /></div>
    <div className="lab-map-caption"><span>초록 ● 출발 · 보라 ● 도착 · 색 점: 방문한 교차로</span><strong>{done ? run.status === "TIMEOUT" ? "DFS 시간 초과 · 표시된 경로는 후보입니다" : run.status === "NO_PATH" ? "도달할 수 있는 경로 없음" : "탐색 완료 · 최종 경로" : `${names[algorithm]} · 기록상 방문 교차로 ${fmt(frame?.visited ?? 0, 0)}개`}</strong></div>
    {trace.experimentId === "condition" && <p className="text-xs muted">회색 점선: 정상 경로 · 빨간 도로: 혼잡 또는 폐쇄 대상 · 색 실선: 현재 조건의 경로</p>}
    <div className="lab-transport"><button className="btn btn-primary" onClick={() => { if (done) setProgress(0); setPlaying(!isPlaying); }}>{isPlaying ? "일시정지" : done ? "다시 재생" : "탐색 재생"}</button><button className="btn" onClick={() => { setProgress(0); setPlaying(false); }}>처음</button><button className="btn" onClick={() => { setProgress(100); setPlaying(false); }}>결과 보기</button><label>재생 속도<select className="final-select" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div>
    <div className="lab-scrubber"><button className="btn" aria-label="한 단계 이전" onClick={() => { setPlaying(false); setProgress(p => Math.max(0, p - 2)); }}>−</button><label><span>재생 위치 <strong>{Math.round(progress)}%</strong></span><input aria-label="재생 위치" type="range" min={0} max={100} step={1} value={progress} onChange={e => { setPlaying(false); setProgress(Number(e.target.value)); }} /></label><button className="btn" aria-label="한 단계 다음" onClick={() => { setPlaying(false); setProgress(p => Math.min(100, p + 2)); }}>＋</button></div>
    <p className="text-xs muted">재생률은 알고리즘별 기록의 진행 비율입니다. 실제 계산 속도 비교는 아래 측정값을 사용하세요. 기록은 일부 단계만 포함합니다.</p>
    <div className="lab-results"><div className="lab-section-title"><span className="lab-step">03</span><h2>이번 조건의 결과</h2></div>
      {!done ? <p className="muted">재생이 끝나면 알고리즘별 측정 결과를 비교합니다. 바로 확인하려면 <button className="lab-text-button" onClick={() => { setProgress(100); setPlaying(false); }}>결과 보기</button>를 누르세요.</p> : <>
        <div className="lab-insight"><strong>{trace.experimentId === "condition" ? current?.status === "NO_PATH" ? "도로를 막은 뒤 목적지에 도달할 수 없습니다." : trace.scenarioId === "normal" ? "정상 상태를 기준으로 혼잡·폐쇄 결과를 비교하세요." : changed ? "도로 조건이 달라지면서 선택한 경로도 바뀌었습니다." : "이번 출발·도착에서는 경로가 바뀌지 않았습니다." : sample?.algorithms.dfs?.status === "TIMEOUT" ? "DFS는 2초 안에 최적 경로를 확정하지 못했습니다." : "완료한 알고리즘들은 같은 최소 비용을 찾았습니다."}</strong>
          <p>Dijkstra {fmt(d?.objective_cost)}{trace.objective === "distance" ? "m" : "초"} · A* {fmt(a?.objective_cost)}{trace.objective === "distance" ? "m" : "초"}. {a?.median_expanded != null && d?.median_expanded != null ? `확정한 교차로는 각각 ${fmt(d.median_expanded, 0)}개와 ${fmt(a.median_expanded, 0)}개입니다.` : ""}</p></div>
        <div className="table-wrap"><table className="data"><caption className="text-left text-xs muted py-2">같은 조건 10회 측정의 중앙값 · 애니메이션 재생시간과 별도</caption><thead><tr><th>알고리즘</th><th>결과</th><th>최소 비용 {trace.objective === "distance" ? "m" : "초"}</th><th>검색시간 ms</th><th>작업량</th></tr></thead><tbody>{algorithms.map(id => { const m = medians.find(r => r.algorithm === id); return <tr key={id}><td>{names[id]}</td><td>{m?.timeout ? `${m.timeout}/10회 시간 초과` : m?.success === 10 ? "10/10회 완료" : "상세 표 확인"}</td><td>{fmt(m?.objective_cost)}</td><td>{fmt(m?.median_search_ns == null ? null : m.median_search_ns / 1e6, 3)}</td><td>{fmt(m?.median_expanded, 0)}</td></tr>; })}</tbody></table></div>
        <p className="text-xs muted mt-2">DFS 작업량 = 확인한 경로 접두 상태 수. Dijkstra/A* 작업량 = 확정 교차로 수. 시간 초과한 DFS의 비용·완료시간은 미확정입니다.</p>
        {trace.experimentId === "condition" && <div className="lab-condition-result"><p>정상 → 선택 조건: 경로 거리 {fmt(normal?.route_length_m)} → {fmt(current?.route_length_m)}m · 차량 추정시간 {fmt(normal?.estimated_scenario_s)} → {fmt(current?.estimated_scenario_s)}초</p><p>전체 {counts?.total}개 조건·출발도착 표본: 경로 변경 {counts?.route_changed}, 변화 없음 {counts?.unchanged}, 도달 불가 {counts?.no_path}. 한 사례가 전체 경향을 대표하지 않습니다.</p></div>}
      </>}
    </div>
  </section>;
}
