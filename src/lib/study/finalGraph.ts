import { buildStudyGraph, largestSccMask, studyGraphFromJson, subgraph, type StudyGraph, type StudyGraphJson } from "./graph.ts";
import { deriveSeed, seededRandom } from "./rng.ts";

export interface FinalRoadJson extends StudyGraphJson {
  osmNodeId: number[];
  key: number[];
  edgeId: string[];
  freeFlowS: number[];
  speedKph: number[];
  speedSource: string[];
  highway: string[];
  osmWayIds: number[][];
}

export interface FinalGraph {
  graph: StudyGraph;
  edgeId: string[];
  freeFlowS: Float64Array;
  kind: "road" | "synthetic";
}

export function roadGraph(json: FinalRoadJson): FinalGraph {
  if (json.from.length !== json.edgeId.length || json.from.length !== json.freeFlowS.length)
    throw new Error("road edge arrays have different lengths");
  return { graph: studyGraphFromJson(json), edgeId: json.edgeId, freeFlowS: Float64Array.from(json.freeFlowS), kind: "road" };
}

function fromSubgraph(root: FinalGraph, graph: StudyGraph): FinalGraph {
  return { graph, kind: root.kind,
    edgeId: Array.from(graph.origEdge, (e) => root.edgeId[e]),
    freeFlowS: Float64Array.from(graph.origEdge, (e) => root.freeFlowS[e]) };
}

export interface RadiusGraph {
  radiusM: number;
  final: FinalGraph;
  cutNodes: number;
  cutEdges: number;
  excludedNodes: number;
  excludedEdges: number;
  actualRadiusM: number;
}

export function roadRadius(root: FinalGraph, radiusM: number): RadiusGraph {
  const g = root.graph;
  const keep = Uint8Array.from({ length: g.n }, (_, v) => Number(Math.hypot(g.x[v], g.y[v]) <= radiusM));
  const cut = subgraph(g, keep);
  const scc = subgraph(cut, largestSccMask(cut));
  const actualRadiusM = Math.max(0, ...Array.from({ length: scc.n }, (_, v) => Math.hypot(scc.x[v], scc.y[v])));
  return { radiusM, final: fromSubgraph(root, scc), cutNodes: cut.n, cutEdges: cut.m,
    excludedNodes: cut.n - scc.n, excludedEdges: cut.m - scc.m, actualRadiusM };
}

export function syntheticGraph(n: number, seed: number, probability: number): FinalGraph {
  if (!Number.isInteger(n) || n < 2 || probability < 0 || probability > 1) throw new Error("invalid synthetic graph settings");
  const rand = seededRandom(deriveSeed(seed, `synthetic:${n}`));
  const x = Array.from({ length: n }, (_, i) => 100 * (i % 6) + 20 * rand());
  const y = Array.from({ length: n }, (_, i) => 100 * Math.floor(i / 6) + 20 * rand());
  const from: number[] = [], to: number[] = [], len: number[] = [], freeFlowS: number[] = [], edgeId: string[] = [];
  for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) {
    if (u === v || (v !== u + 1 && rand() >= probability)) continue;
    const lengthM = Math.hypot(x[u] - x[v], y[u] - y[v]) * (1 + rand() * 0.5) + 1;
    from.push(u); to.push(v); len.push(lengthM); freeFlowS.push(lengthM * 3.6 / 30);
    edgeId.push(`${u}:${v}:0`);
  }
  const graph = buildStudyGraph({ lat: x.map(() => 0), lng: y.map(() => 0), x, y, from, to, len });
  return { graph, edgeId, freeFlowS: Float64Array.from(freeFlowS), kind: "synthetic" };
}

export function graphSignature(final: FinalGraph) {
  const g = final.graph;
  return { kind: final.kind, x: Array.from(g.x), y: Array.from(g.y), from: Array.from(g.from), to: Array.from(g.to),
    len: Array.from(g.len), freeFlowS: Array.from(final.freeFlowS), edgeId: final.edgeId };
}

export function edgeGeometry(json: FinalRoadJson, originalEdge: number): [number, number][] {
  const from = json.from[originalEdge], to = json.to[originalEdge];
  const path: [number, number][] = [[json.lat[from], json.lng[from]]];
  for (let i = json.geomStart[originalEdge]; i < json.geomStart[originalEdge + 1]; i += 2)
    path.push([json.geom[i], json.geom[i + 1]]);
  path.push([json.lat[to], json.lng[to]]);
  return path;
}
