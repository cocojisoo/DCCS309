export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}분 ${s.toString().padStart(2, "0")}초` : `${s}초`;
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return ms < 1 ? `${ms.toFixed(3)}ms` : ms < 10 ? `${ms.toFixed(2)}ms` : `${ms.toFixed(1)}ms`;
}

export const formatInt = (n: number) => n.toLocaleString("ko-KR");
