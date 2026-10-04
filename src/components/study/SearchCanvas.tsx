"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoRun } from "@/lib/study/demo";
import { projector, type StudyGraphJson } from "@/lib/study/graph";
import type { StudyAlgorithmId } from "@/lib/study/search";
import { ALGO_STYLE, resolveColor } from "./shared";

export interface RoadOverlay {
  edges: number[];
  kind: "congestion" | "closure";
}

interface Props {
  json: StudyGraphJson;
  /** 이 크기의 지도에 들어 있는 도로 (전체 지도 간선 번호) */
  edgeIds: number[];
  /** 이 크기의 지도의 교차로 수 (표시 크기 조절용) */
  nodes: number;
  od: { source: number; target: number };
  run: DemoRun;
  algo: StudyAlgorithmId;
  /** -1 = 아직 시작 전 */
  frame: number;
  timeLimitS?: number;
  /** 혼잡(빨강) · 폐쇄(진한 빨강 + ✕) 도로 */
  changes?: RoadOverlay[];
  /** 비교용으로 회색 점선으로 그릴 경로 (예: 정상 상태 경로) */
  ghostPath?: number[];
}

const PAD = 14;

/** 한 방법의 탐색 과정을 그리는 캔버스. 도로선은 한 번만 그려 두고 장면마다 위에 덧그린다 */
export default function SearchCanvas({ json, edgeIds, nodes, od, run, algo, frame, timeLimitS = 2, changes, ghostPath }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState(0);

  // 전체 지도 교차로의 평면 좌표
  const xy = useMemo(() => {
    const project = projector(...json.meta.center);
    const out = new Float64Array(json.lat.length * 2);
    for (let v = 0; v < json.lat.length; v++) [out[2 * v], out[2 * v + 1]] = project(json.lat[v], json.lng[v]);
    return { out, project };
  }, [json]);

  /** 간선 e 의 선 모양 (양 끝 포함) */
  const edgePoints = useMemo(() => {
    return (e: number): [number, number][] => {
      const a = json.from[e];
      const b = json.to[e];
      const pts: [number, number][] = [[xy.out[2 * a], xy.out[2 * a + 1]]];
      for (let k = json.geomStart[e]; k < json.geomStart[e + 1]; k += 2) pts.push(xy.project(json.geom[k], json.geom[k + 1]));
      pts.push([xy.out[2 * b], xy.out[2 * b + 1]]);
      return pts;
    };
  }, [json, xy]);

  // 가로·세로 비율을 유지한 채 이 크기의 지도를 정사각형 캔버스에 맞춘다
  const fit = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of edgeIds)
      for (const [x, y] of edgePoints(e)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    return { minX, minY, maxX, maxY };
  }, [edgeIds, edgePoints]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const px = size * dpr;
  const k = useMemo(() => {
    const inner = px - 2 * PAD * dpr;
    return inner / Math.max(1, fit.maxX - fit.minX, fit.maxY - fit.minY);
  }, [px, fit, dpr]);
  const tx = (x: number) => PAD * dpr + (x - fit.minX) * k + (px - 2 * PAD * dpr - (fit.maxX - fit.minX) * k) / 2;
  const ty = (y: number) => PAD * dpr + (fit.maxY - y) * k + (px - 2 * PAD * dpr - (fit.maxY - fit.minY) * k) / 2;

  const strokeEdges = (ctx: CanvasRenderingContext2D, edges: number[], width: number, stroke: string, dash: number[] = []) => {
    if (!edges.length) return;
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(dash.map((d) => d * dpr));
    ctx.beginPath();
    for (const e of edges) {
      const pts = edgePoints(e);
      ctx.moveTo(tx(pts[0][0]), ty(pts[0][1]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i][0]), ty(pts[i][1]));
    }
    ctx.stroke();
    ctx.restore();
  };

  // 1) 기본 도로 (연회색) + 혼잡 · 폐쇄 도로 — 도로마다 선을 따로 만들지 않고 경로 하나에 모두 이어서 그린다
  useEffect(() => {
    if (!px) return;
    const base = baseRef.current ?? document.createElement("canvas");
    baseRef.current = base;
    base.width = px;
    base.height = px;
    const ctx = base.getContext("2d")!;
    ctx.clearRect(0, 0, px, px);
    strokeEdges(ctx, edgeIds, nodes > 1000 ? 0.8 : 1.6, resolveColor("var(--road)"));
    if (changes?.length) {
      const jam = changes.filter((c) => c.kind === "congestion").flatMap((c) => c.edges);
      const closed = changes.filter((c) => c.kind === "closure");
      strokeEdges(ctx, jam, 4, resolveColor("var(--jam)"));
      strokeEdges(ctx, closed.flatMap((c) => c.edges), 5, resolveColor("var(--closed)"));
      // 폐쇄 도로 가운데에 ✕ 표시
      ctx.strokeStyle = resolveColor("var(--surface)");
      ctx.lineWidth = 2 * dpr;
      for (const c of closed) {
        const pts = edgePoints(c.edges[0]);
        const [mx, my] = pts[Math.floor(pts.length / 2)];
        const x = tx(mx), y = ty(my), d = 4 * dpr;
        ctx.beginPath();
        ctx.moveTo(x - d, y - d);
        ctx.lineTo(x + d, y + d);
        ctx.moveTo(x + d, y - d);
        ctx.lineTo(x - d, y + d);
        ctx.stroke();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px, edgeIds, edgePoints, k, changes]);

  // 2) 장면마다 덧그리기
  useEffect(() => {
    const el = canvasRef.current;
    const base = baseRef.current;
    if (!el || !base || !px) return;
    el.width = px;
    el.height = px;
    const ctx = el.getContext("2d")!;
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(base, 0, 0);

    const style = ALGO_STYLE[algo];
    const color = resolveColor(style.color);
    const text = resolveColor("var(--text)");
    const surface = resolveColor("var(--surface)");
    const last = run.frames.length - 1;
    const f = frame < 0 ? null : run.frames[Math.min(frame, last)];
    const finished = f !== null && frame >= last;
    const node = (v: number): [number, number] => [tx(xy.out[2 * v]), ty(xy.out[2 * v + 1])];

    if (ghostPath?.length) strokeEdges(ctx, ghostPath, 3, resolveColor("var(--text-3)"), [5, 4]);

    if (f) {
      // 방문한 교차로
      const r = Math.max(1.6, Math.min(6, 90 / Math.sqrt(nodes))) * dpr;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1, r * 0.6);
      ctx.beginPath();
      for (let i = 0; i < f.visited; i++) {
        const [x, y] = node(run.order[i]);
        if (style.marker === "square") ctx.rect(x - r, y - r, 2 * r, 2 * r);
        else if (style.marker === "circle") {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        } else if (style.marker === "diamond") {
          const d = r * 1.35;
          ctx.moveTo(x, y - d);
          ctx.lineTo(x + d, y);
          ctx.lineTo(x, y + d);
          ctx.lineTo(x - d, y);
          ctx.closePath();
        } else if (style.marker === "triangle") {
          const d = r * 1.4;
          ctx.moveTo(x, y - d);
          ctx.lineTo(x + d, y + d * 0.8);
          ctx.lineTo(x - d, y + d * 0.8);
          ctx.closePath();
        }
      }
      if (style.marker === "cross") {
        ctx.beginPath();
        const d = r * 1.3;
        for (let i = 0; i < f.visited; i++) {
          const [x, y] = node(run.order[i]);
          ctx.moveTo(x - d, y);
          ctx.lineTo(x + d, y);
          ctx.moveTo(x, y - d);
          ctx.lineTo(x, y + d);
        }
        ctx.stroke();
      } else ctx.fill();
      ctx.globalAlpha = 1;

      if (!finished) {
        if (f.best >= 0) strokeEdges(ctx, run.bests[f.best], 2.5, resolveColor("var(--good)"), [3, 3]);
        strokeEdges(ctx, f.path, 3, color, style.dash);
        if (f.current >= 0) {
          const [x, y] = node(f.current);
          ctx.strokeStyle = text;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.arc(x, y, r + 3 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (run.status === "SUCCESS") {
        strokeEdges(ctx, run.pathEdges, 7, surface);
        strokeEdges(ctx, run.pathEdges, 4.5, text);
      }
    }

    // 출발 이름은 점 위에, 도착 이름은 점 아래에 써서 두 점이 가까워도 겹치지 않게 한다
    for (const [v, label, dy] of [[od.source, "출발", -10], [od.target, "도착", 20]] as const) {
      const [x, y] = node(v);
      ctx.fillStyle = text;
      ctx.strokeStyle = surface;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `700 ${12 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3 * dpr;
      ctx.strokeText(label, x, y + dy * dpr);
      ctx.fillText(label, x, y + dy * dpr);
    }

    if (finished && run.status === "TIMEOUT") {
      ctx.fillStyle = surface;
      ctx.globalAlpha = 0.82;
      ctx.fillRect(0, px / 2 - 34 * dpr, px, 68 * dpr);
      ctx.globalAlpha = 1;
      ctx.fillStyle = resolveColor("var(--algo-dfs)");
      ctx.font = `800 ${Math.min(30, size / 11) * dpr}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${timeLimitS}초 안에 못 끝남`, px / 2, px / 2);
      ctx.textBaseline = "alphabetic";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px, frame, run, od, algo, k, edgeIds, ghostPath, changes]);

  return <canvas ref={canvasRef} className="study-canvas" role="img" aria-label={`${algo} 탐색 과정 지도`} />;
}
