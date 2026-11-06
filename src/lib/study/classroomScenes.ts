import { cchPrepFor, customizeCch } from "./cch.ts";
import { CLASSROOM_JAM, CLASSROOM_NODES, CLASSROOM_SOURCE, CLASSROOM_TARGET, classroomGraph } from "./classroom.ts";
import { FINDERS } from "./finders.ts";
import type { StudyGraph } from "./graph.ts";
import { LpaStar } from "./lpa.ts";
import type { StudyAlgorithmId, TraceFrame } from "./search.ts";

/** 단계 묶음 이름 (화면에 그대로 보인다) */
export const PHASE = {
  preprocess: "Preprocessing",
  query: "Query",
  first: "First plan",
  change: "Road change",
  replan: "Replan",
};

/** 알고리즘 교실의 한 단계 */
export interface ClassroomStep {
  /** 지금 보고 있는 교차로 (-1 = 없음) */
  current: number;
  /** 지금까지 본 교차로 */
  visited: number[];
  /** 지금 따라가는 길 (간선 번호) */
  path: number[];
  /** 지금까지의 최고 기록 길 */
  best: number[] | null;
  text: string;
  /** 단계 묶음 이름 (예: "전처리", "질의", "다시 계획") */
  phase?: string;
  /** 교차로 옆에 붙일 숫자 (예: 거리) */
  labels?: Record<number, string>;
  /** 화면에 보일 지름길 수 (CCH) */
  shortcutsShown?: number;
  /** 혼잡 도로를 보여 줄지 (LPA*) */
  jam?: boolean;
  /** 마지막 단계면 최종 경로 */
  final?: number[];
}

export interface ClassroomScene {
  steps: ClassroomStep[];
  /** CCH 지름길 [교차로 a, 교차로 b, 비용, 수축한 교차로] */
  shortcuts?: { a: number; b: number; cost: number; via: number }[];
  /** CCH 중요도 순위 (클수록 중요) */
  ranks?: number[];
  /** LPA* 혼잡 도로 (간선 번호들) 와 배율 */
  jam?: { edges: number[]; factor: number };
  result: string;
}

const name = (v: number) => CLASSROOM_NODES[v].name;
const routeText = (g: StudyGraph, path: number[]) => [CLASSROOM_SOURCE, ...path.map((e) => g.to[e])].map(name).join("→");
const pathLen = (w: ArrayLike<number>, path: number[]) => path.reduce((s, e) => s + w[e], 0);

/** DFS · 다익스트라 · A*: 탐색 기록을 단계별 설명으로 */
function searchScene(algo: "dfs" | "dijkstra" | "astar"): ClassroomScene {
  const g = classroomGraph();
  const r = FINDERS[algo](g, CLASSROOM_SOURCE, CLASSROOM_TARGET, { timeLimitMs: null, heuristicScale: 1, recordTrace: true, maxFrames: 10000 });
  const { order, frames } = r.trace!;
  const hint = (v: number) => Math.hypot(g.x[v] - g.x[CLASSROOM_TARGET], g.y[v] - g.y[CLASSROOM_TARGET]);
  const labels: Record<number, string> = {};
  const steps = frames.map((f: TraceFrame): ClassroomStep => {
    const d = pathLen(g.len, f.path);
    let text: string;
    if (algo === "dfs") {
      text =
        f.current === CLASSROOM_TARGET
          ? `Reached the goal! Complete path ${routeText(g, f.path)} = ${d}m${f.best && pathLen(g.len, f.best) === d ? " (best so far)" : ""}`
          : `Entered ${name(f.current)} · current path ${routeText(g, f.path)} (${d}m)`;
    } else {
      labels[f.current] = `${d}`;
      const tag = f.current === CLASSROOM_TARGET ? " → goal settled, stop" : "";
      text =
        algo === "dijkstra"
          ? `Settled ${name(f.current)} · distance ${d}m${tag}`
          : `Settled ${name(f.current)} · distance ${d} + hint ${hint(f.current).toFixed(0)} = ${(d + hint(f.current)).toFixed(0)}${tag}`;
    }
    return { current: f.current, visited: order.slice(0, f.visited), path: f.path, best: f.best, text, labels: algo === "dfs" ? undefined : { ...labels } };
  });
  steps.push({
    current: -1,
    visited: order,
    path: [],
    best: null,
    text: `Result: ${routeText(g, r.pathEdges)} = ${r.lengthM}m`,
    labels: algo === "dfs" ? undefined : { ...labels },
    final: r.pathEdges,
  });
  const extra = r.completePaths !== null ? ` · ${r.completePaths} complete paths tried` : "";
  return {
    steps,
    result: `${routeText(g, r.pathEdges)} = ${r.lengthM}m · ${r.visitCount} visits (${r.uniqueVisited} unique intersections)${extra}`,
  };
}

