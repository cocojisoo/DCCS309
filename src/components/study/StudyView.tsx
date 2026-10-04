"use client";

import { useEffect, useState } from "react";
import type { StudySummary } from "@/lib/study/summary";
import type { TrafficIndex } from "@/lib/study/traffic";
import CompareView from "./CompareView";
import ResultsView from "./ResultsView";
import { fetchJson } from "./shared";
import TrafficView from "./TrafficView";

const SCREENS = [
  { id: "compare", label: "1. 조치원 탐색 비교" },
  { id: "traffic", label: "2. 혼잡 · 폐쇄" },
  { id: "results", label: "3. 실험 결과" },
] as const;
type ScreenId = (typeof SCREENS)[number]["id"];

export default function StudyView() {
  const [screen, setScreen] = useState<ScreenId>("compare");
  const [summary, setSummary] = useState<StudySummary | null | undefined>(undefined);
  const [traffic, setTraffic] = useState<TrafficIndex | null>(null);

  useEffect(() => {
    fetchJson<StudySummary>("/study/summary.json").then(setSummary);
    fetchJson<TrafficIndex>("/study/traffic/index.json").then(setTraffic);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="tabs" role="tablist" aria-label="실험 화면">
        {SCREENS.map((s) => (
          <button key={s.id} role="tab" className="tab" aria-selected={screen === s.id} onClick={() => setScreen(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {screen === "compare" && <CompareView timeLimitS={summary?.config.run.dfs_time_limit_s ?? 2} />}
      {screen === "traffic" && <TrafficView />}
      {screen === "results" &&
        (summary === undefined ? (
          <p className="muted text-sm">불러오는 중…</p>
        ) : summary ? (
          <ResultsView summary={summary} traffic={traffic} />
        ) : (
          <p className="card text-sm">
            아직 실험 결과가 없습니다. <code>npm run study:run</code> 으로 공식 실험을 돌리면 이 화면의 데이터가 만들어집니다.
          </p>
        ))}
    </div>
  );
}
