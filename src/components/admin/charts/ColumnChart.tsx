"use client";

import { useState } from "react";
import { CHART } from "./palette";
import { columnPath, compact, niceTicks } from "./scale";
import { useWidth } from "./useWidth";

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
  type: "column" | "line";
  /** A 10% wash under a line, down to zero. */
  area?: boolean;
};

const TOP = 10;
const AXIS = 24;
const LEFT = 44;
const GAP = 2;

/**
 * Columns and lines on one money axis — hand-rolled SVG so it matches the
 * admin exactly. Thin columns (≤24px, 4px rounded data end, square on the
 * baseline), a 2px surface gap between neighbours, 2px lines, hairline grid.
 * Every x position is a hover/focus/tap target that shows all series at once;
 * the values are also in the table each report prints under its chart.
 *
 * `overlap` puts the columns in one slot — for inflow up / outflow down.
 */
export default function ColumnChart({
  labels,
  titles,
  series,
  format,
  label,
  height = 220,
  overlap = false,
  endLabel,
}: {
  /** Short x labels (`Oct`, `W3`). */
  labels: string[];
  /** Tooltip heading per x (`October 2026`, `14 – 20 Oct`). */
  titles: string[];
  series: ChartSeries[];
  /** Full amount for the tooltip (`Rs 1,250,000`). */
  format: (value: number) => string;
  /** What the chart shows, for screen readers. */
  label: string;
  height?: number;
  overlap?: boolean;
  /** Key of a line series whose last value is labelled at its end. */
  endLabel?: string;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const n = Math.max(labels.length, 1);
  const right = endLabel ? 52 : 10;
  const plotW = Math.max(width - LEFT - right, 40);
  const band = plotW / n;

  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const y = (v: number) => TOP + ((hi - v) / (hi - lo || 1)) * height;
  const zero = y(0);

  const columns = series.filter((s) => s.type === "column");
  const lines = series.filter((s) => s.type === "line");
  const slots = overlap ? 1 : Math.max(columns.length, 1);
  const inner = band * (overlap ? 0.56 : 0.72);
  const barW = Math.max(2, Math.min(24, (inner - GAP * (slots - 1)) / slots));
  const groupW = slots * barW + GAP * (slots - 1);
  const cx = (i: number) => LEFT + i * band + band / 2;
  const every = Math.max(1, Math.ceil(34 / band));

  const tipLeft = active === null ? 0 : cx(active) > width / 2 ? Math.max(0, cx(active) - 186) : Math.min(cx(active) + 14, width - 176);

  return (
    <div className="min-w-0">
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-sand">
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              {s.type === "line" ? (
                <span className="h-[2px] w-3.5 print:bg-neutral-800" style={{ background: s.color }} aria-hidden />
              ) : (
                <span className="h-2.5 w-2.5" style={{ background: s.color }} aria-hidden />
              )}
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {/* A finger lifting also fires pointerleave — touch readings stay up until focus moves on. */}
      <div
        ref={box}
        className="relative min-w-0 overflow-hidden"
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
      >
        {/* viewBox = measured width, so before the first measure it scales instead of overflowing */}
        <svg
          viewBox={`0 0 ${width} ${TOP + height + AXIS}`}
          role="group"
          aria-label={label}
          className="block h-auto w-full"
        >
          {/* grid */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={LEFT}
                x2={LEFT + plotW}
                y1={y(t)}
                y2={y(t)}
                strokeWidth={1}
                className={t === 0 ? "stroke-cream/25 print:stroke-neutral-500" : "stroke-cream/[0.07] print:stroke-neutral-200"}
              />
              <text
                x={LEFT - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-sand font-mono text-[10px] tabular-nums print:fill-neutral-600"
              >
                {compact(t)}
              </text>
            </g>
          ))}

          {/* active band */}
          {active !== null && (
            <rect x={LEFT + active * band} y={TOP} width={band} height={height} className="fill-cream/[0.04] print:hidden" />
          )}

          {/* columns */}
          {labels.map((_, i) => {
            const x0 = LEFT + i * band + (band - groupW) / 2;
            return columns.map((s, j) => {
              const v = s.values[i] ?? 0;
              const d = columnPath(overlap ? x0 : x0 + j * (barW + GAP), barW, zero, y(v));
              return d ? <path key={`${s.key}-${i}`} d={d} fill={s.color} /> : null;
            });
          })}

          {/* lines */}
          {lines.map((s) => {
            const pts = s.values.map((v, i) => [cx(i), y(v ?? 0)] as const);
            if (pts.length === 0) return null;
            const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join("");
            const last = pts[pts.length - 1];
            const isCream = s.color === CHART.line;
            return (
              <g key={s.key}>
                {s.area && (
                  <path d={`${d}L${last[0]},${zero}L${pts[0][0]},${zero}Z`} fill={s.color} opacity={0.1} className="print:hidden" />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className={isCream ? "print:stroke-neutral-800" : ""}
                />
                <circle cx={last[0]} cy={last[1]} r={4} fill={s.color} stroke={CHART.surface} strokeWidth={2} className={isCream ? "print:fill-neutral-800" : ""} />
                {active !== null && active !== pts.length - 1 && (
                  <circle cx={pts[active][0]} cy={pts[active][1]} r={4} fill={s.color} stroke={CHART.surface} strokeWidth={2} />
                )}
                {endLabel === s.key && (
                  <text x={last[0] + 8} y={last[1]} dy="0.32em" className="fill-cream font-mono text-[10.5px] tabular-nums print:fill-neutral-900">
                    {compact(s.values[s.values.length - 1] ?? 0)}
                  </text>
                )}
              </g>
            );
          })}

          {/* x axis — counted back from the latest point, which always gets its label */}
          {labels.map((l, i) =>
            (labels.length - 1 - i) % every === 0 ? (
              <text
                key={`x-${i}`}
                x={cx(i)}
                y={TOP + height + 16}
                textAnchor="middle"
                className="fill-sand text-[10px] print:fill-neutral-600"
              >
                {l}
              </text>
            ) : null,
          )}

          {/* hit targets — the whole band, not the painted pixels */}
          {labels.map((_, i) => (
            <rect
              key={`hit-${i}`}
              x={LEFT + i * band}
              y={TOP}
              width={band}
              height={height}
              fill="transparent"
              tabIndex={0}
              aria-label={`${titles[i]}: ${series.map((s) => `${s.label} ${format(s.values[i] ?? 0)}`).join(", ")}`}
              className="cursor-crosshair outline-none"
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>

        {active !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-[172px] border border-cream/15 bg-ink-2/95 px-3 py-2 shadow-[0_18px_40px_-18px_var(--shadow-strong)] print:hidden"
            style={{ left: tipLeft }}
          >
            <p className="mb-1.5 text-[10.5px] text-sand">{titles[active]}</p>
            <ul className="space-y-1">
              {series.map((s) => (
                <li key={s.key} className="flex items-center gap-2">
                  <span className="h-[2px] w-3 shrink-0" style={{ background: s.color }} aria-hidden />
                  <span className="font-mono text-[12px] tabular-nums text-cream">{format(s.values[active] ?? 0)}</span>
                  <span className="ml-auto truncate text-[10.5px] text-sand">{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
