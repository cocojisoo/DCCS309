import { runResearch, type ResearchRequest } from "./research.ts";

// Runs independently of rendering. Cancelling terminates this worker and its sessions.
self.onmessage = (event: MessageEvent<ResearchRequest>) => {
  try {
    const result = runResearch(event.data, message => self.postMessage({ type: "progress", message }));
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Experiment failed" });
  }
};
