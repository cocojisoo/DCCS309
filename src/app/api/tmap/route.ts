import type { NextRequest } from "next/server";
import { getDirections, parseMode } from "@/lib/server/directions";

// GET /api/tmap?mode=car|walk
export async function GET(request: NextRequest) {
  const mode = parseMode(request.nextUrl.searchParams.get("mode"));
  if (!mode) return Response.json({ error: "mode 는 car 또는 walk 여야 합니다" }, { status: 400 });
  return Response.json(await getDirections("tmap", mode));
}
