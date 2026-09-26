import type { SearchStatus, StudyAlgorithmId } from "@/lib/study/search";

/** 색만으로 구분하지 않도록 방법마다 표시 모양과 선 모양도 다르게 한다 */
export const ALGO_STYLE: Record<StudyAlgorithmId, { color: string; marker: "square" | "circle" | "diamond"; dash: number[]; markerLabel: string }> = {
  dfs: { color: "var(--algo-dfs)", marker: "square", dash: [7, 5], markerLabel: "■ 네모 · 긴 점선" },
  dijkstra: { color: "var(--algo-dijkstra)", marker: "circle", dash: [], markerLabel: "● 동그라미 · 실선" },
  astar: { color: "var(--algo-astar)", marker: "diamond", dash: [2, 4], markerLabel: "◆ 마름모 · 짧은 점선" },
};

export const STATUS_LABEL: Record<SearchStatus, string> = {
  SUCCESS: "성공",
  TIMEOUT: "시간 초과",
  NO_PATH: "길 없음",
  ERROR: "오류",
};

/** CSS 변수(var(--x))를 실제 색으로 바꾼다. 캔버스는 CSS 변수를 모른다 */
export function resolveColor(c: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c);
  if (!m || typeof document === "undefined") return c;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#888";
}

const cache = new Map<string, Promise<unknown>>();

/** 정적 JSON 을 한 번만 받아 온다. 없으면 null */
export function fetchJson<T>(url: string): Promise<T | null> {
  let p = cache.get(url) as Promise<T | null> | undefined;
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
