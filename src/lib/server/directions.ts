import "server-only";
import { END, START, type Mode } from "@/lib/config";
import type { LatLng } from "@/lib/geo";

export type Provider = "tmap" | "kakao";

/** 외부 길찾기 API 응답을 통일한 형식 */
export interface DirectionsResult {
  provider: Provider;
  mode: Mode;
  configured: boolean;
  ok: boolean;
  error?: string;
  path: LatLng[];
  distanceM: number;
  appEtaSec: number;
  fetchedAt: string;
  cached?: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: DirectionsResult }>();

function fail(provider: Provider, mode: Mode, error: string, configured = true): DirectionsResult {
  return { provider, mode, configured, ok: false, error, path: [], distanceM: 0, appEtaSec: 0, fetchedAt: new Date().toISOString() };
}

/** 자주 나오는 키 설정 오류에 해결 방법을 붙인다 */
function httpError(provider: Provider, status: number, text: string): string {
  const raw = `HTTP ${status}: ${text.replace(/s+/g, " ").slice(0, 200)}`;
  if (provider === "tmap" && text.includes("INVALID_API_KEY"))
    return `${raw} → TMAP이 키를 인식하지 못합니다. TMAP API 콘솔의 appKey를 복사했는지, 해당 앱에 경로안내 상품 사용 신청이 되어 있는지 확인하세요.`;
  if (provider === "kakao" && text.includes("KA Header"))
    return `${raw} → REST API 키가 아닙니다 (JavaScript 키 또는 네이티브 앱 키로 보입니다). 카카오 디벨로퍼스 [앱 키]의 REST API 키를 넣으세요.`;
  return raw;
}

interface TmapFeature {
  geometry: { type: "Point" | "LineString"; coordinates: number[] | number[][] };
  properties: { totalDistance?: number; totalTime?: number };
}

// TMAP API 문서: https://tmapapi.tmapmobility.com/
async function fetchTmap(mode: Mode): Promise<DirectionsResult> {
  const key = process.env.TMAP_APP_KEY;
  if (!key) return fail("tmap", mode, "TMAP_APP_KEY 가 설정되지 않았습니다", false);
  const url =
    mode === "car"
      ? "https://apis.openapi.sk.com/tmap/routes?version=1&format=json"
      : "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json";
  const body = {
    startX: String(START.lng),
    startY: String(START.lat),
    endX: String(END.lng),
    endY: String(END.lat),
    reqCoordType: "WGS84GEO",
    resCoordType: "WGS84GEO",
    ...(mode === "car" ? { searchOption: "0" } : { startName: "고려대학교 세종캠퍼스 정문", endName: "조치원역 후문" }),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { appKey: key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) return fail("tmap", mode, httpError("tmap", res.status, text));
  const json = JSON.parse(text) as { features?: TmapFeature[] };
  const features = json.features ?? [];
  const summary = features[0]?.properties ?? {};
  const path: LatLng[] = [];
  for (const f of features) {
    if (f.geometry.type !== "LineString") continue;
    for (const [lng, lat] of f.geometry.coordinates as number[][]) {
      const last = path[path.length - 1];
      if (!last || last[0] !== lat || last[1] !== lng) path.push([lat, lng]);
    }
  }
  if (!path.length || summary.totalTime === undefined) return fail("tmap", mode, "응답에서 경로를 찾지 못했습니다");
  return {
    provider: "tmap",
    mode,
    configured: true,
    ok: true,
    path,
    distanceM: summary.totalDistance ?? 0,
    appEtaSec: summary.totalTime,
    fetchedAt: new Date().toISOString(),
  };
}

interface KakaoResponse {
  routes?: {
    result_code: number;
    result_msg: string;
    summary?: { distance: number; duration: number };
    sections?: { roads: { vertexes: number[] }[] }[];
  }[];
}

// 카카오모빌리티 자동차 길찾기: https://developers.kakaomobility.com/docs/navi-api/directions/
async function fetchKakao(mode: Mode): Promise<DirectionsResult> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return fail("kakao", mode, "KAKAO_REST_API_KEY 가 설정되지 않았습니다", false);
  const params = new URLSearchParams({
    origin: `${START.lng},${START.lat}`,
    destination: `${END.lng},${END.lat}`,
    priority: "RECOMMEND",
  });
  const res = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?${params}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) return fail("kakao", mode, httpError("kakao", res.status, text));
  const route = (JSON.parse(text) as KakaoResponse).routes?.[0];
  if (!route || route.result_code !== 0 || !route.summary) return fail("kakao", mode, route?.result_msg ?? "경로 없음");
  const path: LatLng[] = [];
  for (const section of route.sections ?? []) {
    for (const road of section.roads) {
      for (let i = 0; i + 1 < road.vertexes.length; i += 2) {
        const lng = road.vertexes[i];
        const lat = road.vertexes[i + 1];
        const last = path[path.length - 1];
        if (!last || last[0] !== lat || last[1] !== lng) path.push([lat, lng]);
      }
    }
  }
  return {
    provider: "kakao",
    mode,
    configured: true,
    ok: true,
    path,
    distanceM: route.summary.distance,
    appEtaSec: route.summary.duration,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getDirections(provider: Provider, mode: Mode): Promise<DirectionsResult> {
  if (provider === "kakao" && mode === "walk") return fail(provider, mode, "카카오모빌리티는 공개 도보 길찾기 API를 제공하지 않습니다");
  const cacheKey = `${provider}:${mode}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.data, cached: true };
  try {
    const data = provider === "tmap" ? await fetchTmap(mode) : await fetchKakao(mode);
    if (data.ok) {
      cache.set(cacheKey, { at: Date.now(), data });
      console.log(`[${provider}] ${mode} 경로 조회 성공: ${Math.round(data.distanceM)}m, ${Math.round(data.appEtaSec)}초`);
    } else if (data.configured) {
      console.error(`[${provider}] ${mode} 경로 조회 실패: ${data.error}`);
    }
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${provider}] ${mode} 요청 오류: ${msg}`);
    return fail(provider, mode, msg);
  }
}

export function parseMode(v: string | null): Mode | null {
  return v === "car" || v === "walk" ? v : null;
}
