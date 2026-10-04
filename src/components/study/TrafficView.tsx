"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistance, formatInt, formatMs } from "@/lib/format";
import type { StudyGraphJson } from "@/lib/study/graph";
import type { StudyAlgorithmId } from "@/lib/study/search";
import { TRAFFIC_SCENARIOS, type TrafficDemoFile, type TrafficDemoRun, type TrafficIndex, type TrafficScenarioId } from "@/lib/study/traffic";
import { AlgoHeading } from "./CompareView";
import SearchCanvas from "./SearchCanvas";
import { fetchJson, formatTravel, STATUS_LABEL } from "./shared";

const FPS = 12;

/** 계산 시간에 무엇이 들어가는지 (방법마다 상황이 바뀐 뒤 하는 일이 다르다) */
const RESPONSE: Partial<Record<StudyAlgorithmId, string>> = {
  astar: "바뀐 비용으로 처음부터 다시 탐색",
  cch: "바뀐 도로에 닿는 지름길만 다시 계산 + 질의",
  lpa: "지난 탐색을 재사용해 바뀐 곳 근처만 다시 계산",
};

export default function TrafficView() {
  const [json, setJson] = useState<StudyGraphJson | null>(null);
  const [index, setIndex] = useState<TrafficIndex | null>(null);
  const [missing, setMissing] = useState(false);
  const [pairIdx, setPairIdx] = useState(0);
  const [scenario, setScenario] = useState<TrafficScenarioId>("congestion");
  const [file, setFile] = useState<TrafficDemoFile | null>(null);
  const [frame, setFrame] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    Promise.all([fetchJson<StudyGraphJson>("/graph/study.json"), fetchJson<TrafficIndex>("/study/traffic/index.json")]).then(([g, idx]) => {
      if (!g || !idx?.pairs.length) return setMissing(true);
      setJson(g);
      setIndex(idx);
    });
  }, []);

  const odId = index?.pairs[pairIdx]?.odId;
  useEffect(() => {
    if (!odId) return;
    let alive = true;
    fetchJson<TrafficDemoFile>(`/study/traffic/${odId}.json`).then((d) => alive && setFile(d));
    return () => {
      alive = false;
    };
  }, [odId]);

  const cs = file?.odId === odId ? file?.cases.find((c) => c.scenario === scenario) : undefined;
  const algos = index?.algorithms ?? [];
  const maxFrames = cs ? Math.max(...algos.map((a) => cs.runs[a]?.frames.length ?? 0)) : 0;
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
  const changes = useMemo(() => cs?.changes ?? [], [cs]);

  if (missing)
    return (
      <p className="card text-sm">
        혼잡 · 폐쇄 실험 결과가 없습니다. <code>npm run study:traffic</code> 을 실행하세요.
      </p>
    );
  if (!json || !index) return <p className="muted text-sm">지도 불러오는 중…</p>;

  const best = cs ? algos.map((a) => cs.runs[a]).find((r) => r?.status === "SUCCESS") : undefined;
  const jam = changes.filter((c) => c.kind === "congestion");
  const closed = changes.filter((c) => c.kind === "closure");

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        <p className="text-sm muted">
          {index.size.title} 지도(교차로 {formatInt(index.size.nodes)}개)에서 정상 상태로 경로를 찾아 둔 뒤, 도로 상황이 바뀌면 A*, CCH, LPA* 가 각자의
          방식으로 <b>이동시간이 가장 짧은 새 경로</b>를 찾습니다. 비용은 이동시간(초)이고, 정상 상태는 모든 도로 30km/h 입니다.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="tabs" role="tablist" aria-label="상황">
            {TRAFFIC_SCENARIOS.map((s) => (
              <button
                key={s.id}
                role="tab"
                className="tab"
                aria-selected={scenario === s.id}
                title={s.detail}
                onClick={() => {
                  setScenario(s.id);
                  reset();
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
          <span className="faint">|</span>
          <div className="tabs" role="tablist" aria-label="출발·도착 경로">
            {index.pairs.map((p, i) => (
              <button
                key={p.odId}
                role="tab"
                className="tab"
                aria-selected={pairIdx === i}
                title={p.odId}
                onClick={() => {
                  setPairIdx(i);
                  reset();
                }}
              >
                경로 {i + 1} · 직선 {formatDistance(p.straightM)}
              </button>
            ))}
          </div>
          <div className="flex gap-2 ml-auto">
            <button className="btn" onClick={reset} disabled={frame < 0}>
              처음
            </button>
            <button
              className="btn btn-primary"
              disabled={!cs}
              onClick={() => {
                if (done) setFrame(-1);
                setPlaying(!running);
              }}
            >
              {running ? "⏸ 멈춤" : "▶ 다시 찾기"}
            </button>
            <button
              className="btn"
              disabled={!cs}
              onClick={() => {
                setPlaying(false);
                setFrame(maxFrames - 1);
              }}
            >
              결과로 ⏭
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs muted">
          <span>
            <span className="swatch" style={{ background: "var(--jam)" }} />
            혼잡 도로 {jam.length}개 (이동시간 ×3~6{jam.some((c) => c.onNormalRoute) ? `, 정상 경로 위 ${jam.filter((c) => c.onNormalRoute).length}개` : ""})
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--closed)" }} />
            폐쇄 도로 {closed.length}개 (✕ 표시{closed.some((c) => c.onNormalRoute) ? `, 정상 경로 위 ${closed.filter((c) => c.onNormalRoute).length}개` : ""})
          </span>
          <span>
            <svg width="26" height="10" className="inline-block mr-1 align-middle" aria-hidden>
              <line x1="1" y1="5" x2="25" y2="5" stroke="var(--text-3)" strokeWidth="2.5" strokeDasharray="5 4" />
            </svg>
            정상 상태에서 찾은 경로
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--text)" }} />
            새로 찾은 경로 (끝나면 표시)
          </span>
        </div>
      </section>

      {!file || !cs ? (
        <p className="muted text-sm">기록 불러오는 중…</p>
      ) : (
        <>
          {best && <Outcome file={file} nowS={cs.normalRouteNowS} best={best} />}
          <div className="grid md:grid-cols-3 gap-3">
            {algos.map((a) => {
              const run = cs.runs[a];
              if (!run) return null;
              return (
                <div key={a} className="flex flex-col gap-2">
                  <AlgoHeading id={a} />
                  <SearchCanvas
                    json={json}
                    edgeIds={file.edgeIds}
                    nodes={file.size.nodes}
                    od={file.od}
                    run={run}
                    algo={a}
                    frame={frame}
                    changes={changes}
                    ghostPath={file.normal.pathEdges}
                  />
                  <ResponseCard algo={a} run={run} frame={frame} />
                </div>
              );
            })}
          </div>
          <p className="text-xs faint">
            계산 시간은 상황이 바뀐 뒤 새 경로를 내놓기까지 걸린 시간의 {`5회`} 측정 중간값입니다. 정상 상태 준비(CCH 의 전처리·커스터마이징, LPA* 의 첫
            계획)는 상황이 바뀌기 전에 이미 해 둔 일이라 넣지 않았습니다. 지도에 찍히는 점은 다시 찾으면서 본 교차로입니다.
          </p>
        </>
      )}
    </div>
  );
}

/** 정상 상태 대비 결과 (세 방법이 모두 같은 최적 경로를 찾으므로 한 번만 보여 준다) */
function Outcome({ file, nowS, best }: { file: TrafficDemoFile; nowS: number | null; best: TrafficDemoRun }) {
  const n = file.normal;
  const same = best.pathEdges.length === n.pathEdges.length && best.pathEdges.every((e, i) => e === n.pathEdges[i]);
  const saved = nowS === null ? null : nowS - (best.timeS ?? 0);
  return (
    <section className="card !p-4 flex flex-col gap-3" style={{ borderLeft: "4px solid var(--good)" }}>
      <div>
        <div className="font-semibold">✓ 추정 이동시간이 가장 짧은 경로를 확정했습니다.</div>
        <div className="text-xs faint mt-0.5">세 방법 모두 같은 경로를 찾았습니다. 지도 위 굵은 검은 선이 최종 답이고, 회색 점선은 정상 상태의 경로입니다.</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="최종 경로 거리" value={formatDistance(best.lengthM ?? NaN)} note={`정상 ${formatDistance(n.lengthM)}`} />
        <Tile label="차량 추정 이동시간" value={formatTravel(best.timeS)} note={`정상 ${formatTravel(n.timeS)}`} />
        <Tile
          label="정상 경로를 그대로 가면"
          value={nowS === null ? "갈 수 없음" : formatTravel(nowS)}
          note={nowS === null ? "폐쇄된 도로를 지남" : `정상보다 +${formatTravel(nowS - n.timeS)}`}
          bad
        />
        <Tile
          label="새 경로로 아낀 시간"
          value={saved === null ? "—" : saved < 0.05 ? "0초" : formatTravel(saved)}
          note={saved === null ? "정상 경로는 막혀 있음" : "정상 경로를 그대로 갈 때보다"}
        />
      </div>
      <p className="text-sm">
        <b>{same ? "정상 상태와 같은 경로를 선택했습니다." : "정상 상태와 다른 경로를 선택했습니다."}</b>{" "}
        <span className="muted">
          정상 → 현재: 경로 거리 {formatDistance(n.lengthM)} → {formatDistance(best.lengthM ?? NaN)} · 차량 추정 이동시간 {formatTravel(n.timeS)} →{" "}
          {formatTravel(best.timeS)}
        </span>
      </p>
    </section>
  );
}

function Tile({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
      <div className="text-xs muted">{label}</div>
      <div className="text-xl font-bold num mt-0.5" style={bad ? { color: "var(--bad)" } : undefined}>
        {value}
      </div>
      {note && <div className="text-xs faint mt-0.5">{note}</div>}
    </div>
  );
}

function ResponseCard({ algo, run, frame }: { algo: StudyAlgorithmId; run: TrafficDemoRun; frame: number }) {
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
          <span className="faint">{f ? "다시 찾는 중…" : "대기"}</span>
        )}
      </dd>
      <dt className="muted">최종 경로 거리</dt>
      <dd className="text-right">{finished && ok ? formatDistance(run.lengthM!) : "—"}</dd>
      <dt className="muted">차량 추정 이동시간</dt>
      <dd className="text-right">{finished && ok ? formatTravel(run.timeS) : "—"}</dd>
      <dt className="muted">본 교차로</dt>
      <dd className="text-right">{formatInt(f ? f.visited : 0)}</dd>
      <dt className="muted">계산 시간</dt>
      <dd className="text-right">{finished ? formatMs(run.searchMs) : "—"}</dd>
      {algo === "cch" && finished && (
        <>
          <dt className="muted">└ 지름길 다시 계산</dt>
          <dd className="text-right">
            {formatInt(run.recomputedArcs ?? 0)}개 · {formatMs(run.customizeMs ?? NaN)}
          </dd>
          <dt className="muted">└ 질의</dt>
          <dd className="text-right">{formatMs(run.queryMs ?? NaN)}</dd>
        </>
      )}
      <dd className="col-span-2 text-xs faint mt-1">{RESPONSE[algo]}</dd>
    </dl>
  );
}
