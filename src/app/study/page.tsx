import type { Metadata } from "next";
import StudyView from "@/components/study/StudyView";

export const metadata: Metadata = { title: "Experiments · Route Lab" };

export default function StudyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Map-Size, Congestion and Closure Experiments</h1>
        <p className="muted text-sm mt-1">
          We grow the real Jochiwon road map step by step to compare how DFS, Dijkstra, A*, CCH and LPA* search and how fast they are. We then see how A*,
          CCH and LPA* find a new route when roads become congested or closed.
        </p>
      </div>
      <StudyView />
    </div>
  );
}
