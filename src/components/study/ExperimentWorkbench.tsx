"use client";

import { useEffect, useState } from "react";
import FinalStudyView, { type Objective, type Summary, type TraceFile, type RoadJson } from "./FinalStudyView";
import ExperimentPlayer from "./ExperimentPlayer";

const conditions = [{ id: "normal", label: "정상" }, { id: "congestion_1_5", label: "혼잡 1.5배" }, { id: "congestion_3_0", label: "혼잡 3배" }, { id: "closure_1", label: "폐쇄 1" }, { id: "closure_2", label: "폐쇄 2" }, { id: "closure_3", label: "폐쇄 3" }];
const fmt = (v: number | null | undefined, digits = 2) => v == null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: digits });
type Experiment = "synthetic" | "road" | "condition";
const experiments: { id: Experiment; title: string; detail: string }[] = [
  { id: "synthetic", title: "1. 교차로를 늘리면?", detail: "가상 도로 · 8 → 16 → 24개" },
  { id: "road", title: "2. 지도를 넓히면?", detail: "조치원 · 0.5 → 2 → 5km" },
  { id: "condition", title: "3. 도로가 막히면?", detail: "같은 5km 지도 · 혼잡과 폐쇄" },
];

export default function ExperimentWorkbench({ basicOnly = false }: { basicOnly?: boolean }) {
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
    <div className="lab-experiments" aria-label="지도 선택">{experiments.filter(e => !basicOnly || e.id !== "condition").map(e => <button key={e.id} aria-pressed={experiment === e.id} onClick={() => changeExperiment(e.id)}>
      <strong>{basicOnly ? e.id === "synthetic" ? "가상 도로" : "조치원 실제 도로" : e.title}</strong><span>{e.detail}</span></button>)}</div>
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
    <div className="lab-bottom"><button className="btn" onClick={() => { if (experiment !== "condition" && size < 2) setSize(size + 1); else changeExperiment(experiment === "synthetic" ? "road" : basicOnly ? "synthetic" : experiment === "road" ? "condition" : "synthetic"); }}>{experiment !== "condition" && size < 2 ? "다음 크기와 비교 →" : experiment === "synthetic" ? "실제 조치원 도로로 →" : basicOnly ? "가상 도로로 →" : experiment === "road" ? "혼잡·폐쇄 실험으로 →" : "처음 실험으로 →"}</button><button className="btn" aria-expanded={evidence} onClick={() => setEvidence(!evidence)}>{evidence ? "전체 측정표 닫기" : "전체 측정표·연구 방법 보기"}</button></div>
    {evidence && <FinalStudyView evidenceOnly />}
  </div>;
}
