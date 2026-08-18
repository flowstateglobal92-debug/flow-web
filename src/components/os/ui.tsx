"use client";

import type { ReactNode, SVGProps } from "react";
import type { ModuleId } from "./OSContext";

/* ───────────── Icons (16/20px, stroke 1.6) ───────────── */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const Icon = {
  pipeline: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
      <rect x="16" y="4" width="5" height="7" rx="1.5" />
    </svg>
  ),
  inbox: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  ),
  automations: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 12h4l6-6M11 12l6 6" />
    </svg>
  ),
  finance: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <ellipse cx="9" cy="6" rx="6" ry="2.5" />
      <path d="M3 6v8c0 1.4 2.7 2.5 6 2.5M3 10c0 1.4 2.7 2.5 6 2.5" />
      <path d="M14 13h7M14 17h7M14 21h7" />
    </svg>
  ),
  copilot: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  ),
  bolt: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  check: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  ),
  arrow: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  send: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m3 11 18-8-8 18-2-8z" />
    </svg>
  ),
  play: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M7 5v14l11-7z" />
    </svg>
  ),
  clock: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  spark: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
    </svg>
  ),
  search: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </svg>
  ),
  bell: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 21h4" />
    </svg>
  ),
  doc: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </svg>
  ),
  calendar: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </svg>
  ),
  user: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  mic: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  ),
  drag: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="9" cy="6" r="1" fill="currentColor" />
      <circle cx="15" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
      <circle cx="9" cy="18" r="1" fill="currentColor" />
      <circle cx="15" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
};

export const MODULE_META: Record<ModuleId, { label: string; hint: string; icon: (p: IconProps) => ReactNode }> = {
  pipeline: { label: "Pipeline", hint: "Visual CRM · scoring", icon: Icon.pipeline },
  inbox: { label: "AI Inbox", hint: "WhatsApp sales rep", icon: Icon.inbox },
  automations: { label: "Automations", hint: "No-code playbooks", icon: Icon.automations },
  finance: { label: "Finance", hint: "Invoices · collection", icon: Icon.finance },
  copilot: { label: "Copilot", hint: "Ask the business", icon: Icon.copilot },
};

/* ───────────── Atoms ───────────── */
export type Score = "HOT" | "WARM" | "COLD";

export function ScoreBadge({ score, className = "" }: { score: Score; className?: string }) {
  const tone =
    score === "HOT"
      ? "bg-terra/20 text-terra-bright ring-terra/40"
      : score === "WARM"
        ? "bg-cream/10 text-cream ring-cream/25"
        : "bg-cream/5 text-sand ring-cream/15";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9.5px] font-medium tracking-[0.06em] ring-1 ${tone} ${className}`}
    >
      {score === "HOT" && <span className="pulse-dot h-1 w-1 shrink-0 rounded-full bg-terra-bright" />}
      {score}
    </span>
  );
}

export function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "terra" | "cream" | "success" | "warn";
  className?: string;
}) {
  const t = {
    neutral: "bg-cream/5 text-cream-2 ring-cream/10",
    terra: "bg-terra/15 text-terra-bright ring-terra/30",
    cream: "bg-cream/12 text-cream ring-cream/25",
    success: "bg-emerald-400/10 text-emerald-200 ring-emerald-300/25",
    warn: "bg-amber-400/10 text-amber-200 ring-amber-300/25",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${t} ${className}`}>
      {children}
    </span>
  );
}

export function Avatar({ name, size = 30, className = "" }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  // Deterministic hue offset so avatars vary but stay in the brand family.
  const h = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 3;
  const bg = ["bg-terra/30", "bg-cream/15", "bg-terra-deep/50"][h];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-display text-[11px] font-medium text-cream ring-1 ring-cream/15 ${bg} ${className}`}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}

export function KPI({
  label,
  value,
  delta,
  className = "",
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass-inset px-4 py-3 ${className}`}>
      <p className="text-[10px] uppercase tracking-[0.18em] text-sand">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="font-display text-xl text-cream tabular-nums">{value}</p>
        {delta && <span className="text-[11px] text-terra-bright">{delta}</span>}
      </div>
    </div>
  );
}

export function PanelTitle({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h4 className="font-display text-sm font-medium text-cream">{title}</h4>
        {hint && <p className="mt-0.5 text-[11.5px] text-sand">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

export function GhostButton({
  children,
  onClick,
  active,
  className = "",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-[12px] font-medium transition-all disabled:opacity-50 ${
        active
          ? "border-terra/50 bg-terra/15 text-terra-bright"
          : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  className = "",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`btn btn--primary btn--sm gap-1.5 disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}
