"use client";

import { useEffect, useMemo, useState } from "react";
import { CLASSROOM_NODES, CLASSROOM_SOURCE, CLASSROOM_TARGET, classroomGraph } from "@/lib/study/classroom";
import { FINDERS } from "@/lib/study/finders";
import { STUDY_ALGORITHMS, type StudyAlgorithmId, type TraceFrame } from "@/lib/study/search";
import { SEARCH_STYLE, SimulationLegend } from "./SimulationAppearance";

const W = 650;
const H = 320;
const sx = (x: number) => x + 10;
const sy = (y: number) => H - y - 10;
const name = (v: number) => CLASSROOM_NODES[v].name;

const HOW: Record<StudyAlgorithmId, string> = {
  dfs: "갈림길에서 첫 번째 길로 끝까지 들어가 보고, 막히거나 도착하면 한 칸 되돌아와 다음 길을 가 본다. 모든 길을 다 확인한 뒤 가장 짧은 것을 고른다.",
  dijkstra: "아직 확정하지 않은 교차로 중 출발점에서 가장 가까운 곳을 하나씩 확정한다. 도착점을 확정하는 순간 멈춘다.",
  astar: "다익스트라와 같지만 '지금까지 거리 + 도착점까지 직선거리'가 가장 작은 교차로부터 확정한다. 그래서 도착점 쪽을 먼저 본다.",
};

