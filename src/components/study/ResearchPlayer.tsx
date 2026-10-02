"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FinalRoadJson } from "@/lib/study/finalGraph";
import type { ResearchAlgorithm, ResearchResult, ResearchRun, ResearchStep } from "@/lib/study/research";
import type { RoadJson, TraceFile } from "./FinalStudyView";
import ExperimentMap from "./ExperimentMap";
import { SimulationLegend, formatMetres } from "./SimulationAppearance";

const names: Record<ResearchAlgorithm, string> = { astar: "A*", cch: "CCH", lpa: "LPA*" };
const descriptions: Record<ResearchAlgorithm, string> = {
  astar: "변경된 비용으로 새 탐색 상태를 만들고 목적지를 향해 다시 탐색합니다.",
  cch: "미리 만든 도로망 계층을 유지합니다. 변경된 비용의 영향을 받는 지름길 비용을 갱신한 뒤 출발·도착 양쪽에서 상위 계층을 검색합니다.",
  lpa: "이전 교차로 비용과 계산 상태를 유지합니다. 변경으로 비용이 맞지 않게 된 부분을 찾아 수정합니다.",
};
const ms = (value: number) => value === 0 ? "해상도 미만" : value < 0.001 ? "<0.001ms" : value.toFixed(3) + "ms";
const travel = (value: number | null) => value == null ? "경로 없음" : (value / 60).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "분";
const emptyRoad: RoadJson = { meta: { center: [0, 0] }, lat: [], lng: [], from: [], to: [], len: [], geomStart: [], geom: [], edgeId: [] };

export default function ResearchPlayer({ data, event, previous, road }: {
  data: ResearchResult; event: ResearchStep; previous?: ResearchStep; road: FinalRoadJson | null;
}) {
  const [selection, setSelection] = useState(data.request.mode === "routes" ? "astar:distance" : "astar:" + data.request.objective);
  const run = event.runs.find(r => r.algorithm + ":" + r.objective === selection)!;
  return <section className="card research-player">
    <div className="lab-algorithms" aria-label={data.request.mode === "routes" ? "경로 선택 기준" : "재탐색 알고리즘"}>
      {event.runs.map(r => { const id = r.algorithm + ":" + r.objective; return <button key={id} aria-pressed={selection === id} onClick={() => setSelection(id)}>
        <strong>{data.request.mode === "routes" ? r.objective === "distance" ? "거리가 가장 짧은 길" : "이동시간이 가장 짧은 길" : names[r.algorithm]}</strong>
        <span>{data.request.mode === "routes" ? "A* · 같은 도로 상태" : r.algorithm === "astar" ? "새로 탐색" : r.algorithm === "cch" ? "도로망 사전 준비" : "이전 탐색 재사용"}</span>
      </button>; })}
    </div>
    <Playback key={selection} data={data} event={event} run={run} previous={previous} road={road} />
    <div className="research-comparison"><h3>{data.request.mode === "routes" ? "같은 교통상황에서 두 경로 비교" : "같은 최적 비용을 얻는 데 든 계산 비용"}</h3>
      <div className="table-wrap"><table className="data"><caption>{data.repeats}회 중앙값 · ms는 컴퓨터 계산, 분은 차량 추정 이동시간</caption>
        <thead><tr><th>{data.request.mode === "routes" ? "경로 기준" : "알고리즘"}</th><th>정확성</th><th>이동 거리</th><th>추정 이동시간</th><th>이번 계산</th>{data.request.mode === "replan" && <th>준비 포함 누적</th>}</tr></thead>
        <tbody>{event.runs.map(r => <tr key={r.algorithm + r.objective} className={r === run ? "sim-selected-row" : ""}>
          <th>{data.request.mode === "routes" ? r.objective === "distance" ? "거리 최소" : "이동시간 최소" : names[r.algorithm]}</th>
          <td>{r.status === "SUCCESS" ? "최적 비용 검증" : "도달 불가 검증"}</td><td>{r.distanceM == null ? "경로 없음" : formatMetres(r.distanceM)}</td><td>{travel(r.travelS)}</td><td>{ms(r.responseMs)}</td>
          {data.request.mode === "replan" && <td>{ms(r.cumulativeMs)}</td>}
        </tr>)}</tbody></table></div>
      <Outcome data={data} event={event} />
      {data.request.mode === "replan" && <CumulativeChart data={data} current={event} />}
    </div>
  </section>;
}

