"use client";

import { useEffect, useState } from "react";
import { formatInt, formatMs } from "@/lib/format";
import { STUDY_ALGORITHMS, STUDY_ALGORITHM_BY_ID, type StudyAlgorithmId } from "@/lib/study/search";
import type { StudySummary } from "@/lib/study/summary";
import { TRAFFIC_SCENARIOS, type TrafficIndex } from "@/lib/study/traffic";
import ManyQueries from "./ManyQueries";
import { biggestLabel, normalQuality, pct } from "./metrics";
import { ALGO_STYLE, fetchJson, formatTravel } from "./shared";

/** 정상 상태 — 이론적인 성질과 입력이 커질 때의 장단점 */
const NORMAL: Record<StudyAlgorithmId, { shortest: string; fastest: string; plus: string; minus: string }> = {
  dfs: {
    shortest: "Guaranteed if it runs to the end",
    fastest: "Guaranteed if it runs to the end",
    plus: "Simple idea, and on small maps it can even be the fastest (no setup)",
    minus: "The number of paths grows exponentially, so it soon cannot finish within the time limit and the answer cannot be verified",
  },
  dijkstra: {
    shortest: "Always guaranteed",
    fastest: "Guaranteed (when the cost is travel time)",
    plus: "Each intersection is settled only once, so time grows gently (nearly in proportion) as the map grows",
    minus: "It does not know the goal's direction, so it also searches the opposite side · starts over when road conditions change",
  },
  astar: {
    shortest: "Guaranteed (when the hint never exceeds the true distance)",
    fastest: "Guaranteed (hint = straight-line distance ÷ top speed)",
    plus: "Finds the same answer as Dijkstra while examining far fewer intersections",
    minus: "Needs coordinates · starts over when road conditions change · still searches a lot on very large maps",
  },
  cch: {
    shortest: "Always guaranteed",
    fastest: "Guaranteed (based on the customized costs)",
    plus: "Queries examine very few intersections, an advantage that grows with map size · only customization is redone when costs change",
    minus: "Needs preprocessing time and memory to build shortcuts · complex to implement",
  },
  lpa: {
    shortest: "Always guaranteed",
    fastest: "Guaranteed (when the cost is travel time)",
    plus: "Reuses previous results when recomputing the same start and goal",
    minus: "The first search is similar to A* or slightly slower · uses more memory because each intersection stores more values",
  },
};

function Name({ id }: { id: StudyAlgorithmId }) {
  return (
    <span className="font-semibold whitespace-nowrap">
      <span className="swatch" style={{ background: ALGO_STYLE[id].color }} />
      {STUDY_ALGORITHM_BY_ID[id].name}
    </span>
  );
}

