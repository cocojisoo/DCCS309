"use client";

import { useEffect, useState } from "react";
import type { StudySummary } from "@/lib/study/summary";
import type { TrafficIndex } from "@/lib/study/traffic";
import CompareView from "./CompareView";
import ResultsView from "./ResultsView";
import { fetchJson } from "./shared";
import TrafficView from "./TrafficView";

const SCREENS = [
  { id: "compare", label: "1. Jochiwon Search Comparison" },
  { id: "traffic", label: "2. Congestion & Closure" },
  { id: "results", label: "3. Results" },
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
      <div className="tabs" role="tablist" aria-label="Experiment screens">
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
          <p className="muted text-sm">Loading…</p>
        ) : summary ? (
          <ResultsView summary={summary} traffic={traffic} />
        ) : (
          <p className="card text-sm">
            No experiment results yet. Run the official experiment with <code>npm run study:run</code> to generate the data for this screen.
          </p>
        ))}
    </div>
  );
}
