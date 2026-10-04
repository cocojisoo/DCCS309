import type { StudyGraph } from "./graph.ts";
import { emptyResult, setPath, TraceRecorder, trivialResult, weightsOf, type SearchOptions, type StudySearchResult } from "./search.ts";

/**
 * CCH (Customizable Contraction Hierarchies, Dibbelt · Strasser · Wagner 2014)
 *
 *  1) 전처리 (도로 비용과 무관, 지도 모양만 보고 한 번):
 *     교차로에 중요도 순위를 매기고(중첩 분할), 순위가 낮은 교차로부터 하나씩 '수축'하면서
 *     그 교차로를 거쳐 가던 이웃끼리 지름길(shortcut)을 잇는다.
 *  2) 커스터마이징 (비용이 바뀔 때마다):
 *     모든 지름길의 비용을 아래쪽 삼각형(v-u, v-w → u-w)으로 채운다.
 *     비용 일부만 바뀌면 그 영향이 닿는 지름길만 다시 계산한다(부분 커스터마이징).
 *  3) 질의: 출발점과 도착점에서 각각 '더 중요한 교차로' 쪽으로만 올라가고, 만나는 곳 중 가장 싼 곳을 고른다.
 *     찾은 지름길은 원래 도로로 펼쳐서 돌려준다.
 */
export interface CchPrep {
  g: StudyGraph;
  /** rank[v] = v 의 중요도 순위 (클수록 나중에 수축 = 더 중요) */
  rank: Int32Array;
  /** order[r] = 순위 r 의 교차로 */
  order: Int32Array;
  /** 소거 트리 부모 (위쪽 이웃 중 순위가 가장 낮은 교차로, 없으면 -1) */
  parent: Int32Array;
  /** 교차로 v 에서 위로 가는 아크는 arcBegin[v] .. arcEnd[v] */
  arcBegin: Int32Array;
  arcEnd: Int32Array;
  /** 아크 a: 아래쪽 끝(tail) → 위쪽 끝(head). 아크 번호는 tail 의 순위 순서다 */
  arcTail: Int32Array;
  arcHead: Int32Array;
  /** 아크 a 를 꼭대기로 하는 아래쪽 삼각형들: lowVU[t], lowVW[t] (t = lowStart[a] .. lowStart[a+1]) */
  lowStart: Int32Array;
  lowVU: Int32Array;
  lowVW: Int32Array;
  /** 아크 a 가 바뀌면 다시 계산해야 하는 위쪽 아크들 */
  useStart: Int32Array;
  useTop: Int32Array;
  /** 원래 도로 e 가 속한 아크와, 그 아크의 위 방향(tail→head)인지 */
  edgeArc: Int32Array;
  edgeUp: Uint8Array;
  /** 아크 a 에 해당하는 원래 도로들 */
  arcEdgeStart: Int32Array;
  arcEdges: Int32Array;
  arcs: number;
  shortcuts: number;
  triangles: number;
  prepMs: number;
}

/** 지도 좌표로 교차로를 반씩 나누고, 경계 교차로(분리자)를 가장 나중 순위로 두는 중첩 분할 순서 */
function nestedDissection(g: StudyGraph, nbStart: Int32Array, nb: Int32Array): Int32Array {
  const order: number[] = [];
  const mark = new Int32Array(g.n);
  let stamp = 0;
  const rec = (nodes: number[]) => {
    if (nodes.length <= 2) {
      order.push(...nodes);
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of nodes) {
      minX = Math.min(minX, g.x[v]);
      maxX = Math.max(maxX, g.x[v]);
      minY = Math.min(minY, g.y[v]);
      maxY = Math.max(maxY, g.y[v]);
    }
    const coord = maxX - minX >= maxY - minY ? g.x : g.y;
    const sorted = [...nodes].sort((a, b) => coord[a] - coord[b] || a - b);
    const half = sorted.length >> 1;
    const A = sorted.slice(0, half);
    const B = sorted.slice(half);
    const stampA = ++stamp;
    for (const v of A) mark[v] = stampA;
    const stampB = ++stamp;
    for (const v of B) mark[v] = stampB;
    const touches = (v: number, other: number) => {
      for (let i = nbStart[v]; i < nbStart[v + 1]; i++) if (mark[nb[i]] === other) return true;
      return false;
    };
    const SA = A.filter((v) => touches(v, stampB));
    const SB = B.filter((v) => touches(v, stampA));
    const [S, side, other] = SA.length <= SB.length ? [SA, A, B] : [SB, B, A];
    const inS = new Set(S);
    rec(side.filter((v) => !inS.has(v)));
    rec(other);
    order.push(...S);
  };
  rec(Array.from({ length: g.n }, (_, i) => i));
  return Int32Array.from(order);
}

