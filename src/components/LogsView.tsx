"use client";

import { useCallback, useEffect, useState } from "react";
import { ALGORITHMS } from "@/lib/algorithms";
import { formatDuration, formatInt, formatMs } from "@/lib/format";
import { clearHistory, readHistory, type HistoryEntry } from "@/lib/history";

type LogFile = "output" | "error";

interface LogResponse {
  exists: boolean;
  file: string;
  sizeBytes?: number;
  modifiedAt?: string;
  totalLines?: number;
  lines: string[];
}

function LogPanel({ file }: { file: LogFile }) {
  const [data, setData] = useState<LogResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/logs?file=${file}&lines=300`, { cache: "no-store" });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [file]);

  useEffect(() => {
    // 마운트 시 한 번 불러온다 (외부 시스템 동기화)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{file === "output" ? "output.log" : "error.log"}</h2>
          <div className="text-xs faint">
            {data?.exists
              ? `${data.file} · 전체 ${formatInt(data.totalLines ?? 0)}줄 중 마지막 ${data.lines.length}줄 · 수정 ${new Date(data.modifiedAt!).toLocaleString("ko-KR")}`
              : (data?.file ?? "")}
          </div>
        </div>
        <button className="btn text-sm !py-1" onClick={load} disabled={loading}>
          ↻ 새로고침
        </button>
      </div>
      {data && !data.exists ? (
        <p className="text-sm muted">
          로그 파일이 없습니다. 로컬에서 <code>./run.sh dev</code>로 서버를 실행하면 생성됩니다. (Vercel 배포본에서는 파일 로그를 쓰지 않습니다.)
        </p>
      ) : (
        <pre className="log">{data?.lines.join("\n") || (loading ? "불러오는 중…" : "(비어 있음)")}</pre>
      )}
    </section>
  );
}

export default function LogsView() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    // localStorage 는 브라우저에서만 읽을 수 있다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(readHistory());
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">실행 기록</h2>
            <div className="text-xs faint">대시보드에서 ▶ 시작을 누를 때마다 이 브라우저(localStorage)에 최근 50회까지 저장됩니다.</div>
          </div>
          <button
            className="btn text-sm !py-1"
            onClick={() => {
              clearHistory();
              setHistory([]);
            }}
            disabled={!history.length}
          >
            기록 지우기
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-sm muted">아직 실행 기록이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>보정</th>
                  <th>자동차 ETA</th>
                  <th>도보 ETA</th>
                  {ALGORITHMS.map((a) => (
                    <th key={a.id} title="도보 기준 실행 시간 · 탐색 노드">
                      {a.short} (도보)
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.at}>
                    <td>{new Date(h.at).toLocaleString("ko-KR")}</td>
                    <td>{h.penalties ? "적용" : "없음"}</td>
                    <td>{formatDuration(h.results.car.dijkstra.etaSec)}</td>
                    <td>{formatDuration(h.results.walk.dijkstra.etaSec)}</td>
                    {ALGORITHMS.map((a) => {
                      const r = h.results.walk[a.id];
                      return (
                        <td key={a.id}>
                          {formatMs(r.runtimeMs)} <span className="faint">· {formatInt(r.visited)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <LogPanel file="output" />
      <LogPanel file="error" />
    </div>
  );
}
