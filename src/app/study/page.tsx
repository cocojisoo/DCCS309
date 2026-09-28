import type { Metadata } from "next";
import StudyView from "@/components/study/StudyView";

export const metadata: Metadata = { title: "실험 · Route Lab" };

export default function StudyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">도로망 알고리즘 실험</h1>
        <p className="muted text-sm mt-1">
          같은 가상 도로와 조치원 차량 도로에서 DFS·Dijkstra·A*의 경로 비용, 탐색 작업량, 검색시간을 비교합니다.
          거리와 자유 흐름 추정 이동시간을 각각 비용으로 사용할 수 있습니다. 이전 실험 화면도 위 탭에서 볼 수 있습니다.
        </p>
      </div>
      <StudyView />
    </div>
  );
}