export function prepareCch(g: StudyGraph): CchPrep {
  const t0 = performance.now();
  const n = g.n;

  // 방향을 무시한 이웃 목록 (중복 제거)
  const lists: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < g.m; e++) {
    const a = g.from[e], b = g.to[e];
    if (a === b) continue;
    lists[a].push(b);
    lists[b].push(a);
  }
  const nbStart = new Int32Array(n + 1);
  const nbAll: number[] = [];
  for (let v = 0; v < n; v++) {
    const uniq = [...new Set(lists[v])];
    nbAll.push(...uniq);
    nbStart[v + 1] = nbAll.length;
  }
  const nb = Int32Array.from(nbAll);

  const order = nestedDissection(g, nbStart, nb);
  const rank = new Int32Array(n);
  for (let r = 0; r < n; r++) rank[order[r]] = r;

  // 수축: 순위가 낮은 교차로부터, 위쪽 이웃들을 서로 잇는다 (소거 트리 부모에게 넘기면 충분하다)
  const up: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let v = 0; v < n; v++) for (let i = nbStart[v]; i < nbStart[v + 1]; i++) if (rank[nb[i]] > rank[v]) up[v].add(nb[i]);
  const parent = new Int32Array(n).fill(-1);
  for (let r = 0; r < n; r++) {
    const v = order[r];
    let p = -1;
    for (const u of up[v]) if (p < 0 || rank[u] < rank[p]) p = u;
    parent[v] = p;
    if (p >= 0) for (const u of up[v]) if (u !== p) up[p].add(u);
  }

  // 아크: tail 의 순위 순서대로 번호를 매긴다 → 번호 순서대로 계산하면 아래쪽 아크가 항상 먼저 끝나 있다
  const arcBegin = new Int32Array(n);
  const arcEnd = new Int32Array(n);
  const tails: number[] = [];
  const heads: number[] = [];
  const arcOf = new Map<number, number>();
  for (let r = 0; r < n; r++) {
    const v = order[r];
    arcBegin[v] = tails.length;
    for (const u of [...up[v]].sort((a, b) => rank[a] - rank[b])) {
      arcOf.set(v * n + u, tails.length);
      tails.push(v);
      heads.push(u);
    }
    arcEnd[v] = tails.length;
  }
  const A = tails.length;
  const arcTail = Int32Array.from(tails);
  const arcHead = Int32Array.from(heads);

  // 아래쪽 삼각형: v 의 위쪽 이웃 u < w 마다 (v-u, v-w) 가 (u-w) 의 재료
  const triTop: number[] = [];
  const triVU: number[] = [];
  const triVW: number[] = [];
  for (let v = 0; v < n; v++) {
    for (let i = arcBegin[v]; i < arcEnd[v]; i++)
      for (let j = i + 1; j < arcEnd[v]; j++) {
        const u = arcHead[i];
        const w = arcHead[j];
        const top = arcOf.get(u * n + w);
        if (top === undefined) throw new Error("CCH: 위쪽 이웃끼리 아크가 없음 (수축 오류)");
        triTop.push(top);
        triVU.push(i);
        triVW.push(j);
      }
  }
  const T = triTop.length;
  const bucket = (keys: number[], size: number) => {
    const start = new Int32Array(size + 1);
    for (const k of keys) start[k + 1]++;
    for (let i = 0; i < size; i++) start[i + 1] += start[i];
    return start;
  };
  const lowStart = bucket(triTop, A);
  const fill = lowStart.slice(0, A);
  const lowVU = new Int32Array(T);
  const lowVW = new Int32Array(T);
  for (let t = 0; t < T; t++) {
    const k = fill[triTop[t]]++;
    lowVU[k] = triVU[t];
    lowVW[k] = triVW[t];
  }
  const useKeys = [...triVU, ...triVW];
  const useStart = bucket(useKeys, A);
  const useFill = useStart.slice(0, A);
  const useTop = new Int32Array(useKeys.length);
  for (let t = 0; t < T; t++) {
    useTop[useFill[triVU[t]]++] = triTop[t];
    useTop[useFill[triVW[t]]++] = triTop[t];
  }

  // 원래 도로 → 아크
  const edgeArc = new Int32Array(g.m).fill(-1);
  const edgeUp = new Uint8Array(g.m);
  for (let e = 0; e < g.m; e++) {
    const a = g.from[e], b = g.to[e];
    if (a === b) continue;
    const lo = rank[a] < rank[b] ? a : b;
    const hi = lo === a ? b : a;
    edgeArc[e] = arcOf.get(lo * n + hi)!;
    edgeUp[e] = lo === a ? 1 : 0;
  }
  const arcEdgeKeys = Array.from(edgeArc).filter((a) => a >= 0);
  const arcEdgeStart = bucket(arcEdgeKeys, A);
  const arcFill = arcEdgeStart.slice(0, A);
  const arcEdges = new Int32Array(arcEdgeKeys.length);
  for (let e = 0; e < g.m; e++) if (edgeArc[e] >= 0) arcEdges[arcFill[edgeArc[e]]++] = e;
  let shortcuts = 0;
  for (let a = 0; a < A; a++) if (arcEdgeStart[a + 1] === arcEdgeStart[a]) shortcuts++;

  return {
    g, rank, order, parent, arcBegin, arcEnd, arcTail, arcHead, lowStart, lowVU, lowVW, useStart, useTop,
    edgeArc, edgeUp, arcEdgeStart, arcEdges, arcs: A, shortcuts, triangles: T, prepMs: performance.now() - t0,
  };
}

