import { readFileSync } from "node:fs";
import { toGraph, nearestNode } from "../../src/lib/graph";
import { ALGORITHMS, runAlgorithm } from "../../src/lib/algorithms";
import { START, END, speedMps } from "../../src/lib/config";
for (const mode of ["car", "walk"] as const) {
  const g = toGraph(JSON.parse(readFileSync(`public/graph/${mode}.json`, "utf8")));
  const s = nearestNode(g, START.lat, START.lng), t = nearestNode(g, END.lat, END.lng);
  console.log(mode, "snap", s.distanceM.toFixed(1), t.distanceM.toFixed(1));
  for (const penalties of [false, true]) for (const a of ALGORITHMS) {
    const t0 = performance.now();
    const r = runAlgorithm(a.id, g, { source: s.node, target: t.node, speed: speedMps(mode), penalties, record: true });
    // path continuity check
    let ok = r.pathEdges.length === 0 || g.from[r.pathEdges[0]] === s.node && g.to[r.pathEdges.at(-1)!] === t.node;
    for (let i = 1; i < r.pathEdges.length; i++) ok &&= g.to[r.pathEdges[i-1]] === g.from[r.pathEdges[i]];
    console.log(` pen=${penalties} ${a.short.padEnd(18)} found=${r.found} cont=${ok} dist=${r.distanceM.toFixed(0)}m cost=${r.costSec.toFixed(2)}s pen=${r.penaltySec.toFixed(0)}s/${r.penaltyCount} visited=${r.visited} relax=${r.relaxations} rounds=${r.rounds ?? ""} ${(performance.now()-t0).toFixed(1)}ms`);
  }
}
