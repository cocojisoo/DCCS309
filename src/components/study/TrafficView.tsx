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
  astar: "Searches again from the start with the new costs",
  cch: "Recomputes only the shortcuts touching changed roads, then queries",
  lpa: "Reuses the previous search and recomputes only around the change",
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
        No congestion and closure results found. Run <code>npm run study:traffic</code>.
      </p>
    );
  if (!json || !index) return <p className="muted text-sm">Loading map…</p>;

  const best = cs ? algos.map((a) => cs.runs[a]).find((r) => r?.status === "SUCCESS") : undefined;
  const jam = changes.filter((c) => c.kind === "congestion");
  const closed = changes.filter((c) => c.kind === "closure");

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        <p className="text-sm muted">
          On this map ({index.size.title}, {formatInt(index.size.nodes)} intersections), a route is first found in the normal state. When road conditions change,
          A*, CCH and LPA* each find the <b>new route with the shortest travel time</b> in their own way. The cost is travel time in seconds, and in the normal
          state every road is 30km/h.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="tabs" role="tablist" aria-label="Situation">
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
          <div className="tabs" role="tablist" aria-label="Start and end route">
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
                Route {i + 1} · straight-line {formatDistance(p.straightM)}
              </button>
            ))}
          </div>
          <div className="flex gap-2 ml-auto">
            <button className="btn" onClick={reset} disabled={frame < 0}>
              Reset
            </button>
            <button
              className="btn btn-primary"
              disabled={!cs}
              onClick={() => {
                if (done) setFrame(-1);
                setPlaying(!running);
              }}
            >
              {running ? "⏸ Pause" : "▶ Search again"}
            </button>
            <button
              className="btn"
              disabled={!cs}
              onClick={() => {
                setPlaying(false);
                setFrame(maxFrames - 1);
              }}
            >
              Show result ⏭
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs muted">
          <span>
            <span className="swatch" style={{ background: "var(--jam)" }} />
            {jam.length} congested roads (travel time ×3–6{jam.some((c) => c.onNormalRoute) ? `, ${jam.filter((c) => c.onNormalRoute).length} on the normal route` : ""})
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--closed)" }} />
            {closed.length} closed roads (marked ✕{closed.some((c) => c.onNormalRoute) ? `, ${closed.filter((c) => c.onNormalRoute).length} on the normal route` : ""})
          </span>
          <span>
            <svg width="26" height="10" className="inline-block mr-1 align-middle" aria-hidden>
              <line x1="1" y1="5" x2="25" y2="5" stroke="var(--text-3)" strokeWidth="2.5" strokeDasharray="5 4" />
            </svg>
            Route found in the normal state
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--text)" }} />
            New route (shown when finished)
          </span>
        </div>
      </section>

      {!file || !cs ? (
        <p className="muted text-sm">Loading recording…</p>
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
            Computation time is the median of 5 measurements of the time from the change until a new route is returned. Normal-state preparation (CCH
            preprocessing and customization, LPA*&apos;s first plan) is excluded because it was already done before the change. Markers on the map are the
            intersections examined while searching again.
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
        <div className="font-semibold">✓ The route with the shortest estimated travel time is confirmed.</div>
        <div className="text-xs faint mt-0.5">All three methods found the same route. The thick black line is the final answer, and the gray dashed line is the normal-state route.</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Final route length" value={formatDistance(best.lengthM ?? NaN)} note={`Normal ${formatDistance(n.lengthM)}`} />
        <Tile label="Estimated travel time" value={formatTravel(best.timeS)} note={`Normal ${formatTravel(n.timeS)}`} />
        <Tile
          label="If you keep the normal route"
          value={nowS === null ? "Impassable" : formatTravel(nowS)}
          note={nowS === null ? "It uses a closed road" : `+${formatTravel(nowS - n.timeS)} over normal`}
          bad
        />
        <Tile
          label="Time saved by the new route"
          value={saved === null ? "—" : saved < 0.05 ? "0 s" : formatTravel(saved)}
          note={saved === null ? "The normal route is blocked" : "Compared with keeping the normal route"}
        />
      </div>
      <p className="text-sm">
        <b>{same ? "The same route as the normal state was chosen." : "A different route from the normal state was chosen."}</b>{" "}
        <span className="muted">
          Normal → now: route length {formatDistance(n.lengthM)} → {formatDistance(best.lengthM ?? NaN)} · estimated travel time {formatTravel(n.timeS)} →{" "}
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
      <dt className="muted">Status</dt>
      <dd className="text-right">
        {finished ? (
          <span className={`badge ${ok ? "badge-good" : "badge-bad"}`}>{STATUS_LABEL[run.status]}</span>
        ) : (
          <span className="faint">{f ? "Searching again…" : "Waiting"}</span>
        )}
      </dd>
      <dt className="muted">Final route length</dt>
      <dd className="text-right">{finished && ok ? formatDistance(run.lengthM!) : "—"}</dd>
      <dt className="muted">Estimated travel time</dt>
      <dd className="text-right">{finished && ok ? formatTravel(run.timeS) : "—"}</dd>
      <dt className="muted">Intersections examined</dt>
      <dd className="text-right">{formatInt(f ? f.visited : 0)}</dd>
      <dt className="muted">Computation time</dt>
      <dd className="text-right">{finished ? formatMs(run.searchMs) : "—"}</dd>
      {algo === "cch" && finished && (
        <>
          <dt className="muted">└ Shortcuts recomputed</dt>
          <dd className="text-right">
            {formatInt(run.recomputedArcs ?? 0)} · {formatMs(run.customizeMs ?? NaN)}
          </dd>
          <dt className="muted">└ Query</dt>
          <dd className="text-right">{formatMs(run.queryMs ?? NaN)}</dd>
        </>
      )}
      <dd className="col-span-2 text-xs faint mt-1">{RESPONSE[algo]}</dd>
    </dl>
  );
}