/** 비용을 채운 CCH (커스터마이징 결과) + 질의용 버퍼 */
export interface CchMetric {
  prep: CchPrep;
  w: Float64Array;
  baseUp: Float64Array;
  baseDown: Float64Array;
  upEdge: Int32Array;
  downEdge: Int32Array;
  up: Float64Array;
  down: Float64Array;
  /** 이 비용을 만든 아래쪽 삼각형 번호 (-1 = 원래 도로) */
  upTri: Int32Array;
  downTri: Int32Array;
  customizeMs: number;
  /** 마지막 커스터마이징에서 다시 계산한 아크 수 */
  recomputed: number;
  df: Float64Array;
  db: Float64Array;
  pf: Int32Array;
  pb: Int32Array;
}

function recomputeBase(m: CchMetric, a: number) {
  const p = m.prep;
  let bu = Infinity, bd = Infinity, eu = -1, ed = -1;
  for (let i = p.arcEdgeStart[a]; i < p.arcEdgeStart[a + 1]; i++) {
    const e = p.arcEdges[i];
    const c = m.w[e];
    if (p.edgeUp[e]) {
      if (c < bu) {
        bu = c;
        eu = e;
      }
    } else if (c < bd) {
      bd = c;
      ed = e;
    }
  }
  m.baseUp[a] = bu;
  m.baseDown[a] = bd;
  m.upEdge[a] = eu;
  m.downEdge[a] = ed;
}

