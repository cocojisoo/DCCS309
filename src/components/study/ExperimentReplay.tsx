"use client";

import { useEffect, useState } from "react";
import { formatDistance, formatInt } from "@/lib/format";
import type { StudyGraphJson } from "@/lib/study/graph";
import type { ExperimentAlgo, ReplayExample } from "@/lib/study/routingExperiments";
import { AlgoHeading } from "./CompareView";
import SearchCanvas from "./SearchCanvas";
import { formatTravel, STATUS_LABEL } from "./shared";
import { formatExperimentMs } from "./experimentFormat";

interface Props {
  json: StudyGraphJson;
  edgeIds: number[];
  nodes: number;
  algorithms: ExperimentAlgo[];
  examples: ReplayExample[];
  replanning: boolean;
}

/** 기존 지도·알고리즘 제목·결과 카드 형식으로 실측과 별도의 탐색 기록을 재생한다. */
export default function ExperimentReplay({ json, edgeIds, nodes, algorithms, examples, replanning }: Props) {
  const [exampleIdx, setExampleIdx] = useState(0);
  const [frame, setFrame] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(6);
  const example = examples[exampleIdx];
  const maxFrames = Math.max(...algorithms.map((a) => example.runs[a]?.frames.length ?? 0));
  const done = frame >= maxFrames - 1;
  const running = playing && !done;

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setFrame((f) => f + 1), 1000 / fps);
    return () => clearTimeout(id);
  }, [running, frame, fps]);

  const reset = () => {
    setFrame(-1);
    setPlaying(false);
  };
  const select = (i: number) => {
    setExampleIdx(i);
    reset();
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">탐색 과정 재생</h3>
          <div className="flex flex-wrap gap-2">
            <label className="text-sm flex items-center gap-2">
              재생 속도
              <select className="tab" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                <option value={2}>느리게</option><option value={6}>보통</option><option value={12}>빠르게</option>
              </select>
            </label>
            <button className="btn" onClick={reset} disabled={frame < 0}>처음</button>
            <button className="btn btn-primary" onClick={() => { if (done) setFrame(-1); setPlaying(!running); }}>
              {running ? "⏸ 멈춤" : "▶ 탐색 재생"}
            </button>
            <button className="btn" onClick={() => { setPlaying(false); setFrame(maxFrames - 1); }}>결과로 ⏭</button>
          </div>
        </div>
        {replanning ? (
          <>
            <label className="flex flex-col gap-1.5 text-sm">
              <span><b>교통 변화 {example.index + 1}/{examples.length}: {example.label}</b> · 바뀐 도로 {formatInt(example.changedRoads)}개</span>
              <input type="range" min={0} max={examples.length - 1} value={exampleIdx} onChange={(e) => select(Number(e.target.value))} aria-valuetext={`변화 ${example.index + 1}, ${example.label}`} />
            </label>
            <div className="flex gap-2">
              <button className="btn" disabled={exampleIdx === 0} onClick={() => select(exampleIdx - 1)}>이전 변화</button>
              <button className="btn" disabled={exampleIdx === examples.length - 1} onClick={() => select(exampleIdx + 1)}>다음 변화</button>
            </div>
          </>
        ) : (
          <div className="tabs" role="tablist" aria-label="재생할 요청">
            {examples.map((e, i) => <button key={e.index} className="tab" role="tab" aria-selected={exampleIdx === i} onClick={() => select(i)}>요청 {formatInt(e.index + 1)}</button>)}
          </div>
        )}
        <p className="text-xs faint">
          옅은 표시는 본 교차로, 색 선은 탐색 중인 길, 굵은 검은 선은 최종 경로입니다.
          {replanning && " 회색 점선은 바로 이전 교통 상황의 경로입니다."} 빨강은 혼잡, 진한 빨강과 ✕는 폐쇄입니다.
          화면 재생 속도와 실제 계산 시간은 다릅니다.{replanning && " LPA*가 수정할 곳이 없으면 바로 결과가 나올 수 있습니다."}
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {algorithms.map((a) => {
          const run = example.runs[a]!;
          const last = run.frames.length - 1;
          const f = frame < 0 ? null : run.frames[Math.min(frame, last)];
          const finished = frame >= last && frame >= 0;
          const ok = run.status === "SUCCESS";
          return (
            <div key={a} className="flex flex-col gap-2">
              <AlgoHeading id={a} />
              <SearchCanvas json={json} edgeIds={edgeIds} nodes={nodes} od={example.od} run={run} algo={a} frame={frame} changes={example.changes} ghostPath={example.ghostPath} />
              <dl className="card !p-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm num">
                <dt className="muted">상태</dt>
                <dd className="text-right">{finished ? <span className={`badge ${ok ? "badge-good" : "badge-bad"}`}>{STATUS_LABEL[run.status]}</span> : <span className="faint">{f ? "탐색 중…" : "대기"}</span>}</dd>
                <dt className="muted">최종 경로 거리</dt><dd className="text-right">{finished && ok ? formatDistance(run.lengthM!) : "—"}</dd>
                <dt className="muted">차량 추정 이동시간</dt><dd className="text-right">{finished && ok ? formatTravel(run.timeS) : "—"}</dd>
                <dt className="muted">본 교차로</dt><dd className="text-right">{formatInt(f?.visited ?? 0)}</dd>
                <dt className="muted">이 요청 계산 시간</dt><dd className="text-right">{finished ? formatExperimentMs(run.searchMs) : "—"}</dd>
                <dd className="col-span-2 text-xs faint mt-1">{a === "astar" ? "매번 새로 탐색" : a === "cch" ? "공유한 지름길로 질의 · 교통 정보 반영 비용은 위 표에 별도 표시" : "이전 계산을 유지 · 도로 변경 반영 + 다시 계획"}</dd>
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}
