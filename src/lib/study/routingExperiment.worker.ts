import { runRoutingExperiment, type ExperimentProgress, type ExperimentRequest, type ExperimentResult } from "./routingExperiments.ts";

export type ExperimentMessage =
  | { type: "progress"; progress: ExperimentProgress }
  | { type: "result"; result: ExperimentResult }
  | { type: "error"; message: string };

// 측정·정답 검사·기록 생성을 화면 그리기와 별도의 작업 스레드에서 실행한다.
self.onmessage = (event: MessageEvent<ExperimentRequest>) => {
  const send = (message: ExperimentMessage) => self.postMessage(message);
  try {
    const result = runRoutingExperiment(event.data, (progress) => send({ type: "progress", progress }));
    send({ type: "result", result });
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "실험에 실패했습니다." });
  }
};
