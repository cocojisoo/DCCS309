import type { Algorithm, Frame, TraceFile } from "./FinalStudyView";

// Colors describe search states, consistently across algorithms and experiments.
export const SEARCH_STYLE = {
  current: "#c65d08", currentFill: "#fff0d9",
  visited: "#276bba", visitedFill: "#dbeafe",
  route: "#7651c9", final: "#087b53", finalFill: "#dcfce7",
  candidate: "#a86b08", road: "#cbd2dc", ink: "#243247",
  selected: "#475569", affected: "#ce3046",
} as const;

export function SimulationLegend({ dfs = false, condition = false }: { dfs?: boolean; condition?: boolean }) {
  return <div className="sim-legend" aria-label="지도 상태 범례">
    <span><i className="sim-key sim-key-current" />지금 보는 교차로</span>
    <span><i className="sim-key sim-key-visited" />이미 본 교차로</span>
    <span><i className="sim-key sim-key-unseen" />아직 안 본 교차로</span>
    <span><i className="sim-key sim-key-route" />현재 교차로까지의 길</span>
    <span><i className="sim-key sim-key-final" />확정된 최종 경로</span>
    {dfs && <span><i className="sim-key sim-key-candidate" />발견한 후보 · 아직 미확정</span>}
    {condition && <span><i className="sim-key sim-key-affected" />혼잡·폐쇄 도로</span>}
  </div>;
}

export const formatMetres = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "m";
export function nodeText(node: number, trace: TraceFile, short = false) {
  if (node < 0) return "없음";
  if (node === trace.od.source) return short ? "S" : "출발 S";
  if (node === trace.od.target) return short ? "T" : "도착 T";
  return (short ? "" : "교차로 ") + (trace.graph ? node + 1 : node);
}

/** Add only the known initial state; never invent intermediate search steps. */
export function playbackFrames(trace: TraceFile, algorithm: Algorithm): Frame[] {
  const frames = trace.runs[algorithm]?.trace?.frames ?? [];
  if (!frames.length || frames[0].step <= 1) return frames;
  return [{ step: 1, visited: 1, current: trace.od.source, path: [], best: null }, ...frames];
}

export function frameAction(trace: TraceFile, algorithm: Algorithm, frame: Frame, previous: Frame | undefined, done: boolean) {
  const run = trace.runs[algorithm]!;
  if (done) return run.status === "SUCCESS" ? "최종 경로 확정" :
    run.status === "TIMEOUT" ? "제한시간 종료 · 최단 경로 미확정" :
    run.status === "NO_PATH" ? "탐색 종료 · 도달 가능한 길 없음" : "기록 확인 필요";
  if (frame.current === trace.od.source && frame.step === 1) return "출발점에서 탐색 시작";
  if (algorithm !== "dfs") return nodeText(frame.current, trace) + "까지의 최소 비용 확정";
  if (frame.current === trace.od.target) return "도착 경로 발견 · 다른 길도 계속 확인";
  const changedBranch = previous && previous.path.some((edge, i) => frame.path[i] !== edge);
  return changedBranch ? "다른 갈래의 경로 확인" : "한 갈래를 따라 다음 교차로 확인";
}
