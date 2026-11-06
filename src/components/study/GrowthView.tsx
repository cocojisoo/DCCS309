"use client";

import { useState } from "react";
import { formatDistance, formatInt, formatMs } from "@/lib/format";
import { STUDY_ALGORITHMS } from "@/lib/study/search";
import type { StudySummary, SummaryRow } from "@/lib/study/summary";
import LogChart, { type LogSeries } from "./LogChart";
import { ALGO_STYLE, formatTravel } from "./shared";

const DASH: Record<string, string | undefined> = { dfs: "7 5", dijkstra: undefined, astar: "2 4", cch: "10 3 2 3", lpa: "4 2" };

export default function GrowthView({ summary }: { summary: StudySummary }) {
  const [track, setTrack] = useState<1 | 2>(2);
  const rows = summary.rows.filter((r) => r.track === track);
  const title = (label: string) => summary.ladder.find((l) => l.label === label);

  const seriesOf = (pick: (r: SummaryRow) => number, fmt: (v: number) => string): LogSeries[] =>
    STUDY_ALGORITHMS.map((a) => ({
      id: a.id,
      label: a.name,
      color: ALGO_STYLE[a.id].color,
      dash: DASH[a.id],
      points: rows
        .filter((r) => r.algorithm === a.id)
        .map((r) => ({
          x: r.graph_nodes,
          y: pick(r),
          cross: r.timeout > 0,
          label: `${r.size_label} (${formatInt(r.graph_nodes)} intersections) · ${fmt(pick(r))}${r.timeout ? ` · timed out ${r.timeout}/${r.runs}` : ""}`,
        })),
    }));

  const limitMs = summary.config.run.dfs_time_limit_s * 1000;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabs" role="tablist" aria-label="Experiment type">
          <button role="tab" className="tab" aria-selected={track === 1} onClick={() => setTrack(1)}>
            Same routes · grow the map only
          </button>
          <button role="tab" className="tab" aria-selected={track === 2} onClick={() => setTrack(2)}>
            Far routes · grow the distance too
          </button>
        </div>
        <span className="text-xs faint">
          {track === 1
            ? `The same ${summary.pairs.track1.length} pairs from the smallest map are used at every size`
            : `At each size, up to ${summary.config.track_growing_od.pairs_max} pairs separated by ${summary.config.track_growing_od.straight_distance_ratio.map((r) => r * 100).join("–")}% of the map's largest straight-line distance`}
        </span>
      </div>

      {summary.heuristic.violations > 0 && (
        <p className="card text-sm" style={{ borderColor: "var(--bad)" }}>
          {summary.heuristic.violations} roads violate the A* hint condition, so A* results are excluded from the official comparison (blueprint 8.4).
        </p>
      )}

      <LogChart
        title="Search time by map size"
        subtitle={`Median of ${summary.config.run.repeats} repeats per route, then median across routes · both axes logarithmic · CCH: query only (preprocessing in the table below)`}
        xLabel="Actual intersections"
        yLabel="Search time (ms)"
        series={seriesOf((r) => r.median_ms, formatMs)}
        formatY={(v) => (v >= 1 ? `${v.toLocaleString("en-US")}ms` : `${v}ms`)}
        refLine={{ y: limitMs, label: `DFS time limit ${summary.config.run.dfs_time_limit_s} s` }}
      />
      <LogChart
        title="Visits by map size"
        subtitle="Total times an intersection was entered (re-entries count again) · median across pairs"
        xLabel="Actual intersections"
        yLabel="Visits"
        series={seriesOf((r) => r.median_visits, formatInt)}
        formatY={(v) => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}K` : String(v))}
      />

      <details className="card">
        <summary className="cursor-pointer font-semibold">View as a table (same values as summary.csv)</summary>
        <div className="table-wrap mt-3">
          <table className="data">
            <thead>
              <tr>
                <th>Size</th>
                <th>Intersections</th>
                <th>Method</th>
                <th>Pairs</th>
                <th>Success / timeout</th>
                <th>Median time</th>
                <th>Range</th>
                <th>Median visits</th>
                <th>Visits ÷ unique</th>
                <th>Median length</th>
                <th>Travel time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.size_label}-${r.algorithm}`}>
                  <td>{r.algorithm === "dfs" ? title(r.size_label)?.label : ""}</td>
                  <td>{r.algorithm === "dfs" ? formatInt(r.graph_nodes) : ""}</td>
                  <td>
                    <span className="swatch" style={{ background: ALGO_STYLE[r.algorithm].color }} />
                    {STUDY_ALGORITHMS.find((a) => a.id === r.algorithm)!.name}
                  </td>
                  <td>{r.od_count}</td>
                  <td>
                    {r.success} / <span className={r.timeout ? "badge-bad" : ""}>{r.timeout}</span>
                  </td>
                  <td>{formatMs(r.median_ms)}</td>
                  <td className="faint">
                    {formatMs(r.min_ms)} ~ {formatMs(r.max_ms)}
                  </td>
                  <td>{formatInt(Math.round(r.median_visits))}</td>
                  <td>{r.median_visit_ratio.toFixed(r.median_visit_ratio >= 100 ? 0 : 2)}</td>
                  <td>{r.median_route_m === null ? "—" : formatDistance(r.median_route_m)}</td>
                  <td>{formatTravel(r.median_route_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {summary.log.cch?.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">One-time CCH setup by map size</summary>
          <p className="text-xs faint mt-2">
            Preprocessing builds shortcuts from the road layout (only when the map changes). Customization fills costs into the shortcuts (whenever costs change).
            The CCH search time in the charts above covers the query only.
          </p>
          <div className="table-wrap mt-2">
            <table className="data">
              <thead>
                <tr>
                  <th>Size</th>
                  <th>Intersections</th>
                  <th>Shortcuts</th>
                  <th>Preprocessing</th>
                  <th>Customization</th>
                </tr>
              </thead>
              <tbody>
                {summary.log.cch.map((c) => (
                  <tr key={c.sizeLabel}>
                    <td>{c.sizeLabel}</td>
                    <td>{formatInt(c.nodes)}</td>
                    <td>{formatInt(c.shortcuts)}</td>
                    <td>{formatMs(c.prepMs)}</td>
                    <td>{formatMs(c.customizeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
