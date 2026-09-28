import type { Metadata } from "next";
import StudyView from "@/components/study/StudyView";

export const metadata: Metadata = { title: "실험 · Route Lab" };

export default function StudyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">도로망 알고리즘 실험</h1>
        <p className="muted text-sm mt-1">조건을 고르고, 탐색 과정을 재생하고, 같은 정답에 도달하는 데 든 작업량을 비교하세요.</p>
      </div>
      <StudyView />
    </div>
  );
}