function Playback({ data, event, run, previous, road }: { data: ResearchResult; event: ResearchStep; run: ResearchRun; previous?: ResearchStep; road: FinalRoadJson | null }) {
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [full, setFull] = useState(false), [overlay, setOverlay] = useState(true), [shortcuts, setShortcuts] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const frames = useMemo(() => [{ step: 0, visited: 0, current: data.source, path: [] as number[], best: null }, ...(run.trace?.frames ?? [])], [data.source, run.trace]);
  const done = index === frames.length - 1, frame = frames[index];
  useEffect(() => {
    if (!playing || done) return;
    const interval = window.setInterval(() => setIndex(i => {
      const next = Math.min(frames.length - 1, i + 1); if (next === frames.length - 1) setPlaying(false); return next;
    }), 1100 / speed);
    return () => window.clearInterval(interval);
  }, [playing, done, frames.length, speed]);
  useEffect(() => {
    const list = logRef.current, item = list?.querySelector('[aria-current="step"]');
    if (!list || !item) return;
    const a = list.getBoundingClientRect(), b = item.getBoundingClientRect();
    if (b.bottom > a.bottom || b.top < a.top) list.scrollTop += b.top - a.top - list.clientHeight / 2;
  }, [index]);
  const counterpart = data.request.mode === "routes" ? event.runs.find(r => r.objective !== run.objective) : previous?.runs.find(r => r.algorithm === run.algorithm && r.objective === run.objective);
  const edges = data.graph ?? road ?? emptyRoad;
  const edgeId = (e: number) => edges.edgeId[e];
  const baseline = counterpart?.pathEdges.map(edgeId) ?? [];
  const closed = useMemo(() => new Set(event.closedIds), [event.closedIds]);
  const impacted = useMemo(() => new Set(event.impactedIds), [event.impactedIds]);
  const edgeTimes = (data.graph?.freeFlowS ?? road?.freeFlowS ?? []).map((t, e) => closed.has(edgeId(e)) ? Infinity : impacted.has(edgeId(e)) ? t * data.request.multiplier : t);
  const trace: TraceFile = { experimentId: "research", sizeLabel: data.graph ? "demo" : "r" + data.request.radius,
    radiusM: data.request.radius, objective: run.objective, scenarioId: event.id, od: { id: "research", source: data.source, target: data.target },
    graph: data.graph, runs: { astar: { status: run.status, objectiveCost: run.cost, bestSoFar: null, pathEdges: run.pathEdges,
      expandedCount: run.expanded, uniqueVisited: run.unique, completePaths: null, trace: run.trace } } };
  const seek = (i: number) => { setPlaying(false); setIndex(Math.max(0, Math.min(frames.length - 1, i))); };
  const nodeLabel = (v: number) => v < 0 ? "없음" : v === data.source ? "출발 S" : v === data.target ? "도착 T" : "교차로 " + (data.graph ? v + 1 : v);
  const action = done ? run.status === "NO_PATH" ? "도달 가능한 경로가 없음을 확인했습니다." : "선택한 목표의 최적 경로를 확정했습니다." : index === 0 ? "재생을 눌러 이번 계산 과정을 확인하세요." :
    run.algorithm === "lpa" ? "이전 비용과 변경된 비용의 불일치를 수정합니다." : run.algorithm === "cch" ? "출발·도착 양쪽에서 상위 계층의 교차로를 검색합니다." : "출발부터의 최소 비용을 확정하며 목적지로 탐색합니다.";
  return <>
    <p className="sim-algorithm-explanation">{descriptions[run.algorithm]} 목표: {run.objective === "time" ? "추정 이동시간 최소" : "이동 거리 최소"}.</p>
    {run.algorithm === "cch" && <div className="research-reuse-note"><strong>먼저 비용 갱신 {ms(run.updateMs)} → 검색·경로 복원 {ms(run.searchMs)}</strong><span>이번 갱신에서 검사한 방향 지름길 비용 {run.updatedArcs.toLocaleString()}개 · 최초 준비 시간은 아래 별도 표에 표시</span></div>}
    {run.algorithm === "lpa" && <div className="research-reuse-note"><strong>이전 비용을 유지하고 재처리하지 않은 교차로 {run.reused.length.toLocaleString()}개</strong><span>이번 단계의 처리 {run.expanded.toLocaleString()}회 · 청록색 점선 테두리는 재사용한 교차로입니다.</span></div>}
    <SimulationLegend condition={event.impactedIds.length > 0} traffic pathLabel={run.algorithm === "cch" ? "검색 중인 구간 · 출발 쪽 / 도착 쪽" : "현재 교차로까지의 길"} />
    <div className="sim-playback-bar"><button className="btn primary" onClick={() => { if (done) setIndex(0); setPlaying(v => !v); }}>{playing ? "일시정지" : done ? "다시 재생" : "탐색 재생"}</button>
      <button className="btn" onClick={() => seek(0)}>처음</button><button className="btn" disabled={index === 0} onClick={() => seek(index - 1)}>이전 단계</button>
      <button className="btn" disabled={done} onClick={() => seek(index + 1)}>다음 단계</button><button className="btn" onClick={() => seek(frames.length - 1)}>결과 보기</button>
      <label>재생 속도<select value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[0.25, 0.5, 1, 2].map(s => <option key={s} value={s}>{s}배</option>)}</select></label>
    </div>
    <div className="sim-progress"><span>장면 {index + 1}/{frames.length}</span><input aria-label="탐색 재생 위치" type="range" min={0} max={frames.length - 1} value={index} onChange={e => seek(Number(e.target.value))} /><span>재생 시간은 계산 시간과 별도입니다.</span></div>
    <div className={"sim-now " + (done ? run.status === "SUCCESS" ? "is-final" : "is-stopped" : "")}><div><span className="sim-now-label">{names[run.algorithm]} · 현재 작업</span><strong>{action}</strong><small>{done ? "계산은 아래 측정 결과로 비교합니다." : nodeLabel(frame.current)}</small></div></div>
    <div className="sim-map-options"><label><input type="checkbox" checked={full} onChange={e => setFull(e.target.checked)} />전체 지도 보기</label>
      <label><input type="checkbox" disabled={!counterpart} checked={overlay && !!counterpart} onChange={e => setOverlay(e.target.checked)} />{data.request.mode === "routes" ? "다른 기준의 최종 경로 · 회색 점선" : "변경 전 경로 · 회색 점선"}</label>
      {run.algorithm === "cch" && <label><input type="checkbox" checked={shortcuts} onChange={e => setShortcuts(e.target.checked)} />최종 계산의 지름길 링크 · 보라색 점선</label>}
    </div>
    <div className="lab-visual-row"><div className="lab-visual"><ExperimentMap trace={trace} road={road ?? emptyRoad} algorithm="astar" frame={frame} done={done} full={full}
      normalRoute={baseline} impacted={impacted} showBaseline={overlay} closedIds={closed} edgeTimes={edgeTimes}
      reusable={run.algorithm === "lpa" ? run.reused : undefined} shortcuts={run.algorithm === "cch" && shortcuts ? run.links : undefined} useCoordinates />
      {run.algorithm === "cch" && <p className="lab-map-note">보라색 링크는 여러 실제 도로를 묶은 계산용 연결입니다. 초록색 최종 경로는 실제 도로 구간으로 복원한 결과입니다.</p>}</div>
      <aside className="lab-trace-panel"><div className="lab-trace-title"><h3>이번 탐색 순서</h3><span>{names[run.algorithm]}</span></div>
        <p className="sim-log-help">재생한 순서대로 쌓입니다. 항목을 누르면 해당 장면으로 돌아갑니다.</p>
        <ol ref={logRef} className="lab-trace-list">{frames.slice(0, index + 1).map((item, i) => <li key={i} className={i === index ? "is-current" : ""}>
          <button aria-current={i === index ? "step" : undefined} onClick={() => seek(i)}><span className="sim-log-number">{i + 1}</span><div>
            <strong>{i === frames.length - 1 ? run.status === "SUCCESS" ? "최종 경로 확정" : "도달 불가 확인" : i === 0 ? "탐색 준비" : nodeLabel(item.current)}</strong>
            <small>{i === 0 ? event.label : `처리 순서 ${item.step} · 이번 탐색 교차로 ${item.visited}개`}</small>
          </div></button></li>)}</ol>
        <p className="lab-map-note">작업량이 많으면 일부 장면만 기록합니다. CCH는 양쪽 검색의 방문 순서, LPA*는 재처리 순서입니다.</p>
      </aside></div>
    <div className="sim-result-metrics">
      <div><span>경로 정확성</span><strong>{run.status === "SUCCESS" ? "최적 비용 검증" : "도달 불가 검증"}</strong><small>다익스트라 기준 · 모든 측정 반복 검증</small></div>
      <div><span>이번 컴퓨터 계산</span><strong>{ms(run.responseMs)}</strong><small>변경 반영 + 검색 + 경로 복원</small></div>
      <div><span>경로 이동 거리</span><strong>{run.distanceM == null ? "경로 없음" : formatMetres(run.distanceM)}</strong></div>
      <div><span>차량 추정 이동시간</span><strong>{travel(run.travelS)}</strong><small>가상 교통 조건 · 실제 주행 측정 아님</small></div>
    </div>
    <p className="research-timing-range">이번 계산의 가운데 50%: {ms(run.q1Ms)} ~ {ms(run.q3Ms)} · 애니메이션 기록은 측정에서 제외합니다.</p>
  </>;
}

