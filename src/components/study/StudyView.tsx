"use client";

import { useEffect, useState } from "react";
import type { StudySummary } from "@/lib/study/summary";
import ClassroomView from "./ClassroomView";
import CompareView from "./CompareView";
import GrowthView from "./GrowthView";
import { fetchJson } from "./shared";
import TradeoffView from "./TradeoffView";
import FinalStudyView from "./FinalStudyView";

const SCREENS = [
  { id: "final", label: "최종 도로망 연구" },
  { id: "classroom", label: "1. 알고리즘 교실" },
  { id: "compare", label: "2. 조치원 탐색 비교" },
  { id: "growth", label: "3. 크기에 따른 변화" },
  { id: "tradeoff", label: "4. 장단점 정리" },
] as const;
type ScreenId = (typeof SCREENS)[number]["id"];

export default function StudyView() {
  const [screen, setScreen] = useState<ScreenId>("final");
  const [summary, setSummary] = useState<StudySummary | null | undefined>(undefined);

  useEffect(() => {
    fetchJson<StudySummary>("/study/summary.json").then(setSummary);
  }, []);

  const noResults = (
    <p className="card text-sm">
      아직 실험 결과가 없습니다. <code>npm run study:run</code> 으로 공식 실험을 돌리면 <code>results/raw_runs.csv</code> 와 이 화면의 데이터가
      만들어집니다.
    </p>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="tabs" role="tablist" aria-label="실험 화면">
        {SCREENS.map((s) => (
          <button key={s.id} role="tab" className="tab" aria-selected={screen === s.id} onClick={() => setScreen(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {screen === "final" && <FinalStudyView />}
      {screen === "classroom" && <ClassroomView />}
      {screen === "compare" && <CompareView timeLimitS={summary?.config.run.dfs_time_limit_s ?? 2} />}
      {screen === "growth" && (summary === undefined ? <p className="muted text-sm">불러오는 중…</p> : summary ? <GrowthView summary={summary} /> : noResults)}
      {screen === "tradeoff" && (summary === undefined ? <p className="muted text-sm">불러오는 중…</p> : summary ? <TradeoffView summary={summary} /> : noResults)}
    </div>
  );
}
