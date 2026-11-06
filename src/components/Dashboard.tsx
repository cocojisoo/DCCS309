"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ALGORITHMS, ALGORITHM_BY_ID, DFS_TIME_LIMIT_MS, type AlgorithmId } from "@/lib/algorithms";
import { edgesToLatLngs, runBenchmark, TIMING_RUNS, type BenchmarkResult, type ModeRun } from "@/lib/benchmark";
import { END, MODE_LABEL, PENALTY_SEC, SPEED_KMH, START, type Mode } from "@/lib/config";
import { formatDistance, formatDuration, formatInt, formatMs } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import GroupedBarChart, { type BarSeries } from "./GroupedBarChart";
import type { ExploredLayer, PathLayer } from "./RouteMap";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="map-box grid place-items-center muted">Loading map…</div>,
});

const MODES: Mode[] = ["car", "walk"];
const MODE_COLOR: Record<Mode, string> = { car: "var(--car)", walk: "var(--walk)" };
const SERIES: BarSeries[] = MODES.map((m) => ({ key: m, label: MODE_LABEL[m], color: MODE_COLOR[m] }));

function exploredSegments(run: ModeRun, algo: AlgorithmId): [LatLng, LatLng][] {
  const r = run.runs.find((x) => x.algorithm === algo)!;
  const g = run.graph;
  return r.explored.map(([a, b]) => [
    [g.lat[a], g.lng[a]],
    [g.lat[b], g.lng[b]],
  ]);
}

const STATUS_NOTE: Record<string, string> = { TIMEOUT: "Timed out", NO_PATH: "No path", ERROR: "Error" };

const ALGO_CAPTION: Record<AlgorithmId, string> = {
  dfs: "It follows every path to its end, so on a map this size it cannot finish within 2 seconds.",
  dijkstra: "It settles intersections nearest to the start first, spreading out in a circle.",
  astar: "It uses the straight-line distance to the destination as a hint and looks toward the destination first.",
  cch: "Using precomputed shortcuts, it climbs from both the start and the destination toward more important intersections and finds where they meet.",
  lpa: "The first search resembles A*. When road conditions change, it recomputes only around the change (see the congestion and closure experiment).",
};

