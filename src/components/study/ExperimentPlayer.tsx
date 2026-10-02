"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Algorithm, Frame, RoadJson, Summary, TraceFile } from "./FinalStudyView";
import ExperimentMap from "./ExperimentMap";
import { formatMetres, frameAction, nodeText, playbackFrames, SimulationLegend } from "./SimulationAppearance";

const names: Record<Algorithm, string> = { dfs: "DFS", dijkstra: "Dijkstra", astar: "A*" };
const roles: Record<Algorithm, string> = { dfs: "한 갈래씩 끝까지 확인", dijkstra: "출발에서 가까운 순서", astar: "도착까지의 예상 비용 고려" };
const explanations: Record<Algorithm, string> = {
  dfs: "한 갈래를 따라가다가 되돌아와 다른 길을 확인합니다. 도착점을 한 번 찾았다고 끝나지 않습니다.",
  dijkstra: "출발점에서 비용이 가장 작은 교차로부터 확정합니다. 보라색은 지금 확정한 교차로까지의 길입니다.",
  astar: "지금까지의 비용과 도착점까지의 예상 비용을 함께 봅니다. 보라색은 현재 교차로까지 찾은 길입니다.",
};
const fmt = (value: number | null | undefined, digits = 1) => value == null ? "—" : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });

export default function ExperimentPlayer({ trace, road, summary }: { trace: TraceFile; road: RoadJson; summary: Summary }) {
  const [algorithm, setAlgorithm] = useState<Algorithm>(trace.experimentId === "condition" ? "dijkstra" : "dfs");
  const [frameIndex, setFrameIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullMap, setFullMap] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const algorithms = Object.keys(trace.runs) as Algorithm[];
  const run = trace.runs[algorithm]!;
  const frames = useMemo(() => playbackFrames(trace, algorithm), [trace, algorithm]);
  const frame: Frame | null = frameIndex < 0 ? null : frames[frameIndex] ?? null;
  const done = frames.length > 0 && frameIndex >= frames.length - 1;
  const isPlaying = playing && !done;
  const success = done && run.status === "SUCCESS";
  const lengths = trace.graph?.len ?? road.len;
  const to = trace.graph?.to ?? road.to;
  const lengthOf = (edges: number[]) => edges.reduce((sum, edge) => sum + (lengths[edge] ?? 0), 0);
  const route = success ? run.pathEdges : done ? frame?.best ?? [] : frame?.path ?? [];
  const routeLabel = route.length ? [trace.od.source, ...route.map(e => to[e])].map(v => nodeText(v, trace, true)).join(" → ") : "S";
  const sampled = frames.some((item, i) => i > 0 && item.step - frames[i - 1].step > 1);
  const skipped = frame && frameIndex > 0 ? Math.max(0, frame.step - frames[frameIndex - 1].step - 1) : 0;
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setTimeout(() => setFrameIndex(index => Math.min(frames.length - 1, index + 1)), Math.max(1100, 6000 / frames.length) / speed);
    return () => window.clearTimeout(timer);
  }, [isPlaying, frameIndex, frames.length, speed]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [frameIndex, algorithm]);
  const seek = (index: number) => { setFrameIndex(index); setPlaying(false); };
  const pick = (id: Algorithm) => { setAlgorithm(id); seek(-1); };
  const matches = (c: { experiment_id: string; size_label: string; objective: string; scenario_id: string; od_id: string }) =>
    c.experiment_id === trace.experimentId && c.size_label === trace.sizeLabel && c.objective === trace.objective && c.scenario_id === trace.scenarioId && c.od_id === trace.od.id;
  const sample = summary.cases.find(matches);
  const medians = summary.od_medians.filter(matches);
  const median = medians.find(m => m.algorithm === algorithm);
  const normal = summary.cases.find(c => c.experiment_id === "condition" && c.scenario_id === "normal" &&
    c.objective === trace.objective && c.od_id === trace.od.id)?.algorithms[algorithm];
  const scenario = summary.meta.scenarios.find(s => s.id === trace.scenarioId);
  const impacted = useMemo(() => new Set([...(scenario?.congestedEdgeIds ?? []), ...(scenario?.closedEdgeIds ?? [])]), [scenario]);
  const normalRoute = useMemo(() => normal?.route_edge_ids.split(" ").filter(Boolean) ?? [], [normal]);
  const currentRow = sample?.algorithms[algorithm];
  const changed = currentRow?.route_edge_ids !== normal?.route_edge_ids;
  const action = frame ? frameAction(trace, algorithm, frame, frames[frameIndex - 1], done) : "알고리즘을 고르고 재생을 눌러 시작하세요.";
  const status = success ? "최종 경로 확정" : done ? run.status === "TIMEOUT" ? "시간 초과 · 미확정" : "경로 없음" : isPlaying ? "탐색 재생 중" : frame ? "일시정지" : "재생 준비";

  return <section className="card lab-player">
    <div className="lab-section-title"><span className="lab-step">02</span><h2>탐색 과정</h2><span className="lab-status" role="status">{status}</span></div>
    <div className="lab-algorithms" aria-label="재생할 알고리즘">{algorithms.map(id =>
      <button key={id} aria-pressed={algorithm === id} onClick={() => pick(id)}><strong>{names[id]}</strong><span>{roles[id]}</span></button>)}</div>
    <p className="sim-algorithm-explanation">{explanations[algorithm]} {trace.objective === "time" ? "이번 실험의 비용 기준은 추정 이동시간입니다." : "이번 실험의 비용 기준은 도로 거리입니다."}</p>
    <SimulationLegend dfs={algorithm === "dfs"} condition={trace.experimentId === "condition"} />
    <div className="sim-playback-bar">
      <button className="btn btn-primary" disabled={!frames.length} onClick={() => { if (done || frameIndex < 0) setFrameIndex(0); setPlaying(!isPlaying); }}>
        {isPlaying ? "일시정지" : done ? "다시 재생" : names[algorithm] + " 재생"}</button>
      <button className="btn" onClick={() => seek(-1)}>처음</button>
      <button className="btn" onClick={() => seek(Math.max(-1, frameIndex - 1))} disabled={frameIndex < 0}>이전</button>
      <button className="btn" onClick={() => seek(Math.min(frames.length - 1, frameIndex + 1))} disabled={done || !frames.length}>한 장면씩</button>
      <button className="btn" onClick={() => seek(frames.length - 1)} disabled={!frames.length}>결과 보기</button>
      <label>화면 재생 속도<select className="final-select" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
        <option value={0.25}>아주 느리게</option><option value={0.5}>느리게</option><option value={1}>기본</option><option value={2}>빠르게</option>
      </select></label>
    </div>
    <div className="sim-progress"><label htmlFor={"sim-progress-" + trace.od.id}>장면 {frameIndex + 1} / {frames.length}</label>
      <input id={"sim-progress-" + trace.od.id} aria-label="재생 위치" type="range" min={0} max={frames.length} step={1} value={frameIndex + 1}
        onChange={e => seek(Number(e.target.value) - 1)} />
      <span>화면 속도 ≠ 실제 계산시간</span></div>
    <div className={"sim-now " + (success ? "is-final" : done ? "is-stopped" : "")}>
      <div><span className="sim-now-label">{done ? "탐색 결과" : "지금 무슨 일이 일어나나요?"}</span><strong>{action}</strong>
        {skipped > 0 && <small>이전 장면 이후 {fmt(skipped, 0)}회 계산을 건너뛴 요약 장면입니다.</small>}</div>
      <dl><div><dt>지금 보는 곳</dt><dd>{done ? "탐색 종료" : frame ? nodeText(frame.current, trace) : "대기"}</dd></div>
        <div><dt>지금까지 본 교차로</dt><dd>{fmt(frame?.visited ?? 0, 0)}개</dd></div></dl>
    </div>
    <div className="lab-stage-heading"><strong>{names[algorithm]} · {success ? "최종 경로" : done ? "탐색 종료 화면" : "탐색 지도"}</strong>
      {!trace.graph && <button className="btn" onClick={() => setFullMap(v => !v)}>{fullMap ? "탐색 위치 확대" : "전체 실험 범위"}</button>}</div>
    {!trace.graph && <div className="sim-map-options">
      <span>{fullMap ? "전체 범위 고정" : done ? "표시된 경로가 한눈에 들어오도록 확대" : "현재 교차로를 중심으로 자동 확대 · 범위 밖 S/T는 전체 보기에서 확인"}</span>
      {trace.experimentId === "condition" && <label><input type="checkbox" checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} />정상 경로 겹쳐 보기 · 회색 점선</label>}
    </div>}
    <div className="lab-stage">
      <div className="lab-visual"><ExperimentMap key={algorithm} trace={trace} road={road} algorithm={algorithm} frame={frame} done={done} full={fullMap}
        normalRoute={normalRoute} impacted={impacted} showBaseline={showBaseline} /></div>
      <aside className="lab-trace-panel" aria-label={names[algorithm] + " 탐색 순서"}>
        <div className="lab-trace-title"><h3>탐색 순서</h3><span>{frameIndex + 1}장면 확인</span></div>
        <p className="sim-log-help">항목을 누르면 그 장면으로 돌아갑니다.</p>
        <div className={"sim-path-summary " + (success ? "is-final" : done ? "is-stopped" : "")}>
          <span>{success ? "✓ 최종 경로" : done ? run.status === "NO_PATH" ? "도달 가능한 경로 없음" : "미확정 후보" : "현재 교차로까지의 길"}</span>
          <strong>{route.length ? formatMetres(lengthOf(route)) : frame && !done ? "0m · 출발점" : "아직 없음"}</strong>
          <p>{route.length || frame && !done ? routeLabel : "경로를 찾으면 여기에 표시됩니다."}</p>
        </div>
        <ol ref={logRef} className="lab-trace-list">
          {frameIndex < 0 && <li className="sim-log-empty">재생하면 확인한 교차로가 순서대로 쌓입니다.</li>}
          {frames.slice(0, frameIndex + 1).map((item, i) => {
            const last = i === frames.length - 1, gap = i > 0 ? item.step - frames[i - 1].step - 1 : 0;
            return <li key={i} className={i === frameIndex ? "is-current" : ""}>
              <button onClick={() => seek(i)} aria-label={"장면 " + (i + 1) + " 보기"} aria-current={i === frameIndex ? "step" : undefined}>
                <span className="sim-log-number">{i + 1}</span><div>
                  <strong>{last ? run.status === "SUCCESS" ? "✓ 최종 경로 확정" : run.status === "NO_PATH" ? "탐색 종료 · 경로 없음" : "탐색 종료 · 미확정" : nodeText(item.current, trace)}</strong>
                  <span>{last ? run.status === "SUCCESS" ? formatMetres(lengthOf(run.pathEdges)) + " · 탐색 완료" :
                    run.status === "TIMEOUT" ? "2초 안에 최단 경로를 확정하지 못함" : "연결 가능한 경로 없음" :
                    algorithm === "dfs" ? item.current === trace.od.target ? "도착 경로 발견 · 계속 탐색" : "이곳까지 " + formatMetres(lengthOf(item.path)) + " 경로 확인" :
                    "이곳까지 최소 비용 확정 · 거리 " + formatMetres(lengthOf(item.path))}</span>
                  {gap > 0 && <small>중간 계산 {fmt(gap, 0)}회 생략</small>}
                </div>
              </button>
            </li>;
          })}
        </ol>
        <p className="lab-map-note">{sampled ? "계산량이 많아 일부 장면만 저장했습니다. 목록은 연속된 모든 방문을 뜻하지 않습니다." : "위에서 아래로 실제 탐색 순서입니다."}</p>
      </aside>
    </div>
    <div className="lab-results"><div className="lab-section-title"><span className="lab-step">03</span><h2>{names[algorithm]} 결과</h2></div>
      {!done ? <p className="muted">재생이 끝나면 최종 경로와 실제 계산시간을 표시합니다. <button className="lab-text-button" onClick={() => seek(frames.length - 1)}>결과 바로 보기</button></p> : <>
        <div className={"sim-result-banner " + (success ? "is-final" : "is-stopped")}>
          <strong>{success ? "✓ " + (trace.objective === "distance" ? "가장 짧은 경로를 확정했습니다." : "추정 이동시간이 가장 짧은 경로를 확정했습니다.") :
            run.status === "TIMEOUT" ? "2초 제한으로 중단했습니다. 최단 경로는 아직 모릅니다." : "이 조건에서는 도착점까지 연결되는 경로가 없습니다."}</strong>
          <p>{success ? "지도 위 초록색 굵은 선이 최종 답입니다." : frame?.best?.length ? "황토색 점선은 중단 전 발견한 후보입니다. 최적의 답으로 확정된 길은 아닙니다." : "확정된 경로가 없어 초록색 선을 표시하지 않습니다."}</p>
        </div>
        <div className="sim-result-metrics">
          <div><span>최종 경로 거리</span><strong>{success ? formatMetres(lengthOf(run.pathEdges)) : run.status === "NO_PATH" ? "경로 없음" : "미확정"}</strong></div>
          <div><span>차량 추정 이동시간</span><strong>{success ? fmt(currentRow?.estimated_scenario_s ?? (trace.objective === "time" ? run.objectiveCost : null)) + "초" : run.status === "NO_PATH" ? "경로 없음" : "미확정"}</strong><small>도로 속도와 선택 조건으로 계산한 추정치</small></div>
          <div><span>경로 정확성</span><strong>{success ? "최적 비용 검증" : run.status === "NO_PATH" ? "도달 불가" : "미확정"}</strong><small>{success ? "같은 목표의 알고리즘 간 비용·경로 유효성 검증" : "시간 초과 후보는 최적 경로로 평가하지 않음"}</small></div>
          <div><span>컴퓨터 계산시간</span><strong>{run.status === "TIMEOUT" ? "2초 제한" : median?.median_search_ns == null ? "—" : fmt(median.median_search_ns / 1e6, 3) + "ms"}</strong><small>{run.status === "TIMEOUT" ? "완료 전에 제한시간으로 중단" : "같은 조건 10회 측정 중앙값"}</small></div>
        </div>
        {trace.experimentId === "condition" && <div className="sim-condition-summary">
          <strong>{run.status === "TIMEOUT" ? "도로 조건 변경 후 최단 경로를 제한시간 안에 확정하지 못했습니다." : run.status === "NO_PATH" ? "도로 조건 변경 후 도달 가능한 경로가 없습니다." : trace.scenarioId === "normal" ? "정상 도로의 기준 결과입니다." :
            changed ? "정상 상태와 다른 경로를 선택했습니다." : "도로 조건이 달라져도 같은 경로를 선택했습니다."}</strong>
          <p>정상 → 현재: 경로 거리 {fmt(normal?.route_length_m)} → {fmt(currentRow?.route_length_m)}m · 차량 추정시간 {fmt(normal?.estimated_scenario_s)} → {fmt(currentRow?.estimated_scenario_s)}초</p>
          {trace.objective === "distance" && trace.scenarioId.startsWith("congestion") && <p>혼잡은 이동시간만 바꿉니다. 거리 기준으로 찾으면 선택 경로가 같을 수 있습니다.</p>}
        </div>}
        <details className="sim-comparison"><summary>다른 알고리즘과 수치 비교</summary>
          <div className="table-wrap"><table className="data"><caption>같은 조건 10회 측정 중앙값 · 애니메이션 시간과 별도</caption>
            <thead><tr><th>알고리즘</th><th>완료 여부</th><th>{trace.objective === "distance" ? "최소 거리 (m)" : "최소 추정시간 (초)"}</th><th>계산시간 (ms)</th><th>탐색 작업 횟수</th></tr></thead>
            <tbody>{algorithms.map(id => { const m = medians.find(r => r.algorithm === id); return <tr key={id} className={id === algorithm ? "sim-selected-row" : ""}>
              <th>{names[id]}{id === algorithm && " · 선택"}</th><td>{m?.timeout ? m.timeout + "/10회 시간 초과" : m?.success === 10 ? "10/10회 완료" : "도달 불가 또는 미완료"}</td>
              <td>{fmt(m?.objective_cost)}</td><td>{fmt(m?.median_search_ns == null ? null : m.median_search_ns / 1e6, 3)}</td><td>{fmt(m?.median_expanded, 0)}</td></tr>; })}</tbody>
          </table></div>
          <p>DFS는 확인한 경로 상태 수, Dijkstra와 A*는 비용을 확정한 교차로 수를 셉니다. DFS는 같은 교차로를 다른 경로로 여러 번 확인할 수 있습니다.</p>
        </details>
      </>}
    </div>
  </section>;
}