export default function FinalSummaryView() {
  const [summary, setSummary] = useState<StudySummary | null | undefined>(undefined);
  const [traffic, setTraffic] = useState<TrafficIndex | null>(null);

  useEffect(() => {
    fetchJson<StudySummary>("/study/summary.json").then(setSummary);
    fetchJson<TrafficIndex>("/study/traffic/index.json").then(setTraffic);
  }, []);

  if (summary === undefined) return <p className="muted text-sm">Loading…</p>;
  if (!summary)
    return (
      <p className="card text-sm">
        No experiment results found. Run <code>npm run study:run</code> and <code>npm run study:traffic</code> first.
      </p>
    );

  const q = normalQuality(summary);
  const by = (id: StudyAlgorithmId) => q.find((x) => x.algo === id)!;
  const big = summary.ladder.find((l) => l.label === biggestLabel(summary))!;
  const dfs = by("dfs");
  const dij = by("dijkstra").biggest;
  const ast = by("astar").biggest;
  const cch = by("cch").biggest;
  const tr = (s: string, a: StudyAlgorithmId) => traffic?.summary.find((r) => r.scenario === s && r.algorithm === a);
  const both = (a: StudyAlgorithmId) => tr("both", a);

  return (
    <div className="flex flex-col gap-8">
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Size where DFS first broke down"
          value={dfs.firstTimeout.growing ? `${formatInt(dfs.firstTimeout.growing.graph_nodes)} intersections` : "Never"}
          note={`First size where it could not check every path within ${summary.config.run.dfs_time_limit_s} s`}
        />
        <Stat
          label={`A* visits on ${big.label} (${formatInt(big.nodes)} intersections)`}
          value={dij && ast ? `${((ast.median_visits / dij.median_visits) * 100).toFixed(0)}% of Dijkstra` : "—"}
          note={dij && ast ? `${formatInt(Math.round(ast.median_visits))} vs ${formatInt(Math.round(dij.median_visits))} intersections` : undefined}
        />
        <Stat
          label={`CCH query visits on ${big.label}`}
          value={cch ? `${formatInt(Math.round(cch.median_visits))} intersections` : "—"}
          note={cch && dij ? `Search time ${formatMs(cch.median_ms)} (Dijkstra ${formatMs(dij.median_ms)})` : undefined}
        />
        <Stat
          label="Intersections examined after congestion + closure"
          value={both("lpa") && both("astar") ? `LPA* ${formatInt(both("lpa")!.visited)} · A* ${formatInt(both("astar")!.visited)}` : "—"}
          note={both("cch") ? `CCH recomputes ${formatInt(both("cch")!.recomputedArcs ?? 0)} shortcuts` : undefined}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">1. When roads are normal</h2>
        <p className="text-sm muted">
          The normal state assumes every road has the same speed ({summary.config.travel?.car_speed_kmh ?? 30}km/h), so the shortest route is also the route with
          the shortest travel time. Measurements come from {summary.ladder.length} map sizes × several routes × {summary.config.run.repeats} repeats.
        </p>
        <div className="card">
          <div className="table-wrap">
            <table className="data wrap-head">
              <thead>
                <tr>
                  <th>Method</th>
                  <th className="!text-left">Shortest route guaranteed</th>
                  <th className="!text-left">Shortest travel time guaranteed</th>
                  <th className="!text-left">Measured: runs finished · answer match</th>
                  <th className="!text-left">Measured: largest map</th>
                  <th className="!text-left">As input grows: strengths</th>
                  <th className="!text-left">As input grows: weaknesses</th>
                </tr>
              </thead>
              <tbody>
                {STUDY_ALGORITHMS.map(({ id }) => {
                  const r = by(id);
                  const t = NORMAL[id];
                  return (
                    <tr key={id}>
                      <td>
                        <Name id={id} />
                      </td>
                      <td className="!text-left !whitespace-normal">{t.shortest}</td>
                      <td className="!text-left !whitespace-normal">{t.fastest}</td>
                      <td className="!text-left !whitespace-normal">
                        {pct(r.success, r.runs)} · {r.success === 0 ? "—" : r.wrong === 0 ? "All routes found are shortest" : `${r.wrong} differ`}
                        {r.timeout > 0 && <div className="text-xs badge-bad">{formatInt(r.timeout)} timeouts</div>}
                      </td>
                      <td className="!text-left !whitespace-normal">
                        {!r.biggest
                          ? "—"
                          : r.biggest.timeout === r.biggest.runs
                            ? `Not finished in ${summary.config.run.dfs_time_limit_s} s`
                            : `${formatMs(r.biggest.median_ms)} · ${formatInt(Math.round(r.biggest.median_visits))} intersections · travel ${formatTravel(r.biggest.median_route_s)}`}
                      </td>
                      <td className="!text-left !whitespace-normal text-sm">{t.plus}</td>
                      <td className="!text-left !whitespace-normal text-sm">{t.minus}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs faint mt-3">
            CCH search time covers the query only. Preprocessing to build the shortcuts took {formatMs(summary.log.cch?.find((c) => c.sizeLabel === big.label)?.prepMs ?? NaN)} on
            the {big.label} map (once per map).
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">2. Under congestion and closures (A*, CCH, LPA*)</h2>
        <p className="text-sm muted">
          Under congestion and closures, the cost is <b>travel time</b> and the methods look for the route that arrives soonest.
          {traffic && ` (${traffic.size.title}, medians over ${traffic.pairs.length} routes)`}
        </p>
        <div className="card">
          <div className="table-wrap">
            <table className="data wrap-head">
              <thead>
                <tr>
                  <th>Method</th>
                  <th className="!text-left">Shortest route (distance) guaranteed</th>
                  <th className="!text-left">Shortest travel time guaranteed</th>
                  <th className="!text-left">What it does after a change</th>
                  {TRAFFIC_SCENARIOS.map((s) => (
                    <th key={s.id}>{s.name}: computation · examined</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["astar", "cch", "lpa"] as const).map((id) => (
                  <tr key={id}>
                    <td>
                      <Name id={id} />
                    </td>
                    <td className="!text-left !whitespace-normal">No: it picks a longer road if that is faster</td>
                    <td className="!text-left !whitespace-normal">Yes (given the traffic data)</td>
                    <td className="!text-left !whitespace-normal text-sm">
                      {id === "astar" ? "Searches again from the start with the new costs" : id === "cch" ? "Recomputes only the shortcuts touching changed roads, then runs a short query" : "Reuses the previous search and recomputes only what became inconsistent"}
                    </td>
                    {TRAFFIC_SCENARIOS.map((s) => {
                      const r = tr(s.id, id);
                      return (
                        <td key={s.id}>
                          {r ? (
                            <>
                              {formatMs(r.searchMs)} · {formatInt(r.visited)}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {traffic && <TrafficFacts traffic={traffic} />}
        </div>
        {traffic && <ManyQueries traffic={traffic} />}

        <article className="card prose-ko">
          <h2>Why A* is at a disadvantage to CCH and LPA* under congestion</h2>
          <ul>
            <li>
              Real navigation services receive live traffic data such as congestion, accidents and closures every few minutes. Each change means recomputing
              (re-searching) every user&apos;s route, so the <b>computation cost per change</b> drives the total cost.
            </li>
            <li>
              A* does not remember its earlier work, so after each change it searches every route again <b>from the start</b>. This cost keeps adding up as the map
              and the number of users grow.
            </li>
            <li>
              CCH separates the map&apos;s shape (preprocessing) from road costs (customization), so only the shortcuts touching changed roads must be recomputed.
              That work is done once and shared by every user&apos;s query, and each query examines very few intersections.
            </li>
            <li>
              LPA* remembers its previous search and fixes only the intersections that became inconsistent because of the changed roads. The smaller the change,
              the fewer intersections it revisits.
            </li>
            <li>
              The map in this experiment has only thousands of intersections, so even an A* re-search finishes within a few milliseconds. The absolute differences
              are small, and A* can sometimes be faster. The gap becomes decisive when a national road network (tens of millions of intersections), many users and
              minute-by-minute updates combine, which is why methods that cut re-search cost, such as CCH and incremental search, are being developed.
            </li>
          </ul>
        </article>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">3. Limits and directions in real-world systems</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <article className="card prose-ko">
            <h2>① Current traffic alone cannot tell you the exact arrival time</h2>
            <p>
              A road that is clear now <b>may be jammed when you reach it 20 minutes later.</b> Accidents and closures are also hard to predict. In a case Google has
              published, live traffic and historical patterns are combined to predict future travel times. The direction of progress is <b>predicting traffic at
              the moment you enter a road</b> (
              <a href="https://deepmind.google/discover/blog/traffic-prediction-with-advanced-graph-neural-networks/" target="_blank" rel="noreferrer">
                Google DeepMind traffic prediction
              </a>
              ).
            </p>
            <p>Accuracy here has two parts.</p>
            <ul>
              <li>
                <b>Search accuracy:</b> did it find the optimal route for the travel times it was given?
              </li>
              <li>
                <b>Prediction accuracy:</b> how close are those travel times to actual driving times?
              </li>
            </ul>
            <p>Even if A*, CCH and LPA* find the optimal route exactly, the truly fastest road can differ if the traffic prediction is wrong.</p>
          </article>
          <article className="card prose-ko">
            <h2>② Traffic must be updated often while keeping computation low</h2>
            <p>
              Searches repeat whenever congestion or closures change, and many users&apos; requests must be served too. The direction of progress is <b>updating only
              what changed, or reusing a prepared road structure across many searches</b>. CCH is one answer to this need (
              <a href="https://arxiv.org/abs/1402.0402" target="_blank" rel="noreferrer">
                Dibbelt, Strasser and Wagner, Customizable Contraction Hierarchies
              </a>
              ), and later research continues to improve its update, search and memory use.
            </p>
          </article>
          <article className="card prose-ko">
            <h2>③ It is hard to improve result quality and response speed together</h2>
            <p>
              Considering traffic in more detail and reviewing more candidate routes can increase the computation load. In practice, the Google Routes API offers{" "}
              <b>a choice between how much traffic is considered and response latency</b> (
              <a href="https://developers.google.com/maps/documentation/routes" target="_blank" rel="noreferrer">
                Google Routes API documentation
              </a>
              ). Industry also has to choose the right balance for each use.
            </p>
          </article>
          <article className="card prose-ko">
            <h2>④ Real road conditions are complicated</h2>
            <p>
              Turn restrictions, lane eligibility and vehicle types must be reflected. Google has also released a feature that separately predicts travel time in
              high-occupancy vehicle lanes. The direction of progress is <b>route calculation that includes the road conditions a user can actually use</b>. This
              project&apos;s model (uniform speed, fixed intersection and crosswalk penalties, distance-based costs) does not reflect these conditions, which is one of
              its limits.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}

function TrafficFacts({ traffic }: { traffic: TrafficIndex }) {
  const rows = TRAFFIC_SCENARIOS.map((s) => ({ s, r: traffic.summary.find((x) => x.scenario === s.id && x.algorithm === traffic.algorithms[0])! }));
  return (
    <ul className="text-sm mt-3 flex flex-col gap-1">
      {rows.map(({ s, r }) => (
        <li key={s.id}>
          <b>{s.name}</b>: normal route {formatTravel(r.normalTimeS)} →{" "}
          {r.normalRouteBlocked === r.pairs ? "the normal route is blocked and cannot be used" : `keeping the normal route takes ${formatTravel(r.normalRouteNowS)}`}
          {r.normalRouteBlocked > 0 && r.normalRouteBlocked < r.pairs && ` (excluding ${r.normalRouteBlocked} blocked routes)`} · new route{" "}
          {formatTravel(r.routeTimeS)}, route changed in {r.routeChanged}/{r.pairs}
        </li>
      ))}
      <li className="faint text-xs">
        All three methods found the same route with the shortest travel time (shortest travel time guaranteed). Its distance can be longer than in the normal
        state, so the shortest route (distance) is not guaranteed.
      </li>
    </ul>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card">
      <div className="text-xs muted">{label}</div>
      <div className="text-2xl font-bold mt-1 num">{value}</div>
      {note && <div className="text-xs faint mt-1">{note}</div>}
    </div>
  );
}
