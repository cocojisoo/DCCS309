"use client";

import { useState } from "react";

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

export interface BarRow {
  label: string;
  values: Record<string, number>;
  /** 값이 숫자가 아닐 때(NaN 등) 막대 대신 보여 줄 글 (예: "시간 초과") */
  notes?: Record<string, string>;
}

interface Props {
  title: string;
  subtitle?: string;
  series: BarSeries[];
  rows: BarRow[];
  format: (v: number) => string;
}

/** 가로 그룹 막대 차트. 행 = 알고리즘, 막대 = 시리즈(자동차/도보 등) */
export default function GroupedBarChart({ title, subtitle, series, rows, format }: Props) {
  const [hover, setHover] = useState<{ row: string; key: string } | null>(null);
  const max = Math.max(1e-9, ...rows.flatMap((r) => series.map((s) => r.values[s.key] ?? 0)).filter(Number.isFinite));

  return (
    <figure className="card" aria-label={title}>
      <figcaption className="mb-3">
        <div className="font-semibold">{title}</div>
        {subtitle && <div className="text-xs faint mt-0.5">{subtitle}</div>}
        <div className="flex flex-wrap gap-4 mt-2 text-xs muted" aria-hidden>
          {series.map((s) => (
            <span key={s.key}>
              <span className="swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </figcaption>
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[7.5rem_1fr] gap-3 items-center">
            <div className="text-sm muted truncate" title={row.label}>
              {row.label}
            </div>
            <div className="flex flex-col gap-[2px]">
              {series.map((s) => {
                const v = row.values[s.key];
                if (v === undefined) return null;
                const active = hover?.row === row.label && hover.key === s.key;
                const ok = Number.isFinite(v);
                const text = ok ? format(v) : (row.notes?.[s.key] ?? "—");
                return (
                  <div
                    key={s.key}
                    className="relative flex items-center gap-2 h-4 cursor-default"
                    onMouseEnter={() => setHover({ row: row.label, key: s.key })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="h-3 rounded-r-[4px] transition-[opacity]"
                        style={{
                          width: ok ? `max(2px, ${(v / max) * 100}%)` : "0",
                          background: s.color,
                          opacity: hover && !active ? 0.45 : 1,
                        }}
                      />
                    </div>
                    <span className={`w-[4.5rem] shrink-0 text-xs num ${ok ? "muted" : "badge-bad"}`}>{text}</span>
                    {active && (
                      <div
                        role="tooltip"
                        className="absolute z-10 left-0 -top-9 whitespace-nowrap rounded-md px-2 py-1 text-xs shadow-md"
                        style={{ background: "var(--text)", color: "var(--surface)" }}
                      >
                        {row.label} · {s.label}: <b>{text}</b>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
