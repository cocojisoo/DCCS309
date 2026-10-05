"use client";

import { useEffect, useRef, useState } from "react";
import { formatDistance, formatInt, formatMs } from "@/lib/format";
import type { DemoFile, DemoIndexEntry } from "@/lib/study/demo";
import type { StudyGraphJson } from "@/lib/study/graph";
import type { ChangeScope, ExperimentKind, ExperimentProgress, ExperimentRequest, ExperimentResult, ExperimentScenario } from "@/lib/study/routingExperiments";
import type { ExperimentMessage } from "@/lib/study/routingExperiment.worker";
import ExperimentReplay from "./ExperimentReplay";
import LogChart from "./LogChart";
import { ALGO_STYLE, fetchJson } from "./shared";
import { formatExperimentMs } from "./experimentFormat";

const NAME = { astar: "A*", cch: "CCH", lpa: "LPA*" };

export default function RoutingExperimentView({ kind }: { kind: ExperimentKind }) {
  const [json, setJson] = useState<StudyGraphJson | null>(null);
  const [index, setIndex] = useState<DemoIndexEntry[]>([]);
  const [sizeLabel, setSizeLabel] = useState("r3000");
  const [file, setFile] = useState<DemoFile | null>(null);
  const [pairIdx, setPairIdx] = useState(0);
  const [count, setCount] = useState(kind === "many-queries" ? 100 : 30);
  const [scope, setScope] = useState<ChangeScope>("local");
  const [scenario, setScenario] = useState<ExperimentScenario>("congestion");
  const [seed, setSeed] = useState(309);
  const [result, setResult] = useState<ExperimentResult | null>(null);
  const [progress, setProgress] = useState<ExperimentProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const [runId, setRunId] = useState(0);
  const many = kind === "many-queries";
  const entry = index.find((e) => e.label === sizeLabel);
  const selectedFile = file?.label === sizeLabel ? file : null;
  const pair = selectedFile?.pairs[pairIdx];

  useEffect(() => {
    let alive = true;
    Promise.all([fetchJson<StudyGraphJson>("/graph/study.json"), fetchJson<DemoIndexEntry[]>("/study/traces/index.json")]).then(([g, idx]) => {
      if (!alive) return;
      const sizes = idx?.filter((e) => e.nodes >= 500) ?? [];
      if (!g || !sizes.length) { setError("기존 조치원 지도 데이터를 불러올 수 없습니다."); return; }
      setJson(g);
      setIndex(sizes);
      if (!sizes.some((e) => e.label === "r3000")) setSizeLabel(sizes.at(-1)!.label);
    }).catch(() => alive && setError("지도 데이터를 불러오지 못했습니다. 페이지를 새로고침하세요."));
    return () => { alive = false; workerRef.current?.terminate(); };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchJson<DemoFile>(`/study/traces/${sizeLabel}.json`).then((d) => {
      if (!alive) return;
      setFile(d);
      if (!d?.pairs.length) setError("선택한 크기의 기존 지도 데이터가 없습니다.");
    }).catch(() => alive && setError("선택한 지도 데이터를 불러오지 못했습니다."));
    return () => { alive = false; };
  }, [sizeLabel]);

  const invalidate = () => { setResult(null); setProgress(null); setError(null); };
  const cancel = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setProgress(null);
  };
  const start = () => {
    if (!json || !selectedFile || !pair) return;
    invalidate();
    setBusy(true);
    setRunId((id) => id + 1);
    setProgress({ stage: "실험 준비", completed: 0, total: count });
    try {
      const worker = new Worker(new URL("../../lib/study/routingExperiment.worker.ts", import.meta.url));
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<ExperimentMessage>) => {
        if (workerRef.current !== worker) return;
        const message = event.data;
        if (message.type === "progress") { setProgress(message.progress); return; }
        if (message.type === "result") setResult(message.result);
        else setError(message.message);
        setBusy(false);
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
      };
      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        setError("실험을 실행하지 못했습니다. 다시 실행해 주세요.");
        cancel();
      };
      const request: ExperimentRequest = { kind, json, edgeIds: selectedFile.edgeIds, source: pair.od.source, target: pair.od.target, count, scope, scenario, seed, repeats: 5 };
      worker.postMessage(request);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실험을 시작하지 못했습니다.");
      cancel();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3" aria-busy={busy}>
        <h2 className="font-semibold">{many ? "A* ↔ CCH · 여러 사용자의 경로 요청" : "A* ↔ LPA* · 같은 경로의 연속 재탐색"}</h2>
        <p className="text-sm muted">
          {many ? <>같은 교통 정보를 공유하는 <b>서로 다른 출발·도착 요청</b>을 실제로 계산합니다. A*는 요청마다 새로 탐색하고, CCH는 한 번 만든 지름길을 모든 요청에 사용합니다.</>
            : <>같은 출발·도착에서 <b>혼잡 → 폐쇄 → 해소</b>를 연속 적용합니다. A*는 매번 새로 탐색하고, LPA*는 첫 계획과 이전 변화의 계산을 계속 유지합니다.</>}
        </p>
        <p className="text-xs faint">목표는 차량의 최소 이동시간입니다. 정상 도로는 30km/h, 혼잡은 이동시간 ×4, 폐쇄는 통행 불가입니다. 거리도 함께 표시하지만 최단거리와 최소 이동시간은 다를 수 있습니다.</p>
        <fieldset disabled={busy} className="flex flex-col gap-3">
          <legend className="sr-only">실험 조건</legend>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold">지도 크기: {entry?.title ?? "불러오는 중…"} <span className="muted font-normal">· 교차로 {formatInt(entry?.nodes ?? 0)}개 · 도로 {formatInt(entry?.edges ?? 0)}개</span></span>
            <select className="tab self-start" value={sizeLabel} onChange={(e) => { setSizeLabel(e.target.value); setPairIdx(0); invalidate(); }} aria-label="실험 지도 크기">
              {index.map((e) => <option key={e.label} value={e.label}>{e.title} · 교차로 {formatInt(e.nodes)}개</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm flex items-center gap-2">
              {many ? "서로 다른 요청 수" : "연속 교통 변화 횟수"}
              <select className="tab" value={count} onChange={(e) => { setCount(Number(e.target.value)); invalidate(); }}>
                {(many ? [1, 10, 100, 1000] : [9, 30, 60]).map((n) => <option key={n} value={n}>{formatInt(n)}{many ? "개" : "회"}</option>)}
              </select>
            </label>
            <label className="text-sm flex items-center gap-2">
              변경 범위
              <select className="tab" value={scope} onChange={(e) => { setScope(e.target.value as ChangeScope); invalidate(); }}>
                <option value="local">{many ? "전체 도로의 1%" : "기존 경로의 도착지 쪽 도로 1개"}</option>
                <option value="wide">전체 도로의 10%</option>
              </select>
            </label>
            {many && <label className="text-sm flex items-center gap-2">교통 상황
              <select className="tab" value={scenario} onChange={(e) => { setScenario(e.target.value as ExperimentScenario); invalidate(); }}>
                <option value="normal">정상</option><option value="congestion">혼잡</option><option value="closure">폐쇄</option>
              </select>
            </label>}
            <label className="text-sm flex items-center gap-2">조건 번호
              <input className="tab w-24 num" type="number" min={0} max={1000000} step={1} value={seed} onChange={(e) => { setSeed(Number(e.target.value)); invalidate(); }} />
            </label>
          </div>
          <p className="text-xs faint">같은 조건 번호면 같은 요청과 도로 변화가 재현됩니다. 변경 범위를 넓혀 이전 계산 재사용의 한계도 비교할 수 있습니다.</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="tabs" role="tablist" aria-label={many ? "첫 요청 경로" : "고정 출발·도착"}>
              {selectedFile?.pairs.filter((p) => p.od.track === 2).map((p) => {
                const i = selectedFile.pairs.indexOf(p);
                return <button key={p.od.id} className="tab" role="tab" aria-selected={pairIdx === i} onClick={() => { setPairIdx(i); invalidate(); }}>{many ? "첫 요청" : "경로"} {i + 1} · 직선 {formatDistance(p.od.straightM)}</button>;
              })}
            </div>
            <button className="btn btn-primary" disabled={!json || !pair || !Number.isInteger(seed) || seed < 0 || seed > 1000000} onClick={start}>실험 실행 · 5회 실측</button>
          </div>
        </fieldset>
        {busy && <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm muted" role="status">{progress?.stage} · {formatInt(progress?.completed ?? 0)}/{formatInt(progress?.total ?? count)}</p>
          <button className="btn" onClick={cancel}>측정 중단</button>
        </div>}
        {error && <p className="text-sm" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
      </section>
      {result && json && selectedFile ? <>
        <ExperimentResults key={runId} result={result} />
        <ExperimentReplay key={`replay-${runId}`} json={json} edgeIds={selectedFile.edgeIds} nodes={result.nodes} algorithms={result.algorithms} examples={result.examples} replanning={!many} />
      </> : !busy && !error && <p className="card text-sm muted">조건을 정하고 실험을 실행하세요. 이 브라우저에서 실제 계산한 누적 시간과 탐색 과정이 표시됩니다.</p>}
    </div>
  );
}

function ExperimentResults({ result }: { result: ExperimentResult }) {
  const [includeInitial, setIncludeInitial] = useState(true);
  const many = result.kind === "many-queries";
  const other = many ? "cch" : "lpa";
  const values = (a: "astar" | "cch" | "lpa") => includeInitial ? result.metrics[a]!.withInitialMs : result.metrics[a]!.cumulativeMs;
  const last = result.count - 1;
  const a = values("astar")[last], b = values(other)[last];
  const winner = Math.abs(a - b) < 0.001 ? "비슷한 계산 시간입니다." : `${a < b ? "A*" : NAME[other]}의 누적 계산 시간이 더 적었습니다.`;
  const crossing = values(other).findIndex((ms, i) => ms < values("astar")[i]);

  return (
    <>
      <section className="card flex flex-col gap-3" style={{ borderLeft: "4px solid var(--good)" }}>
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div><div className="font-semibold">✓ {formatInt(result.checkedCases)}{many ? "개 요청" : "회 변화"} 모두 다익스트라의 정답과 일치</div><p className="text-xs faint mt-0.5">최소 이동시간, 경로 연결, 일방통행과 폐쇄 통과 여부를 검사했습니다. 같은 최소 이동시간의 경로는 여러 개일 수 있습니다.</p></div>
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={includeInitial} onChange={(e) => setIncludeInitial(e.target.checked)} />첫 준비 비용 포함</label>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {result.algorithms.map((algo) => <div key={algo} className="rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
            <div className="text-xs muted"><span className="swatch" style={{ background: ALGO_STYLE[algo].color }} />{NAME[algo]} · {many ? "요청" : "교통 변화"} {formatInt(result.count)}{many ? "개" : "회"} 누적 계산</div>
            <div className="text-xl font-bold num mt-0.5">{formatExperimentMs(values(algo)[last])}</div>
            <div className="text-xs faint mt-0.5">첫 준비 {algo === "astar" && many ? "없음" : formatExperimentMs(result.metrics[algo]!.initialMs)} · {includeInitial ? "포함" : "제외"}{algo === "cch" && " · 이번 교통 정보 반영은 항상 포함"}</div>
          </div>)}
        </div>
        <p className="text-sm"><b>{winner}</b> <span className="muted">{crossing < 0 ? `${NAME[other]}가 더 적게 든 지점은 이번 실험에서 나타나지 않았습니다.` : `${NAME[other]}가 처음 더 적게 든 지점은 ${crossing + 1}${many ? "번째 요청" : "번째 변화"}입니다. 이후 비교는 아래 그래프를 확인하세요.`}</span></p>
        <p className="text-xs faint">{many ? "CCH는 준비 비용과 지름길 저장 공간을 쓰는 대신 많은 요청에서 준비를 공유합니다. 요청이 적거나 교통 변화가 잦으면 A*가 유리할 수도 있습니다." : "LPA*는 이전 탐색 상태를 저장하는 대신 변화 이후 재사용할 계산이 많을 때 이점이 있습니다. 변화가 넓게 퍼지거나 반복이 적으면 A*가 유리할 수도 있습니다."}</p>
      </section>
      {result.cchSetup && <section className="card text-sm flex flex-col gap-2">
        <h3 className="font-semibold">CCH가 한 번만 하는 작업</h3>
        <div className="flex flex-wrap gap-4 num"><span>도로 구조 전처리: {formatMs(result.cchSetup.preprocessMs)}</span><span>정상 비용 준비: {formatMs(result.cchSetup.customizeMs)}</span><span>이번 교통 정보 반영: {formatMs(result.cchSetup.updateMs)} · 지름길 {formatInt(result.cchSetup.recomputed)}개 다시 계산</span></div>
        <p className="text-xs faint">요청마다 전처리·비용 반영을 반복하지 않습니다. ‘첫 준비 비용 포함’을 끄면 구조 전처리와 정상 비용 준비만 제외됩니다.</p>
      </section>}
      <LogChart title="실제 측정한 누적 계산 시간" subtitle={`${includeInitial ? "첫 준비 포함" : "준비 완료 후 응답"} · 가로·세로 로그 눈금 · ${result.repeats}회 중간값`} xLabel={many ? "서로 다른 경로 요청 수" : "연속 교통 변화 횟수"} yLabel="누적 계산 시간 (ms)" formatY={formatMs}
        series={result.algorithms.map((algo) => ({ id: algo, label: NAME[algo], color: ALGO_STYLE[algo].color, dash: ALGO_STYLE[algo].dash.join(" "), points: values(algo).map((ms, i) => ({ x: i + 1, y: ms, label: `${i + 1}${many ? "개 요청" : "회 변화"} · ${formatMs(ms)}` })) }))} />
      <details className="card" open={many}>
        <summary className="font-semibold cursor-pointer">{many ? "요청 수별 실제 누적 시간" : "변화별 실제 응답 시간 · 펼쳐 보기"}</summary>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>{many ? "요청 수" : "변화"}</th>{!many && <th>바뀐 도로</th>}<th>A* {many ? "누적" : "응답"}</th><th>{NAME[other]} {many ? "누적" : "응답"}</th>{!many && <><th>A* 누적</th><th>LPA* 누적</th><th>A* / LPA* 본 교차로</th></>}</tr></thead>
          <tbody>{(many ? result.checkpoints.map((k) => k - 1) : Array.from({ length: result.count }, (_, i) => i)).map((i) => <tr key={i}>
            <td>{i + 1}{many ? "개" : ` · ${result.eventLabels[i]}`}</td>{!many && <td>{result.changedRoads[i]}개</td>}
            <td>{formatExperimentMs(many ? values("astar")[i] : result.metrics.astar!.responseMs[i])}</td><td>{formatExperimentMs(many ? values(other)[i] : result.metrics[other]!.responseMs[i])}</td>
            {!many && <><td>{formatExperimentMs(values("astar")[i])}</td><td>{formatExperimentMs(values(other)[i])}</td><td>{result.metrics.astar!.visited[i]} / {result.metrics.lpa!.visited[i]}</td></>}
          </tr>)}</tbody>
        </table></div>
        <p className="text-xs faint mt-2">워밍업 1회 후 5회 실제 측정 · 반복마다 실행 순서 교대 · 정답 검사와 재생 기록 생성은 계산 시간에서 제외합니다. 누적 시간은 각 반복의 실제 합을 구한 뒤 중간값을 냅니다. 본 교차로는 첫 측정 반복의 수입니다.</p>
        <p className="text-xs faint mt-1">조건 번호 {result.seed} · 교차로 {formatInt(result.nodes)}개 · 도로 {formatInt(result.edges)}개 · 브라우저와 기기에 따라 시간은 달라집니다. 계산 시간과 차량의 이동시간은 다른 지표입니다.</p>
      </details>
      <p className="text-xs faint">‘측정 해상도 미만’은 타이머가 구분할 수 없을 만큼 짧게 측정됐다는 뜻입니다. 계산이 0초라는 뜻은 아닙니다. 그래프는 로그 눈금이므로 0으로 측정된 점을 생략합니다.</p>
    </>
  );
}
