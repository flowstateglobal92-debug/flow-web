/** Formatting helpers shared across the admin surface. */

/**
 * The business runs on Sri Lanka time. Every formatter pins it so a page
 * rendered on a UTC server and hydrated in a Colombo browser agree, and
 * "today" means the same day for everyone. SQL uses the same zone
 * (public.local_today()).
 */
export const APP_TIMEZONE = "Asia/Colombo";

/** ISO 4217 → the prefix shown in front of an amount. */
export const CURRENCY_SYMBOL: Record<string, string> = {
  LKR: "Rs",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AUD: "A$",
  INR: "₹",
  AED: "AED",
  SGD: "S$",
};

export const currencySymbol = (code: string | null | undefined) =>
  CURRENCY_SYMBOL[(code ?? "LKR").toUpperCase()] ?? (code ?? "LKR").toUpperCase();

const money0 = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `Rs 12,400` — negatives render as `−Rs 12,400`, which is how a loss should read. */
export function money(value: number, opts: { decimals?: boolean; currency?: string; code?: string } = {}) {
  const { decimals = false, code } = opts;
  const currency = code ? currencySymbol(code) : (opts.currency ?? "Rs");
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

const tz = { timeZone: APP_TIMEZONE } as const;
const dayFmt = new Intl.DateTimeFormat("en-GB", { ...tz, day: "2-digit", month: "short", year: "numeric" });
const shortFmt = new Intl.DateTimeFormat("en-GB", { ...tz, day: "2-digit", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { ...tz, hour: "2-digit", minute: "2-digit", hour12: false });
const isoDayFmt = new Intl.DateTimeFormat("en-CA", { ...tz, year: "numeric", month: "2-digit", day: "2-digit" });
const partsFmt = new Intl.DateTimeFormat("en-GB", {
  ...tz,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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

/** `2026-08-17` in Colombo time — what <input type="date"> expects. */
export function toDateInput(date: Date) {
  return isoDayFmt.format(date);
}

/** `2026-08-17T14:30` in Colombo time — what <input type="datetime-local"> expects. */
export function toDateTimeInput(date: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

/**
 * A `datetime-local` value typed in Colombo → ISO instant. Sri Lanka has no
 * DST, so the offset is a constant +05:30. Use this (in the browser or on the
 * server) instead of `new Date(value)`, which reads the *runtime's* zone.
 */
export function fromLocalInput(value: string | null | undefined) {
  if (!value) return null;
  const v = value.length === 10 ? `${value}T00:00` : value.slice(0, 16);
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Today's date in Colombo as `YYYY-MM-DD`. */
export const todayISO = () => toDateInput(new Date());

/** Whole days from today (Colombo) to a `YYYY-MM-DD` date; negative = past. */
export function daysFromToday(day: string) {
  const a = Date.parse(`${todayISO()}T00:00:00Z`);
  const b = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Add days to a `YYYY-MM-DD` string. */
export function addDays(day: string, days: number) {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] ?? "")
    .join("")
    .toUpperCase() || "?";

/** A teammate's name as shown everywhere — full name, else the start of their email. */
export const displayName = (m: { full_name: string | null; email: string } | null | undefined) =>
  m ? m.full_name || m.email.split("@")[0] : "Someone";
