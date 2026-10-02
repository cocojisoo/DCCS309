import type { Metadata } from "next";
import StudyView from "@/components/study/StudyView";

export const metadata: Metadata = { title: "실험 · Route Lab" };

export default function StudyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">도로망 알고리즘 실험</h1>
        <p className="muted text-sm mt-1">정확한 경로를 빠르게 찾기 · 기본 탐색에서 거리·이동시간의 관계, 교통 변경 후 재탐색까지 실험합니다.</p>
      </div>
      <StudyView />
    </div>
  );
}
