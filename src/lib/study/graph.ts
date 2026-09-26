import { csr } from "../graph.ts";

/** scripts/build-study-graph.mjs 가 만드는 JSON 형식 */
export interface StudyGraphJson {
  meta: StudyGraphMeta;
  lat: number[];
  lng: number[];
  from: number[];
  to: number[];
  len: number[];
  /** 간선 e 의 중간 좌표는 geom[geomStart[e] .. geomStart[e+1]) 에 [lat, lng, lat, lng, …] 로 들어 있다 */
  geomStart: number[];
  geom: number[];
}

export interface StudyGraphMeta {
  source: string;
  generatedAt: string;
  downloadedAt: string | null;
  osmTimestamp: string | null;
  osmSha256: string;
  center: [number, number];
  halfWidthM: number;
  bbox: [number, number, number, number];
  network: string;
  counts: Record<string, number>;
}

/**
 * 실험용 방향 그래프 (CSR). 교차로 = 노드, 도로 = 간선, 비용 = 도로 길이(m).
 * 잘라낸 부분 그래프도 같은 형식이고, orig/origEdge 로 전체 지도의 번호를 기억한다.
 */
export interface StudyGraph {
  n: number;
  m: number;
  lat: Float64Array;
  lng: Float64Array;
  /** 중심 기준 평면 좌표 (m, 동쪽 +x / 북쪽 +y). A* 힌트와 크기 자르기에 쓴다 */
  x: Float64Array;
  y: Float64Array;
  from: Int32Array;
  to: Int32Array;
  len: Float64Array;
  outStart: Int32Array;
  outEdge: Int32Array;
  inStart: Int32Array;
  inEdge: Int32Array;
  /** 이 그래프의 노드 v 가 전체 지도에서 몇 번 노드인지 */
  orig: Int32Array;
  /** 이 그래프의 간선 e 가 전체 지도에서 몇 번 간선인지 */
  origEdge: Int32Array;
}

const R = 6371008.8;
const RAD = Math.PI / 180;

/** 위경도 → 중심 기준 평면 좌표(m). 10km 범위에서 오차는 0.1% 미만이고, A* 힌트의 0.999 배가 이를 덮는다. */
export function projector(centerLat: number, centerLng: number) {
  const kx = R * RAD * Math.cos(centerLat * RAD);
  const ky = R * RAD;
  return (lat: number, lng: number): [number, number] => [(lng - centerLng) * kx, (lat - centerLat) * ky];
}

interface GraphArrays {
  lat: ArrayLike<number>;
  lng: ArrayLike<number>;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  from: ArrayLike<number>;
  to: ArrayLike<number>;
  len: ArrayLike<number>;
}

export function buildStudyGraph(arrays: GraphArrays, orig?: Int32Array, origEdge?: Int32Array): StudyGraph {
  const n = arrays.lat.length;
  const m = arrays.from.length;
  const from = Int32Array.from(arrays.from);
  const to = Int32Array.from(arrays.to);
  const lat = Float64Array.from(arrays.lat);
  const lng = Float64Array.from(arrays.lng);
  const x = Float64Array.from(arrays.x);
  const y = Float64Array.from(arrays.y);
  const out = csr(n, from);
  const inn = csr(n, to);
  return {
    n,
    m,
    lat,
    lng,
    x,
    y,
    from,
    to,
    len: Float64Array.from(arrays.len),
    outStart: out.start,
    outEdge: out.list,
    inStart: inn.start,
    inEdge: inn.list,
    orig: orig ?? Int32Array.from({ length: n }, (_, i) => i),
    origEdge: origEdge ?? Int32Array.from({ length: m }, (_, i) => i),
  };
}

export function studyGraphFromJson(json: StudyGraphJson): StudyGraph {
  const project = projector(...json.meta.center);
  const x: number[] = [];
  const y: number[] = [];
  for (let v = 0; v < json.lat.length; v++) {
    const [px, py] = project(json.lat[v], json.lng[v]);
    x.push(px);
    y.push(py);
  }
  return buildStudyGraph({ ...json, x, y });
}

/** keep[v] = 1 인 노드와, 양 끝이 모두 남는 간선만으로 부분 그래프를 만든다 */
export function subgraph(g: StudyGraph, keep: Uint8Array): StudyGraph {
  const remap = new Int32Array(g.n).fill(-1);
  const orig: number[] = [];
  const lat: number[] = [];
  const lng: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (let v = 0; v < g.n; v++) {
    if (!keep[v]) continue;
    remap[v] = orig.length;
    orig.push(g.orig[v]);
    lat.push(g.lat[v]);
    lng.push(g.lng[v]);
    x.push(g.x[v]);
    y.push(g.y[v]);
  }
  const from: number[] = [];
  const to: number[] = [];
  const len: number[] = [];
  const origEdge: number[] = [];
  for (let e = 0; e < g.m; e++) {
    const a = remap[g.from[e]];
    const b = remap[g.to[e]];
    if (a < 0 || b < 0) continue;
    from.push(a);
    to.push(b);
    len.push(g.len[e]);
    origEdge.push(g.origEdge[e]);
  }
  return buildStudyGraph({ lat, lng, x, y, from, to, len }, Int32Array.from(orig), Int32Array.from(origEdge));
}

/** 가장 큰 강연결요소(서로 오갈 수 있는 가장 큰 덩어리)에 속한 노드 표시 (Kosaraju, 반복 구현) */
export function largestSccMask(g: StudyGraph): Uint8Array {
  const n = g.n;
  const visited = new Uint8Array(n);
  const order: number[] = [];
  const stackV = new Int32Array(n);
  const stackI = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    let top = 0;
    stackV[0] = s;
    stackI[0] = g.outStart[s];
    visited[s] = 1;
    while (top >= 0) {
      const v = stackV[top];
      const i = stackI[top];
      if (i < g.outStart[v + 1]) {
        stackI[top]++;
        const w = g.to[g.outEdge[i]];
        if (!visited[w]) {
          visited[w] = 1;
          top++;
          stackV[top] = w;
          stackI[top] = g.outStart[w];
        }
      } else {
        order.push(v);
        top--;
      }
    }
  }
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const s = order[k];
    if (comp[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    comp[s] = id;
    stack.push(s);
    while (stack.length) {
      const v = stack.pop()!;
      size++;
      for (let i = g.inStart[v]; i < g.inStart[v + 1]; i++) {
        const w = g.from[g.inEdge[i]];
        if (comp[w] === -1) {
          comp[w] = id;
          stack.push(w);
        }
      }
    }
    sizes.push(size);
  }
  const mask = new Uint8Array(n);
  if (!sizes.length) return mask;
  const best = sizes.indexOf(Math.max(...sizes));
  for (let v = 0; v < n; v++) if (comp[v] === best) mask[v] = 1;
  return mask;
}

export function planarDistance(g: StudyGraph, a: number, b: number): number {
  return Math.hypot(g.x[a] - g.x[b], g.y[a] - g.y[b]);
}
