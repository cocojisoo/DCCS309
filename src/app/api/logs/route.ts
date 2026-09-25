import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";

const LOG_DIR = path.join(process.cwd(), "infra", "logs");
const FILES = { output: "output.log", error: "error.log" } as const;
const MAX_LINES = 1000;

// GET /api/logs?file=output|error&lines=300  (로컬 개발 전용: Vercel 에는 로그 파일이 없다)
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const file = params.get("file") as keyof typeof FILES | null;
  if (!file || !(file in FILES)) return Response.json({ error: "file 은 output 또는 error 여야 합니다" }, { status: 400 });
  const lines = Math.min(MAX_LINES, Math.max(1, Number(params.get("lines")) || 300));
  const full = path.join(LOG_DIR, FILES[file]);
  try {
    const [text, info] = await Promise.all([readFile(full, "utf8"), stat(full)]);
    const all = text.split(/\r?\n/);
    if (all[all.length - 1] === "") all.pop();
    return Response.json({
      exists: true,
      file: `infra/logs/${FILES[file]}`,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      totalLines: all.length,
      lines: all.slice(-lines),
    });
  } catch {
    return Response.json({ exists: false, file: `infra/logs/${FILES[file]}`, lines: [] });
  }
}
