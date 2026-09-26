"use client";

import { useState } from "react";

export interface LogPoint {
  x: number;
  y: number;
  /** ✕ 로 표시 (예: 시간 초과가 난 크기) */
  cross?: boolean;
  label: string;
}

export interface LogSeries {
  id: string;
  label: string;
  color: string;
  dash?: string;
  points: LogPoint[];
}

interface Props {
  title: string;
  subtitle?: string;
  xLabel: string;
  yLabel: string;
  series: LogSeries[];
  formatY: (v: number) => string;
  /** 가로 기준선 (예: 제한시간) */
  refLine?: { y: number; label: string };
}

const W = 720;
const H = 360;
const M = { l: 62, r: 16, t: 16, b: 44 };

const decades = (lo: number, hi: number) => {
  const out: number[] = [];
  for (let p = Math.floor(Math.log10(lo)); p <= Math.ceil(Math.log10(hi)); p++) out.push(10 ** p);
  return out;
};

/** 가로·세로 모두 로그 눈금인 선 그래프 */
export default function LogChart({ title, subtitle, xLabel, yLabel, series, formatY, refLine }: Props) {
  const [hover, setHover] = useState<{ s: LogSeries; p: LogPoint } | null>(null);
  const all = series.flatMap((s) => s.points).filter((p) => p.x > 0 && p.y > 0);
  if (!all.length) return null;
  const ys = all.map((p) => p.y).concat(refLine ? [refLine.y] : []);
  const xTicks = decades(Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x)));
  const yTicks = decades(Math.min(...ys), Math.max(...ys));
  const [x0, x1] = [Math.log10(xTicks[0]), Math.log10(xTicks.at(-1)!)];
  const [y0, y1] = [Math.log10(yTicks[0]), Math.log10(yTicks.at(-1)!)];
  const sx = (x: number) => M.l + ((Math.log10(x) - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((Math.log10(y) - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);

  return (
    <figure className="card" aria-label={title}>
      <figcaption className="mb-2">
        <div className="font-semibold">{title}</div>
        {subtitle && <div className="text-xs faint mt-0.5">{subtitle}</div>}
        <div className="flex flex-wrap gap-4 mt-2 text-xs muted">
          {series.map((s) => (
            <span key={s.id}>
              <svg width="26" height="10" className="inline-block mr-1 align-middle" aria-hidden>
                <line x1="1" y1="5" x2="25" y2="5" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} />
              </svg>
              {s.label}
            </span>
          ))}
          <span>✕ = 시간 초과가 난 크기 (값은 제한시간에 묶임)</span>
        </div>
      </figcaption>
      <div className="h-5 text-xs num muted">{hover ? `${hover.s.label} · ${hover.p.label}` : ""}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${title}: ${xLabel} 대비 ${yLabel}`}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} stroke="var(--border)" />
            <text x={M.l - 6} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">
              {formatY(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={M.t} y2={H - M.b} stroke="var(--border)" />
            <text x={sx(t)} y={H - M.b + 16} textAnchor="middle" fontSize="11" fill="var(--text-3)">
              {t.toLocaleString("ko-KR")}
            </text>
          </g>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--text-2)">
          {xLabel}
        </text>
        <text x={14} y={(M.t + H - M.b) / 2} textAnchor="middle" fontSize="12" fill="var(--text-2)" transform={`rotate(-90 14 ${(M.t + H - M.b) / 2})`}>
          {yLabel}
        </text>
        {refLine && (
          <g>
            <line x1={M.l} x2={W - M.r} y1={sy(refLine.y)} y2={sy(refLine.y)} stroke="var(--bad)" strokeDasharray="5 4" />
            <text x={M.l + 6} y={sy(refLine.y) - 6} textAnchor="start" fontSize="11" fill="var(--bad)">
              {refLine.label}
            </text>
          </g>
        )}
        {series.map((s) => {
          const pts = s.points.filter((p) => p.x > 0 && p.y > 0).sort((a, b) => a.x - b.x);
          return (
            <g key={s.id}>
              <polyline
                points={pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth="2.5"
                strokeDasharray={s.dash}
                strokeLinejoin="round"
              />
              {pts.map((p, i) => {
                const cx = sx(p.x);
                const cy = sy(p.y);
                const active = hover?.p === p;
                return (
                  <g key={i} onMouseEnter={() => setHover({ s, p })} onMouseLeave={() => setHover(null)}>
                    <circle cx={cx} cy={cy} r={10} fill="transparent" />
                    {p.cross ? (
                      <path d={`M${cx - 6},${cy - 6}L${cx + 6},${cy + 6}M${cx + 6},${cy - 6}L${cx - 6},${cy + 6}`} stroke={s.color} strokeWidth={active ? 4 : 3} />
                    ) : (
                      <circle cx={cx} cy={cy} r={active ? 6 : 4} fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
