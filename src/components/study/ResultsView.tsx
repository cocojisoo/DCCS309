"use client";

import { formatDistance, formatInt, formatMs } from "@/lib/format";
import { STUDY_ALGORITHM_BY_ID, type StudyAlgorithmId } from "@/lib/study/search";
import type { StudySummary } from "@/lib/study/summary";
import { TRAFFIC_SCENARIOS, type TrafficIndex } from "@/lib/study/traffic";
import GroupedBarChart from "../GroupedBarChart";
import GrowthView from "./GrowthView";
import ManyQueries from "./ManyQueries";
import { biggestLabel, normalQuality, pct } from "./metrics";
import { ALGO_STYLE, formatTravel } from "./shared";

/** 지금까지 한 모든 실험의 결과: 정상 상태(크기별) + 혼잡 · 폐쇄 */
export default function ResultsView({ summary, traffic }: { summary: StudySummary; traffic: TrafficIndex | null }) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">① Normal state: did each method find the shortest route and travel time?</h2>
        <NormalTable summary={summary} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">② Normal state: how do search time and visits change as the map grows?</h2>
        <GrowthView summary={summary} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">③ Congestion and closure: how do search time and routes change?</h2>
        {traffic ? (
          <TrafficResults traffic={traffic} />
        ) : (
          <p className="card text-sm">
            No congestion and closure results found. Run <code>npm run study:traffic</code>.
          </p>
        )}
      </section>
    </div>
  );
}

function Name({ id }: { id: StudyAlgorithmId }) {
  return (
    <>
      <span className="swatch" style={{ background: ALGO_STYLE[id].color }} />
      {STUDY_ALGORITHM_BY_ID[id].name}
    </>
  );
}

function NormalTable({ summary }: { summary: StudySummary }) {
  const q = normalQuality(summary);
  const big = summary.ladder.find((l) => l.label === biggestLabel(summary))!;
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data wrap-head">
          <thead>
            <tr>
              <th>Method</th>
              <th>Runs finished</th>
              <th>Shortest route</th>
              <th>Shortest travel time</th>
              <th>Largest map solved</th>
              <th>Search time on largest map ({big.label})</th>
              <th>Travel time there</th>
            </tr>
          </thead>
          <tbody>
            {q.map((r) => {
              const allRight = r.wrong === 0;
              return (
                <tr key={r.algo}>
                  <td>
                    <Name id={r.algo} />
                  </td>
                  <td>
                    {formatInt(r.success)} / {formatInt(r.runs)} <span className="faint">({pct(r.success, r.runs)})</span>
                  </td>
                  <td>
                    {r.success === 0 ? "—" : allRight ? <span className="badge badge-good">All found are shortest</span> : <span className="badge badge-bad">{r.wrong} differ</span>}
                    {r.timeout > 0 && <div className="text-xs badge-bad">{formatInt(r.timeout)} timeouts unverified</div>}
                  </td>
                  <td>
                    {r.success === 0 ? "—" : allRight ? <span className="badge badge-good">All found are fastest</span> : <span className="badge badge-bad">{r.wrong} differ</span>}
                  </td>
                  <td>{r.largestSolved ? `${formatInt(r.largestSolved.graph_nodes)} intersections` : "None"}</td>
                  <td>
                    {!r.biggest ? "—" : r.biggest.timeout === r.biggest.runs ? <span className="badge-bad">Not finished in {summary.config.run.dfs_time_limit_s} s</span> : formatMs(r.biggest.median_ms)}
                  </td>
                  <td>{formatTravel(r.biggest?.median_route_s)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs faint mt-3">
        The normal state assumes every road has the same speed ({summary.config.travel?.car_speed_kmh ?? 30}km/h), so the shortest route is also the fastest.
        &lsquo;Shortest&rsquo; means the length is within 0.01m of another method (Dijkstra) for the same start and end. All runs: {summary.ladder.length} map
        sizes × routes × {summary.config.run.repeats} repeats.
      </p>
    </div>
  );
}

function TrafficResults({ traffic }: { traffic: TrafficIndex }) {
  const algos = traffic.algorithms;
  const scen = TRAFFIC_SCENARIOS;
  const get = (s: string, a: StudyAlgorithmId) => traffic.summary.find((r) => r.scenario === s && r.algorithm === a)!;
  const series = scen.map((s, i) => ({ key: s.id, label: s.name, color: ["var(--jam)", "var(--closed)", "var(--text-2)"][i] }));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm muted">
        Medians over {traffic.pairs.length} routes on one map ({traffic.size.title}, {formatInt(traffic.size.nodes)} intersections). Computation time is the time
        from the change until a new route is returned (A*: from scratch, CCH: changed shortcuts + query, LPA*: only around the change).
      </p>
      <div className="grid md:grid-cols-2 gap-3">
        <GroupedBarChart
          title="Computation time after a change"
          subtitle="Median of 5 measurements, then median across routes"
          series={series}
          rows={algos.map((a) => ({ label: STUDY_ALGORITHM_BY_ID[a].name, values: Object.fromEntries(scen.map((s) => [s.id, get(s.id, a).searchMs])) }))}
          format={formatMs}
        />
        <GroupedBarChart
          title="Intersections examined when searching again"
          subtitle="Fewer means more of the earlier work was reused"
          series={series}
          rows={algos.map((a) => ({ label: STUDY_ALGORITHM_BY_ID[a].name, values: Object.fromEntries(scen.map((s) => [s.id, get(s.id, a).visited])) }))}
          format={formatInt}
        />
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data wrap-head">
            <thead>
              <tr>
                <th>Situation</th>
                <th>Method</th>
                <th>Success</th>
                <th>Normal route · travel time</th>
                <th>New route · travel time</th>
                <th>If you keep the normal route</th>
                <th>Route changed</th>
                <th>Computation time</th>
                <th>Intersections examined</th>
              </tr>
            </thead>
            <tbody>
              {scen.flatMap((s) =>
                algos.map((a, i) => {
                  const r = get(s.id, a);
                  return (
                    <tr key={`${s.id}-${a}`}>
                      <td>{i === 0 ? s.name : ""}</td>
                      <td>
                        <Name id={a} />
                      </td>
                      <td>
                        {r.success} / {r.pairs}
                      </td>
                      <td>
                        {formatDistance(r.normalLengthM)} · {formatTravel(r.normalTimeS)}
                      </td>
                      <td>
                        {formatDistance(r.routeLengthM ?? NaN)} · {formatTravel(r.routeTimeS)}
                      </td>
                      <td>
                        {r.normalRouteNowS === null ? "—" : formatTravel(r.normalRouteNowS)}
                        {r.normalRouteBlocked > 0 && <span className="badge-bad text-xs"> {r.normalRouteBlocked} blocked</span>}
                      </td>
                      <td>
                        {r.routeChanged} / {r.pairs}
                      </td>
                      <td>
                        {formatMs(r.searchMs)}
                        {a === "cch" && r.customizeMs !== null && (
                          <div className="text-xs faint whitespace-normal">
                            {formatInt(r.recomputedArcs ?? 0)} shortcuts {formatMs(r.customizeMs)} + query {formatMs(r.queryMs ?? NaN)}
                          </div>
                        )}
                      </td>
                      <td>{formatInt(r.visited)}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs faint mt-3">
          Length, travel time and &lsquo;keep the normal route&rsquo; are medians across routes. Routes whose normal path is closed are left out of the
          &lsquo;keep the normal route&rsquo; median. All three methods find the route with the shortest travel time, so the route values match. The differences
          are in computation time and intersections examined.
        </p>
      </div>
      <ManyQueries traffic={traffic} />
    </div>
  );
}
