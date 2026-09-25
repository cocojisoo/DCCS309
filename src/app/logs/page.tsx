import type { Metadata } from "next";
import LogsView from "@/components/LogsView";

export const metadata: Metadata = { title: "로그 · Route Lab" };

export default function LogsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">로그</h1>
        <p className="muted text-sm mt-1">
          서버 로그는 <code>infra/logs/output.log</code>, <code>infra/logs/error.log</code>에 쌓입니다 (로컬 전용).
        </p>
      </div>
      <LogsView />
    </div>
  );
}
