"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { runAlgorithm } from "@/lib/algorithms";
import { edgesToLatLngs } from "@/lib/benchmark";
import { END, MODE_LABEL, SPEED_KMH, START, speedMps, type Mode } from "@/lib/config";
import { formatDistance, formatDuration } from "@/lib/format";
import { overlapRatio, polylineLength, type LatLng } from "@/lib/geo";
import { loadGraph, nearestNode } from "@/lib/graph";
import GroupedBarChart from "./GroupedBarChart";
import type { PathLayer } from "./RouteMap";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="map-box grid place-items-center muted">지도 불러오는 중…</div>,
});

type Provider = "tmap" | "kakao";

interface AppResult {
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

interface OurResult {
  path: LatLng[];
  distanceM: number;
  etaSec: number;
  etaPenaltySec: number;
}

interface ModeComparison {
  ours: OurResult;
  apps: AppResult[];
}

const PROVIDERS: Record<Provider, { name: string; color: string; dash: string; modes: Mode[] }> = {
  tmap: { name: "TMAP", color: "var(--walk)", dash: "10 7", modes: ["car", "walk"] },
  kakao: { name: "카카오모빌리티", color: "var(--series-3)", dash: "2 7", modes: ["car"] },
};
const OURS_COLOR = "var(--car)";

async function computeOurs(mode: Mode): Promise<OurResult> {
  const g = await loadGraph(mode);
  const source = nearestNode(g, START.lat, START.lng).node;
  const target = nearestNode(g, END.lat, END.lng).node;
  const base = { source, target, speed: speedMps(mode), record: false };
  const plain = runAlgorithm("dijkstra", g, { ...base, penalties: false });
  const withPenalty = runAlgorithm("dijkstra", g, { ...base, penalties: true });
  return { path: edgesToLatLngs(g, plain.pathEdges), distanceM: plain.distanceM, etaSec: plain.costSec, etaPenaltySec: withPenalty.costSec };
}

async function fetchApp(provider: Provider, mode: Mode): Promise<AppResult> {
  const res = await fetch(`/api/${provider}?mode=${mode}`);
  return res.json();
}

export default function MapAppsView() {
  const [mode, setMode] = useState<Mode>("car");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Partial<Record<Mode, ModeComparison>>>({});
  const [loadedAt, setLoadedAt] = useState("");

  async function load() {
    setLoading(true);
    try {
      const next: Partial<Record<Mode, ModeComparison>> = {};
      await Promise.all(
        (["car", "walk"] as Mode[]).map(async (m) => {
          const providers = (Object.keys(PROVIDERS) as Provider[]).filter((p) => PROVIDERS[p].modes.includes(m));
          const [ours, ...apps] = await Promise.all([computeOurs(m), ...providers.map((p) => fetchApp(p, m))]);
          next[m] = { ours, apps };
        }),
      );
      setData(next);
      setLoadedAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }

  const cmp = data[mode];
  const speed = speedMps(mode);
  const okApps = cmp?.apps.filter((a) => a.ok) ?? [];

  const paths: PathLayer[] = cmp
    ? [
        { color: OURS_COLOR, points: cmp.ours.path, label: `우리 다익스트라 · ${formatDistance(cmp.ours.distanceM)}`, weight: 6 },
        ...okApps.map((a) => ({
          color: PROVIDERS[a.provider].color,
          points: a.path,
          label: `${PROVIDERS[a.provider].name} · ${formatDistance(a.distanceM)}`,
          dash: PROVIDERS[a.provider].dash,
          weight: 4,
        })),
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabs" role="tablist" aria-label="이동 수단">
          {(["car", "walk"] as Mode[]).map((m) => (
            <button key={m} role="tab" className="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={load} disabled={loading}>
          {loading ? "조회 중…" : cmp ? "다시 조회" : "▶ 경로 조회"}
        </button>
      </div>

      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap gap-4 text-xs muted">
          <span>
            <span className="swatch" style={{ background: OURS_COLOR }} />
            우리 다익스트라 (실선)
          </span>
          {(Object.keys(PROVIDERS) as Provider[])
            .filter((p) => PROVIDERS[p].modes.includes(mode))
            .map((p) => (
              <span key={p}>
                <span className="swatch" style={{ background: PROVIDERS[p].color }} />
                {PROVIDERS[p].name} ({p === "tmap" ? "긴 점선" : "짧은 점선"})
              </span>
            ))}
        </div>
        <RouteMap paths={paths} animationKey={`${mode}|${loadedAt}`} />
      </section>

      {cmp && (
        <>
          <section className="card">
            <h2 className="font-semibold mb-1">{MODE_LABEL[mode]} 비교</h2>
            <p className="text-xs faint mb-3">
              재계산 ETA = 경로 거리 ÷ {SPEED_KMH[mode]}km/h · 차이 = 앱 ETA − 재계산 ETA (앱이 반영한 신호·교통·회전 비용) · 겹침 = 앱
              경로를 10m 간격으로 나눈 점 중 우리 경로에서 15m 이내인 비율
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>경로</th>
                    <th>경로 거리</th>
                    <th>앱 ETA</th>
                    <th>{SPEED_KMH[mode]}km/h 재계산 ETA</th>
                    <th>차이</th>
                    <th>우리 경로와 겹침</th>
                    <th>조회 시각</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="swatch" style={{ background: OURS_COLOR }} />
                      우리 다익스트라
                    </td>
                    <td>{formatDistance(cmp.ours.distanceM)}</td>
                    <td className="faint" title="현실 보정(교차로/횡단보도)을 적용한 우리 모델의 ETA">
                      (보정 적용 {formatDuration(cmp.ours.etaPenaltySec)})
                    </td>
                    <td>{formatDuration(cmp.ours.etaSec)}</td>
                    <td>—</td>
                    <td>100%</td>
                    <td>—</td>
                  </tr>
                  {cmp.apps.map((a) => {
                    const p = PROVIDERS[a.provider];
                    if (!a.ok)
                      return (
                        <tr key={a.provider}>
                          <td>
                            <span className="swatch" style={{ background: p.color }} />
                            {p.name}
                          </td>
                          <td colSpan={6} className="!text-left faint">
                            {a.configured ? `조회 실패: ${a.error}` : `API 키 미설정 (${a.error})`}
                          </td>
                        </tr>
                      );
                    const recalc = a.distanceM / speed;
                    const geomLen = polylineLength(a.path);
                    return (
                      <tr key={a.provider}>
                        <td>
                          <span className="swatch" style={{ background: p.color }} />
                          {p.name}
                        </td>
                        <td title={`좌표로 계산한 길이: ${formatDistance(geomLen)}`}>{formatDistance(a.distanceM)}</td>
                        <td>{formatDuration(a.appEtaSec)}</td>
                        <td>{formatDuration(recalc)}</td>
                        <td>
                          {a.appEtaSec >= recalc ? "+" : "−"}
                          {formatDuration(Math.abs(a.appEtaSec - recalc))}
                        </td>
                        <td>{(overlapRatio(a.path, cmp.ours.path) * 100).toFixed(0)}%</td>
                        <td className="faint">
                          {new Date(a.fetchedAt).toLocaleTimeString("ko-KR")}
                          {a.cached ? " (캐시)" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <GroupedBarChart
            title="소요 시간 비교"
            subtitle="우리 모델의 '앱/보정 ETA'는 교차로·횡단보도 보정을 적용한 값"
            series={[
              { key: "fixed", label: `고정 속도 ${SPEED_KMH[mode]}km/h`, color: "var(--car)" },
              { key: "real", label: "앱 ETA / 보정 적용", color: "var(--walk)" },
            ]}
            rows={[
              { label: "우리 다익스트라", values: { fixed: cmp.ours.etaSec, real: cmp.ours.etaPenaltySec } },
              ...okApps.map((a) => ({ label: PROVIDERS[a.provider].name, values: { fixed: a.distanceM / speed, real: a.appEtaSec } })),
            ]}
            format={formatDuration}
          />
        </>
      )}

      {!cmp && (
        <p className="text-sm muted">
          ▶ 경로 조회를 누르면 {START.name} → {END.name} 경로를 TMAP·카카오 API로 받아와 우리 다익스트라 결과와 비교합니다. API 키가 없으면 해당
          항목만 &quot;API 키 미설정&quot;으로 표시됩니다.
        </p>
      )}
    </div>
  );
}