function Outcome({ data, event }: { data: ResearchResult; event: ResearchStep }) {
  if (event.runs.every(r => r.status === "NO_PATH")) return <div className="sim-condition-summary"><strong>모든 방식이 도달 불가를 정확하게 확인했습니다.</strong><p>통행 가능한 연결이 없으므로 이동 거리와 이동시간은 0으로 표시하지 않습니다.</p></div>;
  if (data.request.mode === "routes") {
    const distance = event.runs.find(r => r.objective === "distance")!, time = event.runs.find(r => r.objective === "time")!;
    const extra = time.distanceM! - distance.distanceM!, saved = distance.travelS! - time.travelS!;
    return <div className="sim-condition-summary"><strong>{saved > 1e-6 ? `이동시간 최소 경로: ${formatMetres(Math.max(0, extra))} 더 이동하고 ${travel(saved)} 절약` : "이 조건에서는 두 기준의 추정 이동시간이 같습니다."}</strong>
      <p>경로 선택 목표를 바꾼 결과입니다. 같은 A*를 사용했으며, 폐쇄된 도로는 두 기준에서 모두 제외합니다.</p></div>;
  }
  const fastest = [...event.runs].sort((a, b) => a.responseMs - b.responseMs)[0];
  const tied = event.runs.filter(r => r.responseMs === fastest.responseMs).length > 1;
  return <div className="sim-condition-summary"><strong>{tied ? "같은 최적 비용을 얻었고, 이번 계산시간에는 동률이 있습니다." : "같은 목표의 최적 비용을 유지했습니다. 이번 계산 중앙값이 가장 작은 방식: " + names[fastest.algorithm]}</strong>
    <p>사전 준비를 포함한 누적 시간도 함께 비교하세요. 작은 교통 변경과 넓은 변경, 최초 계산과 반복 계산에서 결과가 달라질 수 있습니다.</p></div>;
}

