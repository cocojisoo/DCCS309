"use client";

import { useEffect, useState } from "react";
import { formatDistance, formatInt, formatMs } from "@/lib/format";
import type { DemoFile, DemoIndexEntry, DemoRun } from "@/lib/study/demo";
import type { StudyGraphJson } from "@/lib/study/graph";
import { STUDY_ALGORITHMS, type StudyAlgorithmId } from "@/lib/study/search";
import SearchCanvas from "./SearchCanvas";
import { ALGO_STYLE, fetchJson, formatTravel, STATUS_LABEL } from "./shared";

const FPS = 12;

/** 출발·도착 쌍 이름: "Route 1", "Route 2" … (작은 지도에서 고른 고정 쌍은 따로 표시) */
export function pairLabel(i: number, track: 1 | 2) {
  return `Route ${i + 1}${track === 1 ? " (same at every size)" : ""}`;
}

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
        No search recordings found. Build the map with <code>npm run study:graph</code> and create the recordings with <code>npm run study:traces</code>.
      </p>
    );
  if (!json || !index || !entry) return <p className="muted text-sm">Loading map…</p>;

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">
            Map size: {entry.title} <span className="muted font-normal">· {formatInt(entry.nodes)} actual intersections · {formatInt(entry.edges)} roads</span>
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
            aria-valuetext={`${entry.title}, ${entry.nodes} intersections`}
          />
          <span className="flex justify-between text-xs faint">
            <span>{index[0].nodes} intersections</span>
            <span>{formatInt(index[index.length - 1].nodes)} intersections ({index[index.length - 1].title})</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="tabs" role="tablist" aria-label="Start and end route">
            {entry.pairs.map((p, i) => (
              <button
                key={p.id}
                role="tab"
                className="tab"
                aria-selected={pairIdx === i}
                title={p.id}
                onClick={() => {
                  setPairIdx(i);
                  reset();
                }}
              >
                {pairLabel(i, p.track)} · straight-line {formatDistance(p.straightM)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={reset} disabled={frame < 0}>
              Reset
            </button>
            <button
              className="btn btn-primary"
              disabled={!pair}
              onClick={() => {
                if (done) setFrame(-1);
                setPlaying(!running);
              }}
            >
              {running ? "⏸ Pause" : "▶ Start search"}
            </button>
            <button
              className="btn"
              onClick={() => {
                setPlaying(false);
                setFrame(maxFrames - 1);
              }}
              disabled={!pair}
            >
              Show result ⏭
            </button>
          </div>
        </div>
      </section>

      {!demo || demo.label !== entry.label || !pair ? (
        <p className="muted text-sm">Loading search recording…</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {STUDY_ALGORITHMS.map((a) => (
            <div key={a.id} className="flex flex-col gap-2">
              <AlgoHeading id={a.id} />
              <SearchCanvas
                json={json}
                edgeIds={demo.edgeIds}
                nodes={demo.nodes}
                od={pair.od}
                run={pair.runs[a.id]}
                algo={a.id}
                frame={frame}
                timeLimitS={timeLimitS}
              />
              <RunCard algo={a.id} run={pair.runs[a.id]} frame={frame} shortest={pair.runs.dijkstra.lengthM} />
            </div>
          ))}
        </div>
      )}
      <p className="text-xs faint">
        Faint markers are visited intersections, the colored line is the path being followed, the green dashed line is DFS&apos;s best path so far, and the
        thick black line is the final route. Each method plays its own search in up to 100 frames at the same speed (only the frames shown are reduced, not
        the search). Search time was measured when the recordings were made (CCH: query only, preprocessing is separate). Official values are under
        &lsquo;Results&rsquo;. Travel time assumes a car driving the route at 30km/h.
      </p>
    </div>
  );
}

export function AlgoHeading({ id }: { id: StudyAlgorithmId }) {
  const a = STUDY_ALGORITHMS.find((x) => x.id === id)!;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="font-semibold">
        <span className="swatch" style={{ background: ALGO_STYLE[id].color }} />
        {a.name} <span className="faint text-xs font-normal">{a.role}</span>
      </h3>
      <span className="faint text-xs whitespace-nowrap">{ALGO_STYLE[id].markerLabel}</span>
    </div>
  );
}

function RunCard({ algo, run, frame, shortest }: { algo: StudyAlgorithmId; run: DemoRun; frame: number; shortest: number | null }) {
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
          <span className="faint">{f ? "Searching…" : "Waiting"}</span>
        )}
      </dd>
      <dt className="muted">Route length</dt>
      <dd className="text-right">
        {!finished ? "—" : ok ? (
          <>
            {formatDistance(run.lengthM!)}
            {shortest !== null && Math.abs(run.lengthM! - shortest) < 0.01 && <span className="faint"> ✓ shortest</span>}
          </>
        ) : (
          <span title={run.bestSoFarM !== null ? `Best found before stopping: ${formatDistance(run.bestSoFarM)} (not used for answer checks)` : undefined}>
            Unverified{run.bestSoFarM !== null && <span className="faint"> (best before stop {formatDistance(run.bestSoFarM)})</span>}
          </span>
        )}
      </dd>
      <dt className="muted">Travel time</dt>
      <dd className="text-right">{!finished ? "—" : ok ? formatTravel(run.timeS) : "Unverified"}</dd>
      <dt className="muted">Search time</dt>
      <dd className="text-right">
        {finished ? formatMs(run.searchMs) : "—"}
        {finished && algo === "cch" && <span className="faint text-xs"> (query)</span>}
      </dd>
      <dt className="muted">Visits</dt>
      <dd className="text-right">{formatInt(f ? f.step : 0)}</dd>
      <dt className="muted">Unique intersections</dt>
      <dd className="text-right">{formatInt(f ? f.visited : 0)}</dd>
      {run.completePaths !== null && (
        <>
          <dt className="muted">Complete paths tried</dt>
          <dd className="text-right">{finished ? formatInt(run.completePaths) : "—"}</dd>
        </>
      )}
    </dl>
  );
}
