import { planarDistance, type StudyGraph } from "./graph.ts";
import { deriveSeed, seededRandom, shuffle } from "./rng.ts";

/** 출발·도착 한 쌍. 번호는 전체 지도 기준(orig)이라 모든 크기에서 같은 쌍을 가리킨다 */
export interface OdPair {
  id: string;
  track: 1 | 2;
  source: number;
  target: number;
  straightM: number;
}

/** 전체 지도 번호 → 이 그래프의 번호 (없으면 -1) */
export function localIndex(g: StudyGraph, origNode: number): number {
  for (let v = 0; v < g.n; v++) if (g.orig[v] === origNode) return v;
  return -1;
}

/** 조건을 만족하는 서로 다른 (출발, 도착) 쌍을 시드 고정으로 최대 max 개 고른다. 알고리즘 결과는 보지 않는다 */
function pick(g: StudyGraph, max: number, rand: () => number, ok: (s: number, t: number) => boolean): [number, number][] {
  if (g.n < 2) return [];
  if (g.n <= 600) {
    const all: [number, number][] = [];
    for (let s = 0; s < g.n; s++) for (let t = 0; t < g.n; t++) if (s !== t && ok(s, t)) all.push([s, t]);
    return shuffle(all, rand).slice(0, max);
  }
  const chosen: [number, number][] = [];
  const used = new Set<number>();
  for (let tries = 0; tries < 2_000_000 && chosen.length < max; tries++) {
    const s = Math.floor(rand() * g.n);
    const t = Math.floor(rand() * g.n);
    if (s === t || used.has(s * g.n + t) || !ok(s, t)) continue;
    used.add(s * g.n + t);
    chosen.push([s, t]);
  }
  return chosen;
}

/**
 * 트랙 1: 가장 작은 조각 안에서 쌍을 고르고 모든 크기에서 그대로 쓴다.
 * 조각이 강연결요소이므로 어떤 쌍이든 실제로 갈 수 있다.
 */
export function pickFixedPairs(smallest: StudyGraph, max: number, seed: number): OdPair[] {
  const rand = seededRandom(deriveSeed(seed, "track1"));
  return pick(smallest, max, rand, () => true).map(([s, t], i) => ({
    id: `T1-${i + 1}`,
    track: 1,
    source: smallest.orig[s],
    target: smallest.orig[t],
    straightM: planarDistance(smallest, s, t),
  }));
}

/** 그래프에서 가장 먼 두 교차로 사이 직선거리 */
export function maxStraightDistance(g: StudyGraph): number {
  let best = 0;
  for (let a = 0; a < g.n; a++) {
    const ax = g.x[a];
    const ay = g.y[a];
    for (let b = a + 1; b < g.n; b++) {
      const dx = g.x[b] - ax;
      const dy = g.y[b] - ay;
      const d = dx * dx + dy * dy;
      if (d > best) best = d;
    }
  }
  return Math.sqrt(best);
}

/** 트랙 2: 크기마다, 가장 먼 두 교차로 사이 직선거리의 [lo, hi] 비율만큼 떨어진 쌍을 고른다 */
export function pickGrowingPairs(g: StudyGraph, sizeLabel: string, max: number, ratio: [number, number], seed: number): { pairs: OdPair[]; diameterM: number } {
  const diameterM = maxStraightDistance(g);
  const lo = ratio[0] * diameterM;
  const hi = ratio[1] * diameterM;
  const rand = seededRandom(deriveSeed(seed, `track2:${sizeLabel}`));
  const pairs = pick(g, max, rand, (s, t) => {
    const d = planarDistance(g, s, t);
    return d >= lo && d <= hi;
  }).map(([s, t], i): OdPair => ({
    id: `T2-${sizeLabel}-${i + 1}`,
    track: 2,
    source: g.orig[s],
    target: g.orig[t],
    straightM: planarDistance(g, s, t),
  }));
  return { pairs, diameterM };
}