function CumulativeChart({ data, current }: { data: ResearchResult; current: ResearchStep }) {
  const step = data.steps.indexOf(current), events = data.steps.slice(0, step + 1), max = Math.max(0.001, ...events.flatMap(e => e.runs.map(r => r.cumulativeMs)));
  const paint = { astar: "#b45309", cch: "#6d28d9", lpa: "#0f766e" };
  return <figure className="research-chart"><figcaption>준비부터 현재 단계까지 누적 계산시간 · 낮을수록 적은 계산 비용</figcaption>
    <svg viewBox="0 0 600 245" role="img" aria-label="A*, CCH, LPA*의 준비 포함 누적 계산시간. 정확한 값은 위 표에서 확인할 수 있습니다.">
      {[0, 0.5, 1].map(v => <g key={v}><line x1={70} x2={570} y1={195 - v * 155} y2={195 - v * 155} stroke="#cbd5e1" /><text x={62} y={199 - v * 155} textAnchor="end" fontSize={12} fill="#475569">{(max * v).toFixed(2)}ms</text></g>)}
      {(["astar", "cch", "lpa"] as const).map(algorithm => { const points = events.map((e, i) => ({ x: 80 + i * 480 / Math.max(1, data.steps.length - 1), y: 195 - e.runs.find(r => r.algorithm === algorithm)!.cumulativeMs / max * 155 })); return <g key={algorithm}>
        <polyline points={points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={paint[algorithm]} strokeWidth={3} strokeDasharray={algorithm === "cch" ? "7 4" : algorithm === "lpa" ? "2 4" : undefined} />
        {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} fill={paint[algorithm]} />)}
      </g>; })}
      {data.steps.map((e, i) => <text key={e.id} x={80 + i * 480 / Math.max(1, data.steps.length - 1)} y={220} textAnchor="middle" fontSize={12} fill="#475569">{e.label}</text>)}
    </svg><div className="research-chart-legend">{(["astar", "cch", "lpa"] as const).map(a => <span key={a} style={{ color: paint[a] }}>{names[a]} · {a === "astar" ? "실선" : a === "cch" ? "긴 점선" : "짧은 점선"}</span>)}</div>
  </figure>;
}
