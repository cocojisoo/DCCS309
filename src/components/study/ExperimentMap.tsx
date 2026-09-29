"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Algorithm, Frame, RoadJson, TraceFile } from "./FinalStudyView";
import { formatMetres, nodeText, SEARCH_STYLE as color } from "./SimulationAppearance";

interface Props {
  trace: TraceFile; road: RoadJson; algorithm: Algorithm; frame: Frame | null; done: boolean;
  full: boolean; normalRoute: string[]; impacted: Set<string>; showBaseline?: boolean;
}
interface Drawing extends Props {
  width: number; height: number; route: number[]; final: boolean; current: number;
  visited: Set<number>; chosen: number; selectedEdge: number | null;
  onNode: (node: number) => void; allRoads: boolean;
}

export default function ExperimentMap(props: Props) {
  const { trace, road, algorithm, frame, done, impacted } = props;
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  const [inspection, setInspection] = useState<{ node: number; edge: number | null } | null>(null);
  const [detailMode, setDetailMode] = useState<"connections" | "route" | null>(null);
  const [allRoads, setAllRoads] = useState(true);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const graph = trace.graph ?? road;
  const run = trace.runs[algorithm]!;
  const final = done && run.status === "SUCCESS";
  const current = !done && frame && frame.current >= 0 ? frame.current : -1;
  const route = useMemo(() => final ? run.pathEdges : done ? frame?.best ?? [] : frame?.path ?? [], [final, done, run, frame]);
  const mode = detailMode ?? (done ? "route" : "connections");
  const chosen = inspection?.node ?? (current >= 0 ? current : trace.od.source);
  const edges = mode === "route" ? route : graph.from.map((v, e) => v === chosen ? e : -1)
    .filter(e => e >= 0).sort((a, b) => graph.len[a] - graph.len[b]);
  const selectedEdge = inspection?.edge != null && edges.includes(inspection.edge) ? inspection.edge : null;
  const visited = useMemo(() => new Set((run.trace?.order ?? []).slice(0, frame?.visited ?? 0)), [run, frame]);
  const height = trace.graph ? (width < 480 && graph.from.length > 30 ? 480 : 370) : 430;
  const onNode = (node: number) => { setInspection({ node, edge: null }); setDetailMode("connections"); };
  const drawing: Drawing = { ...props, width, height, route, final, current, visited, chosen, selectedEdge, onNode, allRoads };
  return <div ref={host} className="sim-map">
    <div className="sim-map-tools">
      <span>{trace.graph ? "S 출발 · T 도착 · 화살표 방향으로 이동" : "S 출발 · T 도착 · 교차로를 눌러 도로 확인"}</span>
      {trace.graph && <label><input type="checkbox" checked={allRoads} onChange={e => setAllRoads(e.target.checked)} />전체 도로</label>}
    </div>
    <div className="sim-map-surface" style={{ height }}>
      {trace.graph ? <SyntheticMap {...drawing} /> : <RoadMap {...drawing} />}
      <div className={"sim-map-state " + (final ? "is-final" : done ? "is-stopped" : "")}>
        {final ? "✓ 최종 경로" : done ? run.status === "TIMEOUT" ? route.length ? "미확정 · 후보 경로만 표시" : "미확정 · 발견한 후보 없음" : "탐색 종료" :
          current >= 0 ? "◎ 현재 " + nodeText(current, trace) : "재생 대기 · S에서 시작"}
      </div>
      {selectedEdge !== null && <div className="sim-edge-label">
        {nodeText(graph.from[selectedEdge], trace, true)} → {nodeText(graph.to[selectedEdge], trace, true)}
        <strong>{formatMetres(graph.len[selectedEdge])}</strong><span>점선으로 선택한 도로</span>
      </div>}
    </div>
    <div className="sim-road-inspector">
      <div className="sim-inspector-heading">
        <div className="sim-detail-tabs" aria-label="도로 길이 표시">
          <button aria-pressed={mode === "connections"} onClick={() => setDetailMode("connections")}>연결 도로</button>
          <button aria-pressed={mode === "route"} onClick={() => setDetailMode("route")}>{final ? "최종 경로" : done ? "후보 경로" : "현재 경로"}</button>
        </div>
        {inspection && <button className="sim-small-button" onClick={() => { setInspection(null); setDetailMode(null); }}>탐색 따라가기</button>}
      </div>
      <p>{mode === "connections" ? nodeText(chosen, trace) + "에서 나가는 도로 · 짧은 순" :
        edges.length ? "출발부터 순서대로 · 합계 " + formatMetres(edges.reduce((s, e) => s + graph.len[e], 0)) : "아직 표시할 경로가 없습니다."}</p>
      {!!edges.length && <div className="sim-edge-list" aria-label="도로별 실제 길이">
        {edges.map((e, i) => <button key={e} aria-pressed={selectedEdge === e}
          onClick={() => setInspection({ node: chosen, edge: selectedEdge === e ? null : e })}>
          <span className="sim-edge-number">{mode === "route" ? i + 1 : "→"}</span>
          <span>{nodeText(graph.from[e], trace, true)} → {nodeText(graph.to[e], trace, true)}</span>
          <strong>{formatMetres(graph.len[e])}</strong>
          <span className="sim-edge-tag">{!trace.graph && impacted.has(road.edgeId[e]) ? "조건 변경" : route.includes(e) ? final ? "최종 경로" : "경로 위" : "도로 보기"}</span>
        </button>)}
      </div>}
      {mode === "connections" && !edges.length && <p>이 교차로에서 나가는 도로가 없습니다.</p>}
      <small>도로 항목을 누르면 지도에서 강조됩니다.{trace.graph && " 도식의 선 길이와 실제 거리는 다릅니다."}</small>
    </div>
  </div>;
}

