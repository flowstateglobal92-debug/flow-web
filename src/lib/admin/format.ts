/** Formatting helpers shared across the admin surface. */

const money0 = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `Rs 12,400` — negatives render as `−Rs 12,400`, which is how a loss should read. */
export function money(value: number, opts: { decimals?: boolean; currency?: string } = {}) {
  const { decimals = false, currency = "Rs" } = opts;
  const fmt = decimals ? money2 : money0;
  const sign = value < 0 ? "−" : "";
  return `${sign}${currency} ${fmt.format(Math.abs(value))}`;
}

/** Compact form for KPI tiles: `Rs 1.2M`, `Rs 340k`. */
export function moneyShort(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}Rs ${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}Rs ${Math.round(abs / 1000)}k`;
  return money(value);
}

export const num = (value: unknown, fallback = 0) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export const formatDate = (iso: string) => dayFmt.format(new Date(iso));
export const formatDateShort = (iso: string) => shortFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => `${dayFmt.format(new Date(iso))} · ${timeFmt.format(new Date(iso))}`;

/** `4m ago`, `3h ago`, `2d ago`, then the date. */
export function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return shortFmt.format(new Date(iso));
}

/** `2026-08-17` in local time — what <input type="date"> expects. */
export function toDateInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `2026-08-17T14:30` — what <input type="datetime-local"> expects. */
export function toDateTimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] ?? "")
    .join("")
    .toUpperCase() || "?";
