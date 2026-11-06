import type { SearchStatus, StudyAlgorithmId } from "@/lib/study/search";

export type Marker = "square" | "circle" | "diamond" | "triangle" | "cross";

/** 색만으로 구분하지 않도록 방법마다 표시 모양과 선 모양도 다르게 한다 */
export const ALGO_STYLE: Record<StudyAlgorithmId, { color: string; marker: Marker; dash: number[]; markerLabel: string }> = {
  dfs: { color: "var(--algo-dfs)", marker: "square", dash: [7, 5], markerLabel: "■ square · long dash" },
  dijkstra: { color: "var(--algo-dijkstra)", marker: "circle", dash: [], markerLabel: "● circle · solid" },
  astar: { color: "var(--algo-astar)", marker: "diamond", dash: [2, 4], markerLabel: "◆ diamond · short dash" },
  cch: { color: "var(--algo-cch)", marker: "triangle", dash: [10, 3, 2, 3], markerLabel: "▲ triangle · dash-dot" },
  lpa: { color: "var(--algo-lpa)", marker: "cross", dash: [4, 2], markerLabel: "✚ cross · fine dash" },
};

export const STATUS_LABEL: Record<SearchStatus, string> = {
  SUCCESS: "Success",
  TIMEOUT: "Timed out",
  NO_PATH: "No path",
  ERROR: "Error",
};

/** 차량 이동 시간: 1분 이상이면 "N min M s", 아니면 "M.M s" */
export function formatTravel(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const total = Math.round(sec);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
}

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
