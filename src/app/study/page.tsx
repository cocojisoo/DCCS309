import type { Metadata } from "next";
import StudyView from "@/components/study/StudyView";

export const metadata: Metadata = { title: "실험 · Route Lab" };

export default function StudyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">DFS · 다익스트라 · A* 크기별 실험</h1>
        <p className="muted text-sm mt-1">
          조치원 실제 차량 도로 지도를 조금씩 키워가면서, 모든 길을 다 확인하는 단순한 방법(DFS)과 더 똑똑한 방법(다익스트라, A*)이 길을 찾는
          모습과 속도가 어떻게 달라지는지 비교합니다. 비용은 도로 길이(m) 하나입니다.
        </p>
      </div>
      <StudyView />
    </div>
  );
}
