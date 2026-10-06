"use client";

import { useState } from "react";

export type StackSegment = { key: string; label: string; value: number; color: string };

/**
 * One horizontal bar split into parts (receivables by age). Parts are
 * separated by a 2px surface gap, never a border. The legend underneath
 * carries every value and share, so nothing hides behind hover; hovering or
 * focusing a part (or its legend row) lifts the pair together.
 */
export default function StackBar({
  segments,
  format,
  label,
}: {
  segments: StackSegment[];
  format: (value: number) => string;
  label: string;
}) {
  const [hot, setHot] = useState<string | null>(null);
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const shown = segments.filter((s) => s.value > 0);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  return (
    <div className="min-w-0">
      <div className="flex h-3 w-full gap-[2px] bg-transparent" role="img" aria-label={label}>
        {total === 0 ? (
          <span className="h-full w-full bg-cream/[0.06]" />
        ) : (
          shown.map((s) => (
            <span
              key={s.key}
              tabIndex={0}
              title={`${s.label}: ${format(s.value)}`}
              aria-label={`${s.label}: ${format(s.value)}, ${pct(s.value).toFixed(0)}%`}
              onPointerEnter={() => setHot(s.key)}
              onPointerLeave={() => setHot(null)}
              onFocus={() => setHot(s.key)}
              onBlur={() => setHot(null)}
              className={`h-full outline-none transition-opacity duration-200 ${hot && hot !== s.key ? "opacity-40" : ""}`}
              style={{ width: `${pct(s.value)}%`, minWidth: 3, background: s.color }}
            />
          ))
        )}
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {segments.map((s) => (
          <li
            key={s.key}
            onPointerEnter={() => setHot(s.key)}
            onPointerLeave={() => setHot(null)}
            className={`flex min-w-0 items-center gap-2 transition-opacity duration-200 ${hot && hot !== s.key ? "opacity-50" : ""}`}
          >
            <span className="h-2.5 w-2.5 shrink-0" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 truncate text-[11px] text-sand">{s.label}</span>
            <span className="ml-auto shrink-0 font-mono text-[11.5px] tabular-nums text-cream">{format(s.value)}</span>
            <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-sand">{pct(s.value).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
