"use client";

import { useEffect, useRef, useState } from "react";
import type { FinalRoadJson } from "@/lib/study/finalGraph";
import type { ResearchRequest, ResearchResult } from "@/lib/study/research";
import ResearchPlayer from "./ResearchPlayer";

export default function ResearchLab({ mode }: { mode: "routes" | "replan" }) {
  const [road, setRoad] = useState<FinalRoadJson | null>(null);
  const [map, setMap] = useState<"demo" | "road">(mode === "replan" ? "road" : "demo");
  const [radius, setRadius] = useState(2000);
  const [objective, setObjective] = useState<"distance" | "time">("time");
  const [change, setChange] = useState<ResearchRequest["change"]>("few");
  const [multiplier, setMultiplier] = useState(3);
  const [includeNoPath, setIncludeNoPath] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [exportText, setExportText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [roadError, setRoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const worker = useRef<Worker | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/study/final/road.json").then(response => { if (!response.ok) throw new Error("조치원 도로를 불러오지 못했습니다."); return response.json(); })
      .then(data => { if (alive) setRoad(data); }).catch(e => { if (alive) setRoadError(String(e.message)); });
    return () => { alive = false; worker.current?.terminate(); };
  }, []);
  const settings: ResearchRequest = { mode, map, radius, objective, change, multiplier, includeNoPath, repeats: 10 };
  const changed = result && JSON.stringify(result.request) !== JSON.stringify(settings);
  const begin = () => {
    worker.current?.terminate(); setBusy(true); setError(""); setStatus("실험을 준비하는 중…");
    const instance = new Worker(new URL("../../lib/study/research.worker.ts", import.meta.url));
    worker.current = instance;
    instance.onmessage = event => {
      if (worker.current !== instance) return;
      if (event.data.type === "progress") setStatus(event.data.message);
      else if (event.data.type === "result") {
        setResult(event.data.result); setExportText(""); setStep(0); setUnlocked(0); setBusy(false); setStatus(""); instance.terminate(); worker.current = null;
      } else { setError("실험 계산 또는 정확성 검증에 실패했습니다: " + event.data.message); setBusy(false); instance.terminate(); worker.current = null; }
    };
    instance.onerror = () => { if (worker.current === instance) { setError("계산을 완료하지 못했습니다. 실험을 다시 실행해 주세요."); setBusy(false); instance.terminate(); worker.current = null; } };
    instance.postMessage({ ...settings, road: map === "road" ? road : undefined });
  };
  const cancel = () => { worker.current?.terminate(); worker.current = null; setBusy(false); setStatus("계산을 취소했습니다. 이전 결과는 보존됩니다."); };
  const exportResult = () => {
    if (!result) return;
    const json = JSON.stringify(result, null, 2); setExportText(json);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `route-lab-${mode}-${result.computedAt.replaceAll(":", "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const next = () => { const index = Math.min(step + 1, result!.steps.length - 1); setStep(index); setUnlocked(Math.max(index, unlocked)); };
  return <div className="research-lab">
    <section className="card research-settings"><h3>실험 조건</h3>
      <fieldset disabled={busy} className="lab-controls">
        <label>실험 지도<select value={map} onChange={e => setMap(e.target.value as typeof map)}><option value="demo">원리가 보이는 가상 도로 · 8개 교차로</option><option value="road">조치원 실제 도로망 · OSM</option></select></label>
        {map === "road" && <label>지도 반경<select value={radius} onChange={e => setRadius(Number(e.target.value))}><option value={500}>0.5km</option><option value={2000}>2km</option><option value={5000}>5km</option></select></label>}
        <label>혼잡 도로의 이동시간<select value={multiplier} onChange={e => setMultiplier(Number(e.target.value))}><option value={1.5}>정상의 1.5배</option><option value={3}>정상의 3배</option><option value={5}>정상의 5배</option></select></label>
        {mode === "replan" && <>
          <label>경로 선택 목표<select value={objective} onChange={e => setObjective(e.target.value as typeof objective)}><option value="time">추정 이동시간 최소</option><option value="distance">이동 거리 최소</option></select></label>
          <label>교통 변경 범위<select value={change} onChange={e => setChange(e.target.value as typeof change)}><option value="few">기존 경로의 도로만 변경</option><option value="many">기존 경로 + 지도 도로 약 20%</option><option value="outside">기존 경로 밖의 도로만 변경</option></select></label>
          <label className="research-checkbox"><input type="checkbox" checked={includeNoPath} onChange={e => setIncludeNoPath(e.target.checked)} />도달 불가 단계도 포함</label>
        </>}
      </fieldset>
      <p className="muted">{mode === "routes" ? "같은 A*로 거리 최소와 이동시간 최소 경로를 각각 계산합니다. 각 도로의 거리와 소요시간을 지도 아래에서 확인하세요." : "출발·도착은 고정합니다. 각 반복 안에서 CCH의 도로망 구조와 LPA*의 이전 탐색 상태를 유지하며 변경을 이어갑니다."}</p>
      <div className="research-actions"><button className="btn primary" disabled={busy || (map === "road" && !road)} onClick={begin}>{result ? "현재 조건으로 다시 계산" : "실험 계산하기"}</button>
        {busy && <button className="btn" onClick={cancel}>계산 취소</button>}<span role="status" aria-live="polite">{status}</span></div>
      {map === "road" && roadError && <p role="alert">{roadError}</p>}
      {error && <p role="alert" className="research-error">{error}</p>}
    </section>
    {result && <>
      {changed && <p className="card research-warning">조건이 변경됐습니다. 아래는 이전 조건의 결과입니다. ‘현재 조건으로 다시 계산’을 눌러 반영하세요.</p>}
      <section className="card research-timeline"><div className="research-context"><strong>{result.graph ? "가상 도로 · 시속 30km" : `조치원 반경 ${result.request.radius / 1000}km`}</strong>
        <span>교차로 {result.nodes.toLocaleString()}개 · 방향 도로 {result.edges.toLocaleString()}개</span><span>혼잡 {result.request.multiplier}배 · 같은 출발·도착</span></div>
        <nav aria-label="교통 변경 순서">{result.steps.map((event, i) => <button key={event.id} disabled={i > unlocked} aria-pressed={step === i} onClick={() => setStep(i)}>{event.label}</button>)}</nav>
        <p><strong>{result.steps[step].description}</strong></p><small>이전 단계에서 비용이 변경된 방향 도로: {result.steps[step].changedEdges}개{result.request.mode === "replan" && result.request.objective === "distance" && " · 혼잡만으로 거리 비용은 바뀌지 않습니다."}</small>
        <div className="research-actions"><button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>이전 상태</button>
          <button className="btn primary" disabled={step === result.steps.length - 1} onClick={next}>{step === result.steps.length - 1 ? "복구까지 완료" : "다음 교통 변경 적용 →"}</button>
          <button className="btn" onClick={exportResult}>측정 결과 저장</button></div>
        {exportText && <details className="research-export"><summary>저장할 결과 확인 · JSON</summary>
          <p>파일 저장이 시작되지 않는 브라우저에서는 아래 내용을 복사해서 .json 파일로 저장할 수 있습니다.</p>
          <label>현재 실험의 조건과 측정 결과<textarea readOnly value={exportText} rows={6} aria-label="저장할 실험 결과 JSON" /></label>
        </details>}
      </section>
      <ResearchPlayer key={result.computedAt + ":" + step} data={result} event={result.steps[step]} previous={result.steps[step - 1]} road={road} />
      {mode === "replan" && <details className="card research-method"><summary>사전 준비·누적 비용·여러 요청 비교</summary>
        <h3>사전 준비도 계산 비용입니다</h3><div className="table-wrap"><table className="data"><thead><tr><th>방식</th><th>준비 시간</th><th>저장한 추가 정보</th></tr></thead><tbody>{result.preparation.map(p => <tr key={p.algorithm}><th>{p.algorithm === "lpa" ? "LPA*" : p.algorithm.toUpperCase()}</th><td>{p.ms.toFixed(3)}ms</td><td>{p.algorithm === "cch" ? `추가 지름길 ${p.shortcuts.toLocaleString()}개 · 주요 배열 ${(p.storageBytes / 1024).toFixed(1)}KiB` : p.algorithm === "lpa" ? `g/rhs·비용·버전 배열 ${(p.storageBytes / 1024).toFixed(1)}KiB` : "직선거리 힌트 계수 · 매 요청 탐색 상태 생성"}</td></tr>)}</tbody></table></div>
        <p>주요 배열 크기에는 JavaScript 객체·삼각형 목록·우선순위 큐 등의 메모리가 포함되지 않습니다. 전체 메모리 사용량으로 해석하지 마세요.</p>
        <h3>한 지도에서 여러 출발·도착 요청</h3><div className="table-wrap"><table className="data"><thead><tr><th>요청 수</th><th>A* 준비 + 전체 요청</th><th>CCH 준비 + 전체 요청</th></tr></thead><tbody>{result.requests.map(row => <tr key={row.count}><th>{row.count}회</th><td>{row.astarMs.toFixed(3)}ms</td><td>{row.cchMs.toFixed(3)}ms</td></tr>)}</tbody></table></div>
        <p>정상 교통에서 서로 다른 출발·도착 요청을 처리합니다. 준비는 방식별 한 번, 검색 묶음은 워밍업 후 3회 중앙값입니다. LPA*는 이 실험의 같은 출발·도착 재탐색에서 별도로 평가합니다.</p>
      </details>}
      <details className="card research-method"><summary>실험 방법과 해석 범위</summary>
        <p>각 조건에서 워밍업 1회 후 {result.repeats}회 독립 반복합니다. 매 반복은 새 상태에서 시작하고, 그 안에서는 정상→혼잡→폐쇄→복구를 이어갑니다. 표의 시간은 중앙값, 범위는 가운데 50%입니다.</p>
        <p>계산 시간에는 탐색 상태 생성·변경 반영·경로 복원이 포함됩니다. CCH 비용 갱신과 검색을 나눠 기록하고, 누적 시간에는 최초 준비도 포함합니다. 입력 지도 가공, 정답 검증, 탐색 기록과 화면 재생은 측정에서 제외합니다.</p>
        <p>모든 반복·단계에서 다익스트라의 최적 비용과 대조하고 경로 연결·방향·폐쇄 도로 사용을 검증합니다. A*와 LPA*는 모든 단계에서 안전한 동일 직선거리 힌트를 사용하며, 동률에서는 작은 출발 비용·교차로 번호를 우선합니다. 같은 최적 비용의 다른 경로도 정답입니다.</p>
        <p>CCH는 좌표 기반 분할 순서를 사용하는 교육용 구현입니다. 산업 엔진의 정렬·병렬 처리 최적화와 다릅니다. 브라우저의 매우 짧은 시간 측정에는 해상도와 실행 환경의 영향을 받습니다. 탐색 횟수는 방식별 작업 정의가 달라 보조 지표로만 사용합니다.</p>
        <p>교통은 가상 조건이며 각 변경 단계 동안 고정됩니다. 추정 이동시간은 실제 주행 측정값이 아닙니다. 실제 지도 출처: OpenStreetMap contributors (ODbL){result.osmTimestamp && ` · ${result.osmTimestamp}`}.</p>
        <p><a href="https://arxiv.org/abs/1402.0402" target="_blank" rel="noreferrer">CCH 원 논문</a> · <a href="https://idm-lab.org/bib/abstracts/papers/aij04.pdf" target="_blank" rel="noreferrer">LPA* 원 논문</a></p>
      </details>
    </>}
    {!result && !busy && <section className="card research-empty"><h3>{mode === "routes" ? "짧은 길이 막히면 어느 길을 선택할까요?" : "이전 계산을 활용하면 얼마나 달라질까요?"}</h3><p>위에서 조건을 고르고 ‘실험 계산하기’를 누르세요. 정상 상태의 결과부터 한 단계씩 확인할 수 있습니다.</p></section>}
  </div>;
}