function SyntheticMap({ trace, width, height, route, final, done, frame, current, visited, chosen, selectedEdge, onNode, allRoads }: Drawing) {
  const id = useId().replaceAll(":", "");
  const graph = trace.graph!;
  const cols = width < 480 ? (graph.x.length <= 8 ? 3 : 4) : graph.x.length > 16 ? 6 : 4;
  const rows = Math.ceil(graph.x.length / cols);
  const point = (v: number) => ({
    x: 35 + (v % cols) * (width - 70) / (cols - 1),
    y: 75 + Math.floor(v / cols) * (height - 120) / Math.max(1, rows - 1),
  });
  const geometry = (edge: number) => {
    const a = point(graph.from[edge]), b = point(graph.to[edge]);
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    const bend = Math.min(38, length * 0.16);
    const cx = (a.x + b.x) / 2 - dy / length * bend, cy = (a.y + b.y) / 2 + dx / length * bend;
    const al = Math.hypot(cx - a.x, cy - a.y), bl = Math.hypot(cx - b.x, cy - b.y);
    return "M" + (a.x + (cx - a.x) / al * 17) + " " + (a.y + (cy - a.y) / al * 17) +
      " Q" + cx + " " + cy + " " + (b.x + (cx - b.x) / bl * 21) + " " + (b.y + (cy - b.y) / bl * 21);
  };
  const finalNodes = new Set(final ? [trace.od.source, ...route.map(e => graph.to[e])] : []);
  const candidate = !final ? frame?.best ?? [] : [];
  const path = (e: number, stroke: string, weight: number, dash?: string, arrow = false) =>
    <path key={e} d={geometry(e)} fill="none" stroke={stroke} strokeWidth={weight} strokeDasharray={dash}
      strokeLinecap="round" markerEnd={arrow ? "url(#" + id + (final ? "-final)" : "-route)") : undefined} />;
  return <svg viewBox={"0 0 " + width + " " + height} role="group" aria-label="가상 도로 탐색 지도">
    <defs>{[["route", color.route], ["final", color.final]].map(([name, fill]) =>
      <marker key={name} id={id + "-" + name} markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M0 0 L10 5 L0 10 Z" fill={fill} /></marker>)}</defs>
    {allRoads && <g opacity={graph.x.length > 16 ? 0.28 : 0.5}>{graph.from.map((from, e) => from !== chosen ? path(e, color.road, 1) : null)}</g>}
    {graph.from.map((from, e) => from === chosen ? path(e, color.road, 1.8) : null)}
    {candidate.map(e => path(e, color.candidate, 3, "5 5"))}
    {selectedEdge !== null && path(selectedEdge, color.selected, 11, "3 6")}
    {route.map(e => path(e, "#fff", final ? 7 : 5))}
    {route.map(e => path(e, final ? color.final : done ? color.candidate : color.route, final ? 5 : 3.5, done && !final ? "6 5" : undefined, !done || final))}
    {graph.x.map((_, v) => {
      const { x, y } = point(v), active = current === v, seen = visited.has(v), onFinal = finalNodes.has(v);
      const state = active ? "지금 보는 교차로" : onFinal ? "최종 경로" : seen ? "이미 본 교차로" : "아직 안 본 교차로";
      return <g key={v} role="button" tabIndex={0} aria-label={nodeText(v, trace) + " · " + state + " · 연결 도로 보기"}
        onClick={() => onNode(v)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNode(v); } }}
        className="lab-node-button">
        {active && <circle cx={x} cy={y} r="22" fill="none" stroke={color.current} strokeWidth="3" />}
        {chosen === v && !active && <circle cx={x} cy={y} r="22" fill="none" stroke={color.selected} strokeWidth="1.5" strokeDasharray="3 3" />}
        <circle cx={x} cy={y} r="16" fill={active ? color.currentFill : onFinal ? color.finalFill : seen ? color.visitedFill : "#fff"}
          stroke={active ? color.current : onFinal ? color.final : seen ? color.visited : "#94a3b8"} strokeWidth="2" />
        <text x={x} y={y + 4.5} textAnchor="middle" fontSize="13" fontWeight="800" fill={color.ink}>{nodeText(v, trace, true)}</text>
        {seen && !active && !onFinal && <circle cx={x + 12} cy={y - 12} r="4" fill={color.visited} stroke="#fff" strokeWidth="1.5" />}
        {onFinal && <text x={x + 12} y={y - 11} fontSize="12" fontWeight="900" fill={color.final}>✓</text>}
      </g>;
    })}
  </svg>;
}