export default function ClassroomView() {
  const g = useMemo(() => classroomGraph(), []);
  const [algo, setAlgo] = useState<StudyAlgorithmId>("dfs");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const result = useMemo(
    () => FINDERS[algo](g, CLASSROOM_SOURCE, CLASSROOM_TARGET, { timeLimitMs: null, heuristicScale: 1, recordTrace: true, maxFrames: 10000 }),
    [g, algo],
  );
  const frames = result.trace!.frames;
  const order = result.trace!.order;
  const f: TraceFrame = frames[Math.min(frame, frames.length - 1)];
  const done = frame >= frames.length - 1;
  const running = playing && !done;

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setFrame((x) => x + 1), 1100 / speed);
    return () => clearTimeout(id);
  }, [running, frame, speed]);

  const pick = (a: StudyAlgorithmId) => {
    setAlgo(a);
    setFrame(0);
    setPlaying(false);
  };

  const pathLen = (es: number[]) => es.reduce((s, e) => s + g.len[e], 0);
  const hint = (v: number) => Math.hypot(g.x[v] - g.x[CLASSROOM_TARGET], g.y[v] - g.y[CLASSROOM_TARGET]);
  const road = (e: number) => e >> 1; // 양방향 도로는 간선 두 개씩 연달아 들어 있다
  const visited = new Set(order.slice(0, f.visited));
  const pathRoads = new Set(f.path.map(road));
  const bestRoads = new Set((f.best ?? []).map(road));
  const finalRoads = done && result.status === "SUCCESS" ? new Set(result.pathEdges.map(road)) : new Set<number>();
  const color = SEARCH_STYLE.route;

  const describe = (x: TraceFrame) => {
    const g0 = pathLen(x.path);
    const route = [CLASSROOM_SOURCE, ...x.path.map((e) => g.to[e])].map(name).join("→");
    if (algo === "dfs") {
      if (x.current === CLASSROOM_TARGET) return `도착! 완성 경로 ${route} = ${g0}m${x.best && pathLen(x.best) === g0 ? " (최고 기록)" : ""}`;
      return `${name(x.current)}에 들어감 · 지금 길 ${route} (${g0}m)`;
    }
    const tag = x.current === CLASSROOM_TARGET ? " → 도착점 확정, 멈춤" : "";
    if (algo === "dijkstra") return `${name(x.current)} 확정 · 거리 ${g0}m${tag}`;
    return `${name(x.current)} 확정 · 거리 ${g0} + 힌트 ${hint(x.current).toFixed(0)} = ${(g0 + hint(x.current)).toFixed(0)}${tag}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabs" role="tablist" aria-label="알고리즘">
          {STUDY_ALGORITHMS.map((a) => (
            <button key={a.id} role="tab" className="tab" aria-selected={algo === a.id} onClick={() => pick(a.id)}>
              {a.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => { setFrame(0); setPlaying(false); }}>처음</button>
          <button className="btn" onClick={() => { setPlaying(false); setFrame((x) => Math.max(0, x - 1)); }} disabled={frame === 0}>◀ 이전</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (done) setFrame(0);
              setPlaying(!running);
            }}
          >
            {running ? "⏸ 멈춤" : "▶ 재생"}
          </button>
          <button className="btn" onClick={() => { setPlaying(false); setFrame((x) => Math.min(frames.length - 1, x + 1)); }} disabled={done}>한 단계 ▶</button>
          <label className="text-sm">화면 속도<select className="final-select" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
            <option value={0.5}>느리게</option><option value={1}>기본</option><option value={2}>빠르게</option></select></label>
        </div>
      </div>

      <p className="text-sm muted">{HOW[algo]}</p>
      <SimulationLegend dfs={algo === "dfs"} />

      <div className="grid md:grid-cols-[3fr_2fr] gap-4">
        <section className="card">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="작은 그림 지도 탐색 과정">
            {Array.from({ length: g.m / 2 }, (_, r) => {
              const e = r * 2;
              const a = g.from[e];
              const b = g.to[e];
              const onFinal = finalRoads.has(r);
              const onPath = pathRoads.has(r);
              const onBest = bestRoads.has(r);
              return (
                <g key={r}>
                  <line
                    x1={sx(g.x[a])} y1={sy(g.y[a])} x2={sx(g.x[b])} y2={sy(g.y[b])}
                    stroke={onFinal ? SEARCH_STYLE.final : onPath ? color : onBest ? SEARCH_STYLE.candidate : "var(--road)"}
                    strokeWidth={onFinal ? 7 : onPath ? 5 : onBest ? 5 : 3}
                    strokeDasharray={onBest && !onPath && !onFinal ? "8 5" : undefined}
                    strokeLinecap="round"
                  />
                  <text x={(sx(g.x[a]) + sx(g.x[b])) / 2} y={(sy(g.y[a]) + sy(g.y[b])) / 2 - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text)" stroke="var(--surface)" strokeWidth="5" paintOrder="stroke">
                    {g.len[e]}m
                  </text>
                </g>
              );
            })}
            {CLASSROOM_NODES.map((n, v) => {
              const isCur = f.current === v && !done;
              const seen = visited.has(v);
              return (
                <g key={n.name}>
                  {isCur && <circle cx={sx(n.x)} cy={sy(n.y)} r="24" fill="none" stroke={SEARCH_STYLE.current} strokeWidth="3" />}
                  <circle
                    cx={sx(n.x)} cy={sy(n.y)} r={isCur ? 19 : 16}
                    fill={isCur ? SEARCH_STYLE.currentFill : seen ? SEARCH_STYLE.visitedFill : "var(--surface)"}
                    stroke={isCur ? SEARCH_STYLE.current : seen ? SEARCH_STYLE.visited : "var(--road)"}
                    strokeWidth={isCur ? 3.5 : 2}
                  />
                  <text x={sx(n.x)} y={sy(n.y) + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill={seen || isCur ? SEARCH_STYLE.ink : "var(--text)"}>
                    {n.name}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="text-sm muted mt-2">{done ? "초록색 굵은 선이 확정된 최종 경로입니다." : "현재: " + name(f.current) + " · 주황색 이중 테두리"} · 화면 재생시간은 실제 계산시간과 다릅니다.</p>
        </section>

        <section className="card flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">탐색 순서</h2>
            <span className="text-xs faint num">
              {Math.min(frame + 1, frames.length)} / {frames.length} 단계
            </span>
          </div>
          <ol className="text-sm flex flex-col gap-1 max-h-72 overflow-auto num">
            {frames.slice(0, frame + 1).map((x, i) => (
              <li key={i} className={i === frame ? "font-semibold" : "muted"}>
                {i + 1}. {describe(x)}
              </li>
            ))}
          </ol>
          {done && (
            <p className="text-sm mt-2 pt-2 border-t border-border">
              <b>결과:</b> {[CLASSROOM_SOURCE, ...result.pathEdges.map((e) => g.to[e])].map(name).join(" → ")} = {result.lengthM}m · 방문{" "}
              {result.visitCount}번 (서로 다른 교차로 {result.uniqueVisited}개)
              {result.completePaths !== null && ` · 완성해 본 경로 ${result.completePaths}개`}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