/** 아크 a 의 비용을 원래 도로와 아래쪽 삼각형으로 다시 계산한다. 바뀌었으면 true */
function recomputeArc(m: CchMetric, a: number): boolean {
  const p = m.prep;
  let up = m.baseUp[a], down = m.baseDown[a], ut = -1, dt = -1;
  for (let t = p.lowStart[a]; t < p.lowStart[a + 1]; t++) {
    const vu = p.lowVU[t];
    const vw = p.lowVW[t];
    const cu = m.down[vu] + m.up[vw];
    if (cu < up) {
      up = cu;
      ut = t;
    }
    const cd = m.down[vw] + m.up[vu];
    if (cd < down) {
      down = cd;
      dt = t;
    }
  }
  const changed = up !== m.up[a] || down !== m.down[a];
  m.up[a] = up;
  m.down[a] = down;
  m.upTri[a] = ut;
  m.downTri[a] = dt;
  return changed;
}

/** 전체 커스터마이징 */
export function customizeCch(prep: CchPrep, w: Float64Array): CchMetric {
  const t0 = performance.now();
  const A = prep.arcs;
  const n = prep.g.n;
  const m: CchMetric = {
    prep,
    w,
    baseUp: new Float64Array(A),
    baseDown: new Float64Array(A),
    upEdge: new Int32Array(A),
    downEdge: new Int32Array(A),
    up: new Float64Array(A).fill(Infinity),
    down: new Float64Array(A).fill(Infinity),
    upTri: new Int32Array(A),
    downTri: new Int32Array(A),
    customizeMs: 0,
    recomputed: A,
    df: new Float64Array(n).fill(Infinity),
    db: new Float64Array(n).fill(Infinity),
    pf: new Int32Array(n).fill(-1),
    pb: new Int32Array(n).fill(-1),
  };
  for (let a = 0; a < A; a++) {
    recomputeBase(m, a);
    recomputeArc(m, a);
  }
  m.customizeMs = performance.now() - t0;
  return m;
}

/**
 * 부분 커스터마이징: 도로 비용 일부가 바뀌었을 때 영향이 닿는 아크만 다시 계산한다.
 * 아크 a 에 기대는 위쪽 아크는 항상 a 보다 번호가 크므로, 가장 작은 표시부터 번호 순서대로 한 번 훑으면
 * 재료 아크가 항상 먼저 확정된다 (우선순위 큐가 필요 없다).
 */
export function updateCch(m: CchMetric, w: Float64Array, changedEdges: Iterable<number>): { ms: number; recomputed: number } {
  const t0 = performance.now();
  const p = m.prep;
  m.w = w;
  const marked = new Uint8Array(p.arcs);
  let first = p.arcs;
  for (const e of changedEdges) {
    const a = p.edgeArc[e];
    if (a < 0 || marked[a]) continue;
    marked[a] = 1;
    recomputeBase(m, a);
    if (a < first) first = a;
  }
  let recomputed = 0;
  for (let a = first; a < p.arcs; a++) {
    if (!marked[a]) continue;
    recomputed++;
    if (!recomputeArc(m, a)) continue;
    for (let i = p.useStart[a]; i < p.useStart[a + 1]; i++) marked[p.useTop[i]] = 1;
  }
  m.recomputed = recomputed;
  const ms = performance.now() - t0;
  m.customizeMs = ms;
  return { ms, recomputed };
}

/** 지름길 a 를 원래 도로 목록으로 펼친다 */
function unpack(m: CchMetric, a: number, up: boolean, out: number[]) {
  const p = m.prep;
  const stack: [number, boolean][] = [[a, up]];
  while (stack.length) {
    const [arc, isUp] = stack.pop()!;
    const tri = isUp ? m.upTri[arc] : m.downTri[arc];
    if (tri < 0) {
      out.push(isUp ? m.upEdge[arc] : m.downEdge[arc]);
      continue;
    }
    const vu = p.lowVU[tri];
    const vw = p.lowVW[tri];
    // u→w = (u→v)(v→w) / w→u = (w→v)(v→u). 스택이므로 뒤 조각부터 넣는다
    if (isUp) stack.push([vw, true], [vu, false]);
    else stack.push([vu, true], [vw, false]);
  }
}

