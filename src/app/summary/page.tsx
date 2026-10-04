import type { Metadata } from "next";
import FinalSummaryView from "@/components/study/FinalSummaryView";

export const metadata: Metadata = { title: "최종 정리 · Route Lab" };

export default function SummaryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">최종 정리</h1>
        <p className="muted text-sm mt-1">
          DFS, 다익스트라, A*, CCH, LPA* 가 정상 도로와 혼잡 · 폐쇄 상황에서 가장 짧은 경로와 가장 짧은 이동시간을 보장하는지, 입력이 커질 때 무엇이
          좋고 나쁜지를 실험 결과와 함께 정리합니다.
        </p>
      </div>
      <FinalSummaryView />
    </div>
  );
}
