"use client";

import { useEffect, useMemo, useState } from "react";
import { CLASSROOM_NODES, CLASSROOM_SOURCE, CLASSROOM_TARGET, classroomGraph } from "@/lib/study/classroom";
import { classroomScene } from "@/lib/study/classroomScenes";
import type { StudyAlgorithmId } from "@/lib/study/search";
import { ALGO_STYLE } from "./shared";

const W = 650;
const H = 320;
const sx = (x: number) => x + 10;
const sy = (y: number) => H - y - 10;

/** 손으로 만든 교차로 8개짜리 지도에서 한 알고리즘의 탐색을 한 단계씩 보여 준다 */
export default function ClassroomView({ algo }: { algo: StudyAlgorithmId }) {
  const g = useMemo(() => classroomGraph(), []);
  const scene = useMemo(() => classroomScene(algo), [algo]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  const steps = scene.steps;
  const f = steps[Math.min(frame, steps.length - 1)];
  const done = frame >= steps.length - 1;
  const running = playing && !done;

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setFrame((x) => x + 1), 1100);
    return () => clearTimeout(id);
  }, [running, frame]);

  const road = (e: number) => e >> 1; // 양방향 도로는 간선 두 개씩 연달아 들어 있다
  const visited = new Set(f.visited);
  const pathRoads = new Set(f.path.map(road));
  const bestRoads = new Set((f.best ?? []).map(road));
  const finalRoads = new Set((f.final ?? []).map(road));
  const jamRoads = new Set(f.jam && scene.jam ? scene.jam.edges.map(road) : []);
  const color = ALGO_STYLE[algo].color;
  const shortcuts = (scene.shortcuts ?? []).slice(0, f.shortcutsShown ?? 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm muted">
          {f.phase ? <span className="badge mr-2">{f.phase}</span> : null}
          {Math.min(frame + 1, steps.length)} / {steps.length} 단계
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            onClick={() => {
              setFrame(0);
              setPlaying(false);
            }}
          >
            처음
          </button>
          <button className="btn" onClick={() => setFrame((x) => Math.max(0, x - 1))} disabled={frame === 0}>
            ◀ 이전
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (done) setFrame(0);
              setPlaying(!running);
            }}
          >
            {running ? "⏸ 멈춤" : "▶ 재생"}
          </button>
          <button className="btn" onClick={() => setFrame((x) => Math.min(steps.length - 1, x + 1))} disabled={done}>
            한 단계 ▶
          </button>
        </div>
      </div>

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
              const onJam = jamRoads.has(r);
              const mx = (sx(g.x[a]) + sx(g.x[b])) / 2;
              const my = (sy(g.y[a]) + sy(g.y[b])) / 2;
              return (
                <g key={r}>
                  {onJam && <line x1={sx(g.x[a])} y1={sy(g.y[a])} x2={sx(g.x[b])} y2={sy(g.y[b])} stroke="var(--jam)" strokeWidth={11} strokeLinecap="round" opacity={0.45} />}
                  <line
                    x1={sx(g.x[a])}
                    y1={sy(g.y[a])}
                    x2={sx(g.x[b])}
                    y2={sy(g.y[b])}
                    stroke={onFinal ? "var(--text)" : onPath ? color : onBest ? "var(--good)" : onJam ? "var(--jam)" : "var(--road)"}
                    strokeWidth={onFinal ? 7 : onPath || onBest || onJam ? 5 : 3}
                    strokeDasharray={onBest && !onPath && !onFinal ? "8 5" : undefined}
                    strokeLinecap="round"
                  />
                  <text x={mx} y={my - 6} textAnchor="middle" fontSize="12" fill={onJam ? "var(--jam)" : "var(--text-3)"} fontWeight={onJam ? 700 : 400}>
                    {onJam && scene.jam ? `${g.len[e]}×${scene.jam.factor}` : g.len[e]}
                  </text>
                </g>
              );
            })}
            {shortcuts.map((sc, i) => {
              const x1 = sx(g.x[sc.a]), y1 = sy(g.y[sc.a]), x2 = sx(g.x[sc.b]), y2 = sy(g.y[sc.b]);
              // 원래 도로와 겹치지 않게 살짝 휘어서 그린다
              const nx = -(y2 - y1), ny = x2 - x1;
              const len = Math.hypot(nx, ny) || 1;
              const cx = (x1 + x2) / 2 + (nx / len) * 28, cy = (y1 + y2) / 2 + (ny / len) * 28;
              const isNew = i === shortcuts.length - 1 && f.phase === "전처리";
              return (
                <g key={`sc${i}`}>
                  <path d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`} fill="none" stroke="var(--algo-cch)" strokeWidth={isNew ? 3.5 : 2.2} strokeDasharray="7 4" />
                  <text x={cx} y={cy} textAnchor="middle" fontSize="11" fill="var(--algo-cch)" fontWeight={700}>
                    {sc.cost}
                  </text>
                </g>
              );
            })}
            {CLASSROOM_NODES.map((n, v) => {
              const isCur = f.current === v;
              const seen = visited.has(v);
              const label = f.labels?.[v];
              return (
                <g key={n.name}>
                  <circle
                    cx={sx(n.x)}
                    cy={sy(n.y)}
                    r={isCur ? 19 : 16}
                    fill={seen ? color : "var(--surface)"}
                    fillOpacity={seen ? (isCur ? 1 : 0.35) : 1}
                    stroke={isCur ? "var(--text)" : v === CLASSROOM_SOURCE || v === CLASSROOM_TARGET ? "var(--text)" : "var(--road)"}
                    strokeWidth={isCur ? 3.5 : 2}
                  />
                  <text x={sx(n.x)} y={sy(n.y) + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--text)">
                    {n.name}
                  </text>
                  {scene.ranks && (
                    <g>
                      <circle cx={sx(n.x) + 16} cy={sy(n.y) - 15} r={9} fill="var(--algo-cch)" />
                      <text x={sx(n.x) + 16} y={sy(n.y) - 11} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
                        {scene.ranks[v]}
                      </text>
                    </g>
                  )}
                  {label && (
                    <text x={sx(n.x)} y={sy(n.y) + 34} textAnchor="middle" fontSize="12" fontWeight="700" fill={color}>
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs muted mt-2">
            <span>
              <span className="swatch" style={{ background: color }} />
              지금 보는 교차로 (굵은 테두리)
            </span>
            <span>
              <span className="swatch" style={{ background: color, opacity: 0.35 }} />
              이미 본 교차로
            </span>
            {algo === "dfs" && (
              <>
                <span>
                  <span className="swatch" style={{ background: color }} />
                  지금 따라가는 길
                </span>
                <span>
                  <span className="swatch" style={{ background: "var(--good)" }} />
                  현재 최고 기록 길 (점선)
                </span>
              </>
            )}
            {(algo === "dijkstra" || algo === "astar") && <span>교차로 아래 숫자 = 출발점에서의 거리</span>}
            {algo === "cch" && (
              <>
                <span>
                  <span className="swatch" style={{ background: "var(--algo-cch)" }} />
                  보라 동그라미 = 중요도 순위, 보라 점선 = 지름길
                </span>
                <span>↑ 출발 쪽 비용 · ↓ 도착 쪽 비용</span>
              </>
            )}
            {algo === "lpa" && (
              <>
                <span>
                  <span className="swatch" style={{ background: "var(--jam)" }} />
                  혼잡 도로
                </span>
                <span>숫자 = 알고 있는 비용, ? = 다시 계산 중</span>
              </>
            )}
            <span>
              <span className="swatch" style={{ background: "var(--text)" }} />
              최종 경로
            </span>
          </div>
        </section>

        <section className="card flex flex-col gap-2">
          <h3 className="font-semibold">진행 순서</h3>
          <ol className="text-sm flex flex-col gap-1 max-h-80 overflow-auto num">
            {steps.slice(0, frame + 1).map((x, i) => (
              <li key={i} className={i === frame ? "font-semibold" : "muted"}>
                {i + 1}. {x.text}
              </li>
            ))}
          </ol>
          {done && <p className="text-sm mt-auto pt-2 border-t border-border">{scene.result}</p>}
        </section>
      </div>
    </div>
  );
}
