import type { Metadata } from "next";
import StudyView from "@/components/study/StudyView";

export const metadata: Metadata = { title: "크기별 실험 · Route Lab" };

export default function StudyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">크기별 실험 · 혼잡 · 폐쇄</h1>
        <p className="muted text-sm mt-1">
          조치원 실제 차량 도로 지도를 조금씩 키워 가며 DFS, 다익스트라, A*, CCH, LPA* 가 길을 찾는 모습과 속도를 비교하고, 도로가 혼잡하거나 막혔을 때
          A*, CCH, LPA* 가 새 경로를 어떻게 다시 찾는지 봅니다.
        </p>
      </div>
      <StudyView />
    </div>
  );
}