export default function Dashboard() {
  const [penalties, setPenalties] = useState(true);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [algo, setAlgo] = useState<AlgorithmId>("dijkstra");
  const [visible, setVisible] = useState<Record<Mode, boolean>>({ car: true, walk: true });
  const [replay, setReplay] = useState(0);

  async function start() {
    setStatus("running");
    setError("");
    try {
      const r = await runBenchmark(penalties, setProgress);
      setResult(r);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  const mapLayers = useMemo(() => {
    if (!result) return { explored: [] as ExploredLayer[], paths: [] as PathLayer[] };
    const explored: ExploredLayer[] = [];
    const paths: PathLayer[] = [];
    for (const mode of MODES) {
      if (!visible[mode]) continue;
      const run = result.modes[mode];
      const r = run.runs.find((x) => x.algorithm === algo)!;
      explored.push({ color: MODE_COLOR[mode], segments: exploredSegments(run, algo) });
      paths.push({
        color: MODE_COLOR[mode],
        points: edgesToLatLngs(run.graph, r.pathEdges),
        label: `${MODE_LABEL[mode]} · ${ALGORITHM_BY_ID[algo].name} · ${formatDuration(r.costSec)}`,
        dash: mode === "walk" ? "10 7" : undefined,
      });
    }
    return { explored, paths };
  }, [result, algo, visible]);

  const runsFor = (mode: Mode) => result!.modes[mode].runs;
  const chartRows = (pick: (r: ModeRun["runs"][number]) => number) =>
    ALGORITHMS.map((a) => {
      const rs = MODES.map((m) => [m, runsFor(m).find((r) => r.algorithm === a.id)!] as const);
      return {
        label: a.name,
        values: Object.fromEntries(rs.map(([m, r]) => [m, pick(r)])),
        notes: Object.fromEntries(rs.map(([m, r]) => [m, STATUS_NOTE[r.status] ?? "—"])),
      };
    });

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {START.name} → {END.name}
          </h1>
          <p className="muted text-sm mt-1">
            Runs five shortest-path algorithms on the road and sidewalk networks at fixed speeds: car {SPEED_KMH.car}km/h, walking {SPEED_KMH.walk}km/h.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={penalties} onChange={(e) => setPenalties(e.target.checked)} className="w-4 h-4" />
            Real-world penalties (intersection +{PENALTY_SEC.intersection} s · crosswalk +{PENALTY_SEC.crossing} s)
          </label>
          <button className="btn btn-primary" onClick={start} disabled={status === "running"}>
            {status === "running" ? "Running…" : result ? "Run again" : "▶ Start"}
          </button>
        </div>
      </section>

      {status === "running" && <div className="text-sm muted">{progress}</div>}
      {status === "error" && (
        <div className="card text-sm" style={{ borderColor: "var(--bad)" }}>
          Run failed: {error}
        </div>
      )}

      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="tabs" role="tablist" aria-label="Algorithm shown on the map">
            {ALGORITHMS.map((a) => (
              <button key={a.id} role="tab" className="tab" aria-selected={algo === a.id} onClick={() => setAlgo(a.id)}>
                {a.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {MODES.map((m) => (
              <label key={m} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={visible[m]} onChange={(e) => setVisible({ ...visible, [m]: e.target.checked })} />
                <span className="swatch" style={{ background: MODE_COLOR[m] }} />
                {MODE_LABEL[m]}
                {m === "walk" && <span className="faint text-xs">(dashed)</span>}
              </label>
            ))}
            <button className="btn text-sm !py-1" onClick={() => setReplay((x) => x + 1)} disabled={!result}>
              ↻ Replay search
            </button>
          </div>
        </div>
        <RouteMap
          explored={mapLayers.explored}
          paths={mapLayers.paths}
          animationKey={result ? `${result.startedAt}|${algo}|${visible.car}|${visible.walk}|${replay}` : "empty"}
        />
        <p className="text-xs faint">
          {result
            ? `Faint lines are the ${algo === "cch" ? "precomputed shortcuts (drawn as straight lines)" : "edges"} explored by ${ALGORITHM_BY_ID[algo].name}, and thick lines are the routes found. ${ALGO_CAPTION[algo]}`
            : "Press ▶ Start to run every algorithm on the road and sidewalk networks and replay the selected algorithm's search on the map."}
        </p>
      </section>

      {result && (
        <>
          <section className="grid md:grid-cols-3 gap-3">
            <GroupedBarChart
              title="Travel time"
              subtitle="Travel time of the route found · methods that finish within 2 s all match"
              series={SERIES}
              rows={chartRows((r) => r.costSec)}
              format={formatDuration}
            />
            <GroupedBarChart
              title="Nodes explored"
              subtitle="Fewer is better · DFS: nodes entered before stopping · CCH: nodes climbed"
              series={SERIES}
              rows={chartRows((r) => r.visited)}
              format={formatInt}
            />
            <GroupedBarChart
              title="Search time"
              subtitle={`Per-run average, median of ${TIMING_RUNS} measurements · CCH: query only · varies by browser`}
              series={SERIES}
              rows={chartRows((r) => r.runtimeMs).map((row) => ({ ...row, notes: undefined }))}
              format={formatMs}
            />
          </section>

          <section className="card">
            <h2 className="font-semibold mb-3">Detailed statistics</h2>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Algorithm</th>
                    <th>Mode</th>
                    <th>Route length</th>
                    <th>Travel time</th>
                    <th>Penalty time (count)</th>
                    <th>Nodes explored</th>
                    <th>Edge relaxations</th>
                    <th>Search time</th>
                    <th>Optimal route</th>
                  </tr>
                </thead>
                <tbody>
                  {ALGORITHMS.flatMap((a) =>
                    MODES.map((m) => {
                      const r = runsFor(m).find((x) => x.algorithm === a.id)!;
                      return (
                        <tr key={`${a.id}-${m}`}>
                          <td>{m === "car" ? a.name : ""}</td>
                          <td>
                            <span className="swatch" style={{ background: MODE_COLOR[m] }} />
                            {m === "car" ? "Car" : "Walking"}
                          </td>
                          <td>{formatDistance(r.distanceM)}</td>
                          <td>{formatDuration(r.costSec)}</td>
                          <td>{result.penalties && r.found ? `${formatDuration(r.penaltySec)} (${r.penaltyCount})` : "—"}</td>
                          <td>{formatInt(r.visited)}</td>
                          <td>{formatInt(r.relaxations)}</td>
                          <td>{formatMs(r.runtimeMs)}</td>
                          <td>
                            {r.optimal ? (
                              <span className="badge badge-good">✓ Optimal</span>
                            ) : (
                              <span className="badge badge-bad">{r.found ? "✗ Not optimal" : `✗ ${STATUS_NOTE[r.status]}`}</span>
                            )}
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs faint mt-3">
              Start and end coordinates snap to the nearest graph node (road: start moved {result.modes.car.snapStartM.toFixed(0)}m / end{" "}
              {result.modes.car.snapEndM.toFixed(0)}m, sidewalk: start moved {result.modes.walk.snapStartM.toFixed(0)}m / end{" "}
              {result.modes.walk.snapEndM.toFixed(0)}m). Graphs: {formatInt(result.modes.car.graph.n)} road nodes,{" "}
              {formatInt(result.modes.walk.graph.n)} sidewalk nodes · OSM data as of {result.modes.car.graph.meta.osmTimestamp ?? "unknown"}
            </p>
            <p className="text-xs faint mt-1">
              CCH search time covers the query only. One-time setup before use: preprocessing (building shortcuts from the map&apos;s shape) road{" "}
              {formatMs(result.modes.car.cch.prepMs)} · sidewalk {formatMs(result.modes.walk.cch.prepMs)}, customization (filling in costs) road{" "}
              {formatMs(result.modes.car.cch.customizeMs)} · sidewalk {formatMs(result.modes.walk.cch.customizeMs)}. DFS runs for at most{" "}
              {DFS_TIME_LIMIT_MS / 1000} s per run.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