/** 질의: 출발점과 도착점에서 소거 트리를 따라 위로만 올라간다 (우선순위 큐 없음) */
export function queryCch(m: CchMetric, source: number, target: number, o: SearchOptions): StudySearchResult {
  if (source === target) return trivialResult();
  const p = m.prep;
  const g = p.g;
  const res = emptyResult();
  const rec = o.recordTrace ? new TraceRecorder(g.n, o.maxFrames ?? 100) : null;
  const { df, db, pf, pb } = m;
  const touched: number[] = [];
  let visits = 0;
  let relax = 0;

  const climb = (start: number, dist: Float64Array, pred: Int32Array, w: Float64Array) => {
    dist[start] = 0;
    touched.push(start);
    for (let x = start; x !== -1; x = p.parent[x]) {
      visits++;
      if (rec) {
        rec.visit(x, pred[x] >= 0 ? p.arcTail[pred[x]] : -1);
        if (rec.due(visits)) rec.push({ step: visits, current: x, path: [], best: null });
      }
      const dx = dist[x];
      if (dx === Infinity) continue;
      for (let a = p.arcBegin[x]; a < p.arcEnd[x]; a++) {
        relax++;
        const y = p.arcHead[a];
        const c = dx + w[a];
        if (c < dist[y]) {
          if (dist[y] === Infinity) touched.push(y);
          dist[y] = c;
          pred[y] = a;
        }
      }
    }
  };
  climb(source, df, pf, m.up);
  climb(target, db, pb, m.down);

  let best = Infinity;
  let meet = -1;
  let unique = 0;
  const onSource = new Set<number>();
  for (let x = source; x !== -1; x = p.parent[x]) onSource.add(x);
  for (let x = target; x !== -1; x = p.parent[x]) {
    if (!onSource.has(x)) unique++;
    if (df[x] + db[x] < best) {
      best = df[x] + db[x];
      meet = x;
    }
  }
  unique += onSource.size;

  res.visitCount = visits;
  res.uniqueVisited = unique;
  res.relaxations = relax;
  if (meet >= 0) {
    const ups: number[] = [];
    for (let y = meet; pf[y] >= 0; y = p.arcTail[pf[y]]) ups.push(pf[y]);
    const edges: number[] = [];
    for (let i = ups.length - 1; i >= 0; i--) unpack(m, ups[i], true, edges);
    for (let y = meet; pb[y] >= 0; y = p.arcTail[pb[y]]) unpack(m, pb[y], false, edges);
    setPath(res, g, m.w, edges);
  }
  for (const v of touched) {
    df[v] = Infinity;
    db[v] = Infinity;
    pf[v] = -1;
    pb[v] = -1;
  }
  if (rec) res.trace = rec.finish({ step: visits, current: meet, path: res.pathEdges, best: res.status === "SUCCESS" ? res.pathEdges : null });
  return res;
}

const prepCache = new WeakMap<StudyGraph, CchPrep>();
const metricCache = new WeakMap<CchPrep, WeakMap<Float64Array, CchMetric>>();

/** 그래프마다 전처리는 한 번만 한다 */
export function cchPrepFor(g: StudyGraph): CchPrep {
  let p = prepCache.get(g);
  if (!p) {
    p = prepareCch(g);
    prepCache.set(g, p);
  }
  return p;
}

/** 같은 비용 배열이면 커스터마이징도 한 번만 한다 */
export function cchMetricFor(g: StudyGraph, w: Float64Array): CchMetric {
  const prep = cchPrepFor(g);
  let byW = metricCache.get(prep);
  if (!byW) {
    byW = new WeakMap();
    metricCache.set(prep, byW);
  }
  let m = byW.get(w);
  if (!m) {
    m = customizeCch(prep, w);
    byW.set(w, m);
  }
  return m;
}

/** 다른 방법과 같은 모양의 길찾기 함수. 전처리·커스터마이징은 캐시에서 가져오므로 질의 시간만 든다 */
export function cchSearch(g: StudyGraph, source: number, target: number, o: SearchOptions): StudySearchResult {
  return queryCch(cchMetricFor(g, weightsOf(g, o)), source, target, o);
}
