import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { initialsOf } from "@/lib/admin/format";

/* ─────────────────────────── shared classes ─────────────────────────── */

/** Every input in the admin shares this shape, matching the public form. */
export const fieldClass =
  "w-full rounded-none border border-cream/10 bg-ink/60 px-3 py-2 text-[13px] text-cream placeholder:text-sand/55 transition-[border-color,box-shadow,background-color] duration-300 hover:border-cream/20 focus:border-terra/60 focus:bg-ink/80 focus:outline-none focus:ring-4 focus:ring-terra/15 disabled:opacity-50";

export const labelClass = "mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-sand";

/* ───────────────────────────── surfaces ─────────────────────────────── */

export function Panel({
  title,
  hint,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section
      className={`relative border border-cream/[0.08] bg-[linear-gradient(180deg,rgba(243,233,220,0.045),rgba(243,233,220,0.015))] shadow-[inset_0_1px_0_rgba(243,233,220,0.08),0_30px_70px_-40px_rgba(0,0,0,0.9)] ${className}`}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-cream/[0.07] px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="font-display text-[13.5px] font-medium text-cream">{title}</h2>}
            {hint && <p className="mt-0.5 text-[11.5px] text-sand">{hint}</p>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={bodyClass || "p-4"}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "terra" | "success" | "danger";
  icon?: ReactNode;
}) {
  const accent = {
    neutral: "text-cream",
    terra: "text-terra-bright",
    success: "text-emerald-300",
    danger: "text-rose-300",
  }[tone];
  return (
    <div className="group relative overflow-hidden border border-cream/[0.08] bg-[linear-gradient(180deg,rgba(243,233,220,0.05),rgba(243,233,220,0.015))] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(243,233,220,0.08)]">
      <div
        className="glow-terra pointer-events-none absolute -right-8 -top-10 h-24 w-24 opacity-0 transition-opacity duration-500 group-hover:opacity-40"
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-sand">{label}</p>
        {icon && <span className="text-sand/70">{icon}</span>}
      </div>
      <p className={`mt-2 font-display text-[22px] leading-none tabular-nums ${accent}`}>{value}</p>
      {sub && <p className="mt-1.5 text-[11.5px] text-sand">{sub}</p>}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-cream/[0.10] px-6 py-12 text-center">
      <p className="font-display text-[14px] text-cream">{title}</p>
      {hint && <p className="mt-1.5 max-w-sm text-[12px] text-sand">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ───────────────────────────── atoms ────────────────────────────────── */

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "terra" | "cream" | "success" | "warn" | "danger" | "muted";
  className?: string;
}) {
  const t = {
    neutral: "bg-cream/[0.06] text-cream-2 ring-cream/12",
    terra: "bg-terra/15 text-terra-bright ring-terra/30",
    cream: "bg-cream/12 text-cream ring-cream/25",
    success: "bg-emerald-400/10 text-emerald-200 ring-emerald-300/25",
    warn: "bg-amber-400/10 text-amber-200 ring-amber-300/25",
    danger: "bg-rose-400/10 text-rose-200 ring-rose-300/25",
    muted: "bg-cream/[0.03] text-sand ring-cream/10",
  }[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-none px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ${t} ${className}`}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const h = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 3;
  const bg = ["bg-terra/30", "bg-cream/15", "bg-terra-deep/50"][h];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-display text-[11px] font-medium text-cream ring-1 ring-cream/15 ${bg}`}
      style={{ width: size, height: size }}
    >
      {initialsOf(name)}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "quiet";
  size?: "sm" | "md";
};

export function Button({ variant = "ghost", size = "sm", className = "", children, ...rest }: ButtonProps) {
  // 36px tap targets on touch screens; the desktop size stays compact.
  const sizing = size === "sm" ? "px-3 py-1.5 text-[12px] pointer-coarse:min-h-9" : "px-4 py-2.5 text-[13px]";
  const looks = {
    primary: "btn btn--primary rounded-none",
    ghost:
      "border border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:bg-cream/[0.06] hover:text-cream",
    danger:
      "border border-rose-400/25 bg-rose-500/[0.07] text-rose-200 hover:border-rose-400/50 hover:bg-rose-500/[0.12]",
    quiet: "text-sand hover:text-cream",
  }[variant];
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-none font-medium transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${looks} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-sand/80">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`${fieldClass} ${className}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea {...rest} className={`${fieldClass} resize-none ${className}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <div className="relative">
      <select {...rest} className={`${fieldClass} appearance-none pr-9 ${className}`}>
        {children}
      </select>
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sand"
      >
        <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Page header used by every admin route. */
export function PageHead({
  eyebrow,
  title,
  hint,
  actions,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow text-[10px]">{eyebrow}</p>
        <h1 className="mt-1.5 font-display text-[26px] font-medium leading-tight text-cream">{title}</h1>
        {hint && <p className="mt-1.5 max-w-xl text-[12.5px] text-sand">{hint}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Square checkbox in the brand accent, with a label and optional hint. */
export function Checkbox({
  label,
  hint,
  className = "",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 ${className}`}>
      <input {...rest} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#c65d3b]" />
      <span className="min-w-0">
        <span className="block text-[12.5px] text-cream-2">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-sand/80">{hint}</span>}
      </span>
    </label>
  );
}

/** Stack of small avatars ("+2" after `max`). Names come from the team list. */
export function AvatarStack({ names, max = 3, size = 22 }: { names: string[]; max?: number; size?: number }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, max);
  return (
    <span className="inline-flex items-center" aria-label={names.join(", ")} title={names.join(", ")}>
      {shown.map((n, i) => (
        <span key={`${n}-${i}`} className={i ? "-ml-1.5" : ""}>
          <Avatar name={n} size={size} />
        </span>
      ))}
      {names.length > max && (
        <span className="ml-1 font-mono text-[10px] text-sand tabular-nums">+{names.length - max}</span>
      )}
    </span>
  );
}

/** A labelled setup notice, used when an integration or key is missing. */
export function Notice({
  tone = "warn",
  title,
  children,
}: {
  tone?: "warn" | "info" | "danger";
  title: string;
  children?: ReactNode;
}) {
  const t = {
    warn: "border-amber-300/25 bg-amber-400/[0.07] text-amber-100",
    info: "border-terra/30 bg-terra/[0.08] text-cream-2",
    danger: "border-rose-400/25 bg-rose-500/[0.08] text-rose-200",
  }[tone];
  return (
    <div className={`border px-3.5 py-3 text-[12.5px] ${t}`}>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1.5 opacity-85">{children}</div>}
    </div>
  );
}
