import type { Metadata } from "next";
import FinalSummaryView from "@/components/study/FinalSummaryView";

export const metadata: Metadata = { title: "Final Summary · Route Lab" };

export default function SummaryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Final Summary</h1>
        <p className="muted text-sm mt-1">
          Using the experiment results, this page summarizes whether DFS, Dijkstra, A*, CCH and LPA* guarantee the shortest route and the shortest travel
          time, in normal traffic and under congestion and closures, and what helps or hurts each one as the input grows.
        </p>
      </div>
      <FinalSummaryView />
    </div>
  );
}