function RoadMap(props: Drawing) {
  const { trace, road, width, height, full, frame, done, current, route, final, visited, selectedEdge, onNode,
    normalRoute, impacted, showBaseline } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const projected = useMemo(() => {
    const [lat, lng] = road.meta.center;
    const kx = 6371008.8 * Math.PI / 180 * Math.cos(lat * Math.PI / 180), ky = 6371008.8 * Math.PI / 180;
    return { x: road.lng.map(v => (v - lng) * kx), y: road.lat.map(v => (v - lat) * ky),
      point: (a: number, b: number) => [(b - lng) * kx, (a - lat) * ky] };
  }, [road]);
  const byId = useMemo(() => new Map(road.edgeId.map((id, e) => [id, e])), [road]);
  const base = useMemo(() => {
    const radius = trace.radiusM ?? 5000;
    return road.from.map((v, e) => Math.hypot(projected.x[v], projected.y[v]) <= radius &&
      Math.hypot(projected.x[road.to[e]], projected.y[road.to[e]]) <= radius ? e : -1).filter(e => e >= 0);
  }, [trace.radiusM, road, projected]);
  const viewport = useMemo(() => {
    const radius = trace.radiusM ?? 5000;
    const ids = [trace.od.source, trace.od.target, ...route.flatMap(e => [road.from[e], road.to[e]])];
    if (selectedEdge !== null) ids.push(road.from[selectedEdge], road.to[selectedEdge]);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of ids) { minX = Math.min(minX, projected.x[v]); maxX = Math.max(maxX, projected.x[v]);
      minY = Math.min(minY, projected.y[v]); maxY = Math.max(maxY, projected.y[v]); }
    if (full) { minX = -radius; maxX = radius; minY = -radius; maxY = radius; }
    else if (!done && current >= 0 && selectedEdge === null) {
      const halfSpan = radius <= 500 ? 180 : 260;
      minX = projected.x[current] - halfSpan; maxX = projected.x[current] + halfSpan;
      minY = projected.y[current] - halfSpan; maxY = projected.y[current] + halfSpan;
    }
    const scale = Math.min((width - 65) / Math.max(300, maxX - minX), (height - 105) / Math.max(300, maxY - minY));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { scale, map: (x: number, y: number): [number, number] => [width / 2 + (x - cx) * scale, height / 2 + 10 - (y - cy) * scale] };
  }, [trace, road, projected, full, done, current, route, selectedEdge, width, height]);
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    element.width = width * dpr; element.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, width, height);
    const node = (v: number) => viewport.map(projected.x[v], projected.y[v]);
    const edge = (e: number) => {
      const [x, y] = node(road.from[e]); ctx.moveTo(x, y);
      for (let i = road.geomStart[e]; i < road.geomStart[e + 1]; i += 2) {
        const p = projected.point(road.geom[i], road.geom[i + 1]);
        const [gx, gy] = viewport.map(p[0], p[1]); ctx.lineTo(gx, gy);
      }
      const [tx, ty] = node(road.to[e]); ctx.lineTo(tx, ty);
    };
    const stroke = (edges: Iterable<number>, paint: string, weight: number, dash: number[] = []) => {
      ctx.beginPath(); ctx.strokeStyle = paint; ctx.lineWidth = weight; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.setLineDash(dash); for (const e of edges) edge(e); ctx.stroke(); ctx.setLineDash([]);
    };
    const inside = (x: number, y: number) => x > 8 && x < width - 8 && y > 45 && y < height - 20;
    stroke(base, color.road, full ? 0.8 : 1.3);
    for (const e of base) {
      const [x, y] = node(road.from[e]);
      if (!inside(x, y) || visited.has(road.from[e])) continue;
      ctx.beginPath(); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#a3aebc"; ctx.lineWidth = 1;
      ctx.arc(x, y, full ? 1.5 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (showBaseline) stroke(normalRoute.map(id => byId.get(id)).filter((e): e is number => e !== undefined), "#64748b", 3, [7, 6]);
    stroke([...impacted].map(id => byId.get(id)).filter((e): e is number => e !== undefined), color.affected, 10, [7, 4]);
    if (!final && frame?.best) stroke(frame.best, color.candidate, 3, [5, 5]);
    if (selectedEdge !== null) stroke([selectedEdge], color.selected, 12, [3, 5]);
    for (const v of visited) {
      const [x, y] = node(v); if (!inside(x, y)) continue;
      ctx.beginPath(); ctx.fillStyle = color.visited; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
      ctx.arc(x, y, full ? 2.7 : 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    stroke(route, "#fff", 8);
    stroke(route, final ? color.final : done ? color.candidate : color.route, final ? 5.5 : 4, done && !final ? [6, 5] : []);
    const marker = (v: number, label: string) => {
      const [x, y] = node(v); if (!inside(x, y)) return;
      ctx.beginPath(); ctx.fillStyle = final ? color.final : color.ink; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.roundRect(x - 12, y - 12, 24, 24, 5); ctx.fill(); ctx.stroke();
      ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.fillText(label, x, y + 4.5);
    };
    marker(trace.od.source, "S"); marker(trace.od.target, "T");
    if (current >= 0) {
      const [x, y] = node(current);
      ctx.beginPath(); ctx.fillStyle = color.currentFill; ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color.current; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.strokeText(nodeText(current, trace), x, y - 24);
      ctx.fillStyle = color.ink; ctx.fillText(nodeText(current, trace), x, y - 24);
    }
    const scaleM = full ? (trace.radiusM ?? 5000) / 5 : 100;
    const bar = scaleM * viewport.scale;
    ctx.strokeStyle = color.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(15, height - 18); ctx.lineTo(15 + bar, height - 18); ctx.stroke();
    ctx.font = "11px sans-serif"; ctx.fillStyle = color.ink; ctx.textAlign = "left"; ctx.fillText(formatMetres(scaleM), 15, height - 25);
  }, [trace, road, width, height, full, frame, done, current, route, final, visited, selectedEdge, normalRoute, impacted, showBaseline, projected, viewport, byId, base]);
  return <canvas ref={canvas} style={{ width: "100%", height }} role="img" aria-label="조치원 도로 탐색 지도 · 상태별 색과 도형은 위 범례 참조"
    onClick={event => {
      const r = event.currentTarget.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top;
      let nearest = -1, distance = 16;
      for (const e of base) {
        const v = road.from[e], [vx, vy] = viewport.map(projected.x[v], projected.y[v]), d = Math.hypot(x - vx, y - vy);
        if (d < distance) { distance = d; nearest = v; }
      }
      if (nearest >= 0) onNode(nearest);
    }} />;
}
