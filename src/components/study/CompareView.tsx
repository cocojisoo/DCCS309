"use client";

import { useEffect, useState } from "react";
import { formatDistance, formatInt, formatMs } from "@/lib/format";
import type { DemoFile, DemoIndexEntry, DemoRun } from "@/lib/study/demo";
import type { StudyGraphJson } from "@/lib/study/graph";
import { STUDY_ALGORITHMS, type StudyAlgorithmId } from "@/lib/study/search";
import SearchCanvas from "./SearchCanvas";
import { fetchJson, STATUS_LABEL } from "./shared";
import { SimulationLegend } from "./SimulationAppearance";

export default function CompareView({ timeLimitS }: { timeLimitS: number }) {
  const [json, setJson] = useState<StudyGraphJson | null>(null);
  const [index, setIndex] = useState<DemoIndexEntry[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [sizeIdx, setSizeIdx] = useState(0);
  const [pairIdx, setPairIdx] = useState(0);
  const [demo, setDemo] = useState<DemoFile | null>(null);
  const [frame, setFrame] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [algorithm, setAlgorithm] = useState<StudyAlgorithmId>("dfs");
  const [speed, setSpeed] = useState(1);

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
  const maxFrames = pair?.runs[algorithm].frames.length ?? 0;

  const done = frame >= maxFrames - 1;
  const running = playing && !done;

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setFrame((f) => f + 1), 1100 / speed);
    return () => clearTimeout(id);
  }, [running, frame, speed]);

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
          <div className="flex flex-wrap gap-2">
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
            <button className="btn" onClick={() => { setPlaying(false); setFrame(f => Math.min(maxFrames - 1, f + 1)); }} disabled={!pair || done}>한 장면씩</button>
          </div>
        </div>
        <label className="text-sm">화면 속도 <select className="final-select" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
          <option value={0.5}>느리게</option><option value={1}>기본</option><option value={2}>빠르게</option></select></label>
      </section>
      <div className="lab-algorithms" aria-label="이전 연구 재생 알고리즘">{STUDY_ALGORITHMS.map(a =>
        <button key={a.id} aria-pressed={algorithm === a.id} onClick={() => { setAlgorithm(a.id); reset(); }}><strong>{a.name}</strong></button>)}</div>
      <SimulationLegend dfs={algorithm === "dfs"} />
      {!demo || demo.label !== entry.label || !pair ? (
        <p className="muted text-sm">탐색 기록 불러오는 중…</p>
      ) : (
        <div>
          {STUDY_ALGORITHMS.filter(a => a.id === algorithm).map((a) => {
            const run = pair.runs[a.id];
            return (
              <div key={a.id} className="grid lg:grid-cols-[2fr_1fr] gap-4">
                <div className="flex items-baseline justify-between lg:col-span-2">
                  <h3 className="font-semibold">
                    {a.name} <span className="faint text-xs font-normal">{a.role}</span>
                  </h3>
                  <span className="text-sm">{done ? "탐색 종료" : frame < 0 ? "재생 대기" : "현재 교차로 " + run.frames[frame]?.current}</span>
                </div>
                <SearchCanvas json={json} demo={demo} od={pair.od} run={run} algo={a.id} frame={frame} timeLimitS={timeLimitS} />
                <div><RunCard run={run} frame={frame} shortest={pair.runs.dijkstra.lengthM} />
                  <div className="card mt-3"><h3 className="font-semibold">탐색 순서 · 장면을 눌러 다시 보기</h3>
                    <ol className="lab-trace-list" style={{ maxHeight: 300 }}>{run.frames.slice(0, frame + 1).map((item, i) =>
                      <li key={i} className={i === frame ? "is-current" : ""}><button onClick={() => { setPlaying(false); setFrame(i); }}>
                        <span className="sim-log-number">{i + 1}</span><div><strong>{i === maxFrames - 1 ? STATUS_LABEL[run.status] : "교차로 " + item.current}</strong>
                          <span>{i === maxFrames - 1
                            ? run.status === "SUCCESS"
                              ? "최종 경로 " + formatDistance(run.pathEdges.reduce((sum, e) => sum + json.len[e], 0))
                              : run.status === "TIMEOUT" ? "제한시간 안에 최단 경로를 확정하지 못함" : "연결 가능한 경로 없음"
                            : "이곳까지의 경로 " + formatDistance(item.path.reduce((sum, e) => sum + json.len[e], 0))}</span>
                        </div></button></li>)}</ol>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs faint">
        파란 점은 이미 본 교차로, 주황 테두리는 현재 교차로, 보라 선은 현재 경로, 초록 굵은 선은 확정된 최종 경로입니다.
        기록은 최대 100장면으로 요약되어 중간 계산이 생략됩니다. 걸린 시간은 발표용 기록을 만들 때 1회 잰
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