/** CCH: 전처리(수축 → 지름길) → 질의(양쪽에서 위로만) → 만나는 곳 → 지름길 펼치기 */
function cchScene(): ClassroomScene {
  const g = classroomGraph();
  const prep = cchPrepFor(g);
  const m = customizeCch(prep, g.len);
  const ranks = Array.from(prep.rank);
  const steps: ClassroomStep[] = [];
  const s = CLASSROOM_SOURCE;
  const t = CLASSROOM_TARGET;

  // 전처리: 순위 낮은 교차로부터 수축하면서, 그 교차로를 거쳐 가던 위쪽 이웃끼리 지름길을 잇는다
  const adj: Set<number>[] = Array.from({ length: g.n }, () => new Set());
  for (let e = 0; e < g.m; e++) {
    adj[g.from[e]].add(g.to[e]);
    adj[g.to[e]].add(g.from[e]);
  }
  const arcCost = (a: number, b: number) => {
    const lo = prep.rank[a] < prep.rank[b] ? a : b;
    const hi = lo === a ? b : a;
    for (let i = prep.arcBegin[lo]; i < prep.arcEnd[lo]; i++) if (prep.arcHead[i] === hi) return m.up[i];
    return Infinity;
  };
  const shortcuts: NonNullable<ClassroomScene["shortcuts"]> = [];
  steps.push({
    current: -1,
    visited: [],
    path: [],
    best: null,
    phase: PHASE.preprocess,
    text: `Each intersection gets an importance rank (higher on the boundaries that split the map in half). The numbers are the ranks.`,
    shortcutsShown: 0,
  });
  for (const v of prep.order) {
    const higher = [...adj[v]].filter((u) => prep.rank[u] > prep.rank[v]).sort((a, b) => prep.rank[a] - prep.rank[b]);
    const added: string[] = [];
    for (let i = 0; i < higher.length; i++)
      for (let j = i + 1; j < higher.length; j++) {
        const a = higher[i], b = higher[j];
        if (adj[a].has(b)) continue;
        adj[a].add(b);
        adj[b].add(a);
        shortcuts.push({ a, b, cost: arcCost(a, b), via: v });
        added.push(`${name(a)}–${name(b)}`);
      }
    steps.push({
      current: v,
      visited: [],
      path: [],
      best: null,
      phase: PHASE.preprocess,
      text: added.length
        ? `Contract ${name(v)} (rank ${prep.rank[v]}): add shortcut ${added.join(", ")} between neighbors that went through ${name(v)}`
        : `Contract ${name(v)} (rank ${prep.rank[v]}): upper neighbors are already connected, so no shortcut`,
      shortcutsShown: shortcuts.length,
    });
  }

  // 질의: 출발점 · 도착점에서 소거 트리를 따라 위로만 올라간다
  const climb = (start: number, up: boolean, who: string) => {
    const dist = new Map<number, number>([[start, 0]]);
    const seen: number[] = [];
    for (let x = start; x !== -1; x = prep.parent[x]) {
      seen.push(x);
      const dx = dist.get(x) ?? Infinity;
      const reached: string[] = [];
      for (let a = prep.arcBegin[x]; a < prep.arcEnd[x]; a++) {
        const y = prep.arcHead[a];
        const c = dx + (up ? m.up[a] : m.down[a]);
        if (c < (dist.get(y) ?? Infinity)) {
          dist.set(y, c);
          reached.push(`${name(y)} ${c}`);
        }
      }
      steps.push({
        current: x,
        visited: [...visitedBefore, ...seen],
        path: [],
        best: null,
        phase: PHASE.query,
        text: `Up from ${who}: ${name(x)} (${dx === Infinity ? "not reached yet" : dx})${reached.length ? ` → ${reached.join(", ")}` : ""}`,
        labels: Object.fromEntries([...dist].map(([k, v]) => [k, `${up ? "↑" : "↓"}${v}`])),
        shortcutsShown: shortcuts.length,
      });
    }
    return dist;
  };
  const visitedBefore: number[] = [];
  const df = climb(s, true, "start");
  visitedBefore.push(...df.keys());
  const db = climb(t, false, "goal");
  let best = Infinity, meet = -1;
  for (const [x, a] of df) {
    const b = db.get(x);
    if (b !== undefined && a + b < best) {
      best = a + b;
      meet = x;
    }
  }
  const r = FINDERS.cch(g, s, t, { timeLimitMs: null });
  const visited = [...new Set([...df.keys(), ...db.keys()])];
  steps.push({
    current: meet,
    visited,
    path: [],
    best: null,
    phase: PHASE.query,
    text: `The cheapest meeting point of the two sides is ${name(meet)}: ${df.get(meet)} + ${db.get(meet)} = ${best}. The shortcuts are unpacked into real roads.`,
    shortcutsShown: shortcuts.length,
  });
  steps.push({ current: -1, visited, path: [], best: null, text: `Result: ${routeText(g, r.pathEdges)} = ${r.lengthM}m`, final: r.pathEdges, shortcutsShown: shortcuts.length });
  return {
    steps,
    shortcuts,
    ranks,
    result: `${routeText(g, r.pathEdges)} = ${r.lengthM}m · ${shortcuts.length} shortcuts built in advance, and the query examines only ${r.uniqueVisited} intersections`,
  };
}

