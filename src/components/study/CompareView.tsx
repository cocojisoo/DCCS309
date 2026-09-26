"use client";

import { useEffect, useState } from "react";
import { formatDistance, formatInt, formatMs } from "@/lib/format";
import type { DemoFile, DemoIndexEntry, DemoRun } from "@/lib/study/demo";
import type { StudyGraphJson } from "@/lib/study/graph";
import { STUDY_ALGORITHMS } from "@/lib/study/search";
import SearchCanvas from "./SearchCanvas";
import { ALGO_STYLE, fetchJson, STATUS_LABEL } from "./shared";

const FPS = 12;

export default function CompareView({ timeLimitS }: { timeLimitS: number }) {
  const [json, setJson] = useState<StudyGraphJson | null>(null);
  const [index, setIndex] = useState<DemoIndexEntry[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [sizeIdx, setSizeIdx] = useState(0);
  const [pairIdx, setPairIdx] = useState(0);
  const [demo, setDemo] = useState<DemoFile | null>(null);
  const [frame, setFrame] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    Promise.all([fetchJson<StudyGraphJson>("/graph/study.json"), fetchJson<DemoIndexEntry[]>("/study/traces/index.json")]).then(([g, idx]) => {
      if (!g || !idx?.length) return setMissing(true);
      setJson(g);
      setIndex(idx);
    });
  }, []);

  const entry = index?.[sizeIdx];
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    fetchJson<DemoFile>(`/study/traces/${entry.label}.json`).then((d) => alive && setDemo(d));
    return () => {
      alive = false;
    };
  }, [entry]);

  const pair = demo?.pairs[Math.min(pairIdx, (demo?.pairs.length ?? 1) - 1)];
  const maxFrames = pair ? Math.max(...STUDY_ALGORITHMS.map((a) => pair.runs[a.id].frames.length)) : 0;

  const done = frame >= maxFrames - 1;
  const running = playing && !done;

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setFrame((f) => f + 1), 1000 / FPS);
    return () => clearTimeout(id);
  }, [running, frame]);

  const reset = () => {
    setFrame(-1);
    setPlaying(false);
  };

  if (missing)
    return (
      <p className="card text-sm">
        탐색 기록이 없습니다. <code>npm run study:graph</code> 로 지도를 만들고 <code>npm run study:traces</code> 로 발표용 기록을 만드세요.
      </p>
    );
  if (!json || !index || !entry) return <p className="muted text-sm">지도 불러오는 중…</p>;

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">
            지도 크기: {entry.title} <span className="muted font-normal">· 실제 교차로 {formatInt(entry.nodes)}개 · 도로 {formatInt(entry.edges)}개</span>
          </span>
          <input
            type="range"
            min={0}
            max={index.length - 1}
            value={sizeIdx}
            onChange={(e) => {
              setSizeIdx(Number(e.target.value));
              setPairIdx(0);
              reset();
            }}
            aria-valuetext={`${entry.title}, 교차로 ${entry.nodes}개`}
          />
          <span className="flex justify-between text-xs faint">
            <span>교차로 {index[0].nodes}개</span>
            <span>교차로 {formatInt(index[index.length - 1].nodes)}개 ({index[index.length - 1].title})</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="tabs" role="tablist" aria-label="출발·도착 쌍">
            {entry.pairs.map((p, i) => (
              <button
                key={p.id}
                role="tab"
                className="tab"
                aria-selected={pairIdx === i}
                onClick={() => {
                  setPairIdx(i);
                  reset();
                }}
              >
                {p.track === 1 ? "트랙 1 (고정)" : "트랙 2"} · {p.id} · 직선 {formatDistance(p.straightM)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={reset} disabled={frame < 0}>
              처음
            </button>
            <button
              className="btn btn-primary"
              disabled={!pair}
              onClick={() => {
                if (done) setFrame(-1);
                setPlaying(!running);
              }}
            >
              {running ? "⏸ 멈춤" : "▶ 탐색 시작"}
            </button>
            <button className="btn" onClick={() => { setPlaying(false); setFrame(maxFrames - 1); }} disabled={!pair}>
              결과로 ⏭
            </button>
          </div>
        </div>
      </section>

      {!demo || demo.label !== entry.label || !pair ? (
        <p className="muted text-sm">탐색 기록 불러오는 중…</p>
      ) : (
        <div className="grid md:grid-cols-3 gap-3">
          {STUDY_ALGORITHMS.map((a) => {
            const run = pair.runs[a.id];
            return (
              <div key={a.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold">
                    <span className="swatch" style={{ background: ALGO_STYLE[a.id].color }} />
                    {a.name} <span className="faint text-xs font-normal">{a.role}</span>
                  </h3>
                  <span className="faint text-xs">{ALGO_STYLE[a.id].markerLabel}</span>
                </div>
                <SearchCanvas json={json} demo={demo} od={pair.od} run={run} algo={a.id} frame={frame} timeLimitS={timeLimitS} />
                <RunCard run={run} frame={frame} shortest={pair.runs.dijkstra.lengthM} />
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs faint">
        옅은 표시는 방문한 교차로, 색 선은 지금 따라가는 길, 초록 점선은 DFS 의 현재 최고 기록 길, 굵은 검은 선은 최종 경로입니다. 각 방법은 자기
        탐색을 최대 100장면으로 나눠 같은 속도로 재생합니다 (보여주는 장면만 줄이고 탐색은 줄이지 않음). 걸린 시간은 발표용 기록을 만들 때 1회 잰
        값이고, 공식 값은 &lsquo;크기에 따른 변화&rsquo;에 있습니다.
      </p>
    </div>
  );
}

function RunCard({ run, frame, shortest }: { run: DemoRun; frame: number; shortest: number | null }) {
  const last = run.frames.length - 1;
  const f = frame < 0 ? null : run.frames[Math.min(frame, last)];
  const finished = f !== null && frame >= last;
  const ok = run.status === "SUCCESS";
  return (
    <dl className="card !p-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm num">
      <dt className="muted">상태</dt>
      <dd className="text-right">
        {finished ? (
          <span className={`badge ${ok ? "badge-good" : "badge-bad"}`}>{STATUS_LABEL[run.status]}</span>
        ) : (
          <span className="faint">{f ? "탐색 중…" : "대기"}</span>
        )}
      </dd>
      <dt className="muted">찾은 길 길이</dt>
      <dd className="text-right">
        {!finished ? "—" : ok ? (
          <>
            {formatDistance(run.lengthM!)}
            {shortest !== null && Math.abs(run.lengthM! - shortest) < 0.01 && <span className="faint"> ✓ 최단</span>}
          </>
        ) : (
          <span title={run.bestSoFarM !== null ? `멈추기 전까지 찾은 최고 기록 ${formatDistance(run.bestSoFarM)} (정답 비교에 쓰지 않음)` : undefined}>
            확인 못 함{run.bestSoFarM !== null && <span className="faint"> (중단 전 {formatDistance(run.bestSoFarM)})</span>}
          </span>
        )}
      </dd>
      <dt className="muted">걸린 시간</dt>
      <dd className="text-right">{finished ? formatMs(run.searchMs) : "—"}</dd>
      <dt className="muted">방문 횟수</dt>
      <dd className="text-right">{formatInt(f ? f.step : 0)}</dd>
      <dt className="muted">서로 다른 교차로</dt>
      <dd className="text-right">{formatInt(f ? f.visited : 0)}</dd>
      {run.completePaths !== null && (
        <>
          <dt className="muted">완성해 본 경로</dt>
          <dd className="text-right">{finished ? formatInt(run.completePaths) : "—"}</dd>
        </>
      )}
    </dl>
  );
}
