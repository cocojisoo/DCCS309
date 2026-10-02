"use client";

import { useState } from "react";
import ExperimentWorkbench from "./ExperimentWorkbench";
import ResearchLab from "./ResearchLab";

const stages = [
  { id: "basic", title: "1. 같은 답을 얼마나 빨리?", subtitle: "DFS · 다익스트라 · A*", description: "지도와 목표를 같게 두고, 최적 경로를 찾는 방법과 계산 시간을 비교합니다." },
  { id: "routes", title: "2. 짧은 길 vs 빠른 길", subtitle: "거리 최소 · 이동시간 최소", description: "A*를 고정하고 경로 선택 기준을 바꿉니다. 혼잡할 때 더 긴 우회로가 더 빠른지 확인하세요." },
  { id: "replan", title: "3. 교통이 바뀌면 다시 찾기", subtitle: "A* · CCH · LPA*", description: "같은 출발·도착에서 교통 변경을 이어갑니다. 사전 준비와 이전 계산의 재사용이 언제 유리한지 비교하세요." },
] as const;

export default function ResearchWorkbench() {
  const [stage, setStage] = useState<typeof stages[number]["id"]>("basic");
  const selected = stages.find(s => s.id === stage)!;
  return <div className="research-workbench">
    <nav className="research-stages" aria-label="연구 실험 단계">{stages.map(s => <button key={s.id} aria-pressed={stage === s.id} onClick={() => setStage(s.id)}>
      <strong>{s.title}</strong><span>{s.subtitle}</span></button>)}</nav>
    <section className="research-intro"><h2>{selected.title}</h2><p>{selected.description}</p>
      <div className="research-metric-guide"><span><b>정확성</b> 선택한 목표의 최적 비용 검증</span><span><b>계산 시간</b> 컴퓨터가 답을 얻는 시간 · ms</span><span><b>이동 거리</b> 경로의 길이 · m</span><span><b>이동시간</b> 차량의 추정 주행 시간 · 분</span></div>
    </section>
    {stage === "basic" ? <ExperimentWorkbench basicOnly /> : <ResearchLab key={stage} mode={stage} />}
  </div>;
}