/** LPA*: 첫 계획 → 도로 혼잡 → 바뀐 곳 근처만 다시 계획 */
function lpaScene(): ClassroomScene {
  const g = classroomGraph();
  const s = CLASSROOM_SOURCE;
  const t = CLASSROOM_TARGET;
  const lpa = new LpaStar(g, s, t, g.len, 1);
  const steps: ClassroomStep[] = [];
  const labels: Record<number, string> = {};
  let visited: number[] = [];
  const narrate = (phase: string) => (u: number, gv: number, rhs: number) => {
    if (!visited.includes(u)) visited = [...visited, u];
    if (gv > rhs) {
      labels[u] = `${rhs}`;
      steps.push({ current: u, visited, path: [], best: null, phase, text: `Settled ${name(u)} · cost ${rhs}`, labels: { ...labels }, jam: phase !== PHASE.first });
    } else {
      labels[u] = "?";
      steps.push({
        current: u,
        visited,
        path: [],
        best: null,
        phase,
        text: `${name(u)}: known cost ${gv} is no longer valid → clear it and recompute with its neighbors`,
        labels: { ...labels },
        jam: phase !== PHASE.first,
      });
    }
  };
  const first = lpa.compute({ onExpand: narrate(PHASE.first) });
  const firstCount = steps.length;
  steps.push({
    current: -1,
    visited,
    path: [],
    best: null,
    phase: PHASE.first,
    text: `First plan result: ${routeText(g, first.pathEdges)} = ${first.cost}m. This work is kept, not thrown away.`,
    labels: { ...labels },
    final: first.pathEdges,
  });

  const jamEdges: number[] = [];
  for (let e = 0; e < g.m; e++) {
    const pair = [name(g.from[e]), name(g.to[e])].sort().join("");
    if (pair === [CLASSROOM_JAM.a, CLASSROOM_JAM.b].sort().join("")) jamEdges.push(e);
  }
  const w = g.len.slice();
  for (const e of jamEdges) w[e] = g.len[e] * CLASSROOM_JAM.factor;
  for (const e of jamEdges) lpa.setWeight(e, w[e]);
  visited = [];
  steps.push({
    current: -1,
    visited: [],
    path: [],
    best: null,
    phase: PHASE.change,
    text: `Road ${CLASSROOM_JAM.a}–${CLASSROOM_JAM.b} is now congested: cost ${g.len[jamEdges[0]]} → ${w[jamEdges[0]]}. Only the intersections at the end of this road are marked to be rechecked.`,
    labels: { ...labels },
    jam: true,
  });
  const again = lpa.compute({ onExpand: narrate(PHASE.replan) });
  const againCount = steps.length - firstCount - 2;
  const fresh = FINDERS.astar(g, s, t, { timeLimitMs: null, heuristicScale: 1, weights: w });
  steps.push({
    current: -1,
    visited,
    path: [],
    best: null,
    phase: PHASE.replan,
    text: `Result: ${routeText(g, again.pathEdges)} = ${again.cost}`,
    labels: { ...labels },
    jam: true,
    final: again.pathEdges,
  });
  return {
    steps,
    jam: { edges: jamEdges, factor: CLASSROOM_JAM.factor },
    result: `First plan processed intersections ${firstCount} times → after the congestion, only ${againCount} more (A* starting over would examine ${fresh.visitCount}). New route ${routeText(g, again.pathEdges)} = ${again.cost}`,
  };
}

export function classroomScene(algo: StudyAlgorithmId): ClassroomScene {
  if (algo === "cch") return cchScene();
  if (algo === "lpa") return lpaScene();
  return searchScene(algo);
}
