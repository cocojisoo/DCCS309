import type { Mode } from "./config";

/** scripts/build-graph.mjs 가 만드는 JSON 형식 */
export interface GraphJson {
  mode: Mode;
  source: string;
  generatedAt: string;
  osmTimestamp: string | null;
  bbox: [number, number, number, number];
  nodeCount: number;
  edgeCount: number;
  lat: number[];
  lng: number[];
  from: number[];
  to: number[];
  len: number[];
  intersections?: number[];
  crossing?: number[];
  crossingLen?: number[];
}

/** 알고리즘이 쓰는 CSR(압축 인접 리스트) 그래프. 정방향/역방향 인접 모두 보관 */
export interface Graph {
  mode: Mode;
  meta: Pick<GraphJson, "source" | "generatedAt" | "osmTimestamp">;
  n: number;
  m: number;
  lat: Float64Array;
  lng: Float64Array;
  from: Int32Array;
  to: Int32Array;
  len: Float64Array;
  /** 정방향: outStart[v]..outStart[v+1] 구간의 outEdge 가 v 에서 나가는 간선 번호 */
  outStart: Int32Array;
  outEdge: Int32Array;
  /** 역방향: v 로 들어오는 간선 번호 (양방향 다익스트라용) */
  inStart: Int32Array;
  inEdge: Int32Array;
  /** 자동차: 교차로 노드 여부 */
  isIntersection: Uint8Array;
  /** 도보: 간선이 속한 횡단보도 번호 (-1 = 아님) */
  crossing: Int32Array;
  crossingLen: Float64Array;
}

export function csr(n: number, keys: Int32Array): { start: Int32Array; list: Int32Array } {
  const start = new Int32Array(n + 1);
  for (let e = 0; e < keys.length; e++) start[keys[e] + 1]++;
  for (let v = 0; v < n; v++) start[v + 1] += start[v];
  const fill = start.slice(0, n);
  const list = new Int32Array(keys.length);
  for (let e = 0; e < keys.length; e++) list[fill[keys[e]]++] = e;
  return { start, list };
}

export function toGraph(json: GraphJson): Graph {
  const n = json.nodeCount;
  const from = Int32Array.from(json.from);
  const to = Int32Array.from(json.to);
  const out = csr(n, from);
  const inn = csr(n, to);
  const isIntersection = new Uint8Array(n);
  for (const v of json.intersections ?? []) isIntersection[v] = 1;
  return {
    mode: json.mode,
    meta: { source: json.source, generatedAt: json.generatedAt, osmTimestamp: json.osmTimestamp },
    n,
    m: from.length,
    lat: Float64Array.from(json.lat),
    lng: Float64Array.from(json.lng),
    from,
    to,
    len: Float64Array.from(json.len),
    outStart: out.start,
    outEdge: out.list,
    inStart: inn.start,
    inEdge: inn.list,
    isIntersection,
    crossing: json.crossing ? Int32Array.from(json.crossing) : new Int32Array(from.length).fill(-1),
    crossingLen: Float64Array.from(json.crossingLen ?? []),
  };
}

const cache = new Map<Mode, Promise<Graph>>();

export function loadGraph(mode: Mode): Promise<Graph> {
  let p = cache.get(mode);
  if (!p) {
    p = fetch(`/graph/${mode}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`그래프를 불러오지 못했습니다 (${mode}.json, HTTP ${r.status})`);
        return r.json() as Promise<GraphJson>;
      })
      .then(toGraph);
    p.catch(() => cache.delete(mode));
    cache.set(mode, p);
  }
  return p;
}

const R = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 좌표에서 가장 가까운 그래프 노드 */
export function nearestNode(g: Graph, lat: number, lng: number): { node: number; distanceM: number } {
  let best = -1;
  let bestD = Infinity;
  for (let v = 0; v < g.n; v++) {
    const d = haversine(lat, lng, g.lat[v], g.lng[v]);
    if (d < bestD) { bestD = d; best = v; }
  }
  return { node: best, distanceM: bestD };
}
