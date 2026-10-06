import { addDays, fromLocalInput, toDateInput, toDateTimeInput } from "@/lib/admin/format";
import type { CalendarEvent, CalendarItem, CalendarItemKind } from "@/lib/admin/types";

/**
 * Plain helpers for the shared calendar — no React and no server-only imports,
 * so the feed (server), CalendarView and the To-dos page all use the same day
 * maths.
 *
 * Days are `YYYY-MM-DD` strings in Colombo time. Grid arithmetic runs on those
 * strings in UTC, so a page rendered on a UTC server and hydrated in a Colombo
 * browser lays out the same weeks.
 */

/* ──────────────────────────────── days ──────────────────────────────── */

/** The Colombo day an instant falls on. */
export const dayKey = (iso: string) => toDateInput(new Date(iso));

/** Local midnight of a day, as an ISO instant. */
export const dayStart = (day: string) => fromLocalInput(day) ?? `${day}T00:00:00.000Z`;

const utc = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`);

/** Monday = 0 … Sunday = 6. */
export const weekdayIndex = (day: string) => (utc(day).getUTCDay() + 6) % 7;

export const startOfWeek = (day: string) => addDays(day, -weekdayIndex(day));

export const weekOf = (day: string) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(day), i));

/** Six weeks starting on the Monday on or before the 1st. */
export function monthGrid(month: string) {
  const start = startOfWeek(`${month}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** What a month view asks the feed for: the whole grid, ±1 day for edge-of-day events. */
export function gridRange(month: string) {
  const days = monthGrid(month);
  return { from: dayStart(addDays(days[0], -1)), to: dayStart(addDays(days[41], 2)) };
}

export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

export const lastOfMonth = (month: string) => addDays(`${shiftMonth(month, 1)}-01`, -1);

export const isMonth = (v: string | null | undefined): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
/** `YYYY-MM-DD` that Date can read — 2026-13-01 would make the day maths throw. (A rollover like 02-30 reads as 2 Mar.) */
export const isDay = (v: string | null | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// Pure dates are formatted in UTC so the label never slides a day either way.
const monthFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const shortFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const longFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" });

export const monthLabel = (month: string) => monthFmt.format(utc(`${month}-01`));
/** `Tue 14 Oct` */
export const dayLabel = (day: string) => dayFmt.format(utc(day));
/** `14 Oct` */
export const dayShort = (day: string) => shortFmt.format(utc(day));
/** `14 Oct 2026` */
export const dayLong = (day: string) => longFmt.format(utc(day));
export const weekdayShort = (day: string) => weekdayFmt.format(utc(day));
export const dayNumber = (day: string) => utc(day).getUTCDate();

/** `14 Oct` or `14 – 18 Oct 2026` — the last day is inclusive. */
export function dayRangeLabel(from: string, to: string) {
  if (!to || to === from) return dayLong(from);
  return `${dayShort(from)} – ${dayLong(to)}`;
}

/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);

/**
 * Every day an item covers. All-day ranges are inclusive of the end day; a
 * timed event ending at exactly midnight doesn't spill into the next day.
 */
export function itemDays(item: Pick<CalendarItem, "starts_at" | "ends_at" | "all_day">) {
  const start = dayKey(item.starts_at);
  let end = item.ends_at ? dayKey(item.ends_at) : start;
  if (!item.all_day && item.ends_at && end > start && toDateTimeInput(new Date(item.ends_at)).endsWith("T00:00")) {
    end = addDays(end, -1);
  }
  if (end < start) end = start;
  const out: string[] = [];
  for (let d = start, n = 0; d <= end && n < 62; d = addDays(d, 1), n++) out.push(d);
  return out;
}

/** All-day first, then by start time, then title. */
export function sortItems(a: CalendarItem, b: CalendarItem) {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  if (a.starts_at !== b.starts_at) return a.starts_at < b.starts_at ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/* ─────────────────────────────── people ─────────────────────────────── */

/** The one display-name rule (lib/admin/format), under this module's old name. */
export { displayName as personName } from "@/lib/admin/format";

/* ─────────────────────────────── filters ────────────────────────────── */

/** The type toggles — invoice due dates and quote expiries share one. */
export type CalendarFilter = "event" | "todo" | "time_off" | "invoice" | "recurring";

export const FILTER_LABEL: Record<CalendarFilter, string> = {
  event: "Events",
  todo: "To-dos",
  time_off: "Time off",
  invoice: "Invoices",
  recurring: "Recurring",
};

export const filterOf = (kind: CalendarItemKind): CalendarFilter =>
  kind === "invoice_due" || kind === "quote_expiry" ? "invoice" : kind === "recurring_run" ? "recurring" : kind;

/** An undated, tagged to-do rides along in every feed response for the Unscheduled tray. */
export const UNSCHEDULED = "unscheduled";
export const isUnscheduled = (item: CalendarItem) => item.kind === "todo" && item.status === UNSCHEDULED;

/* ──────────────────────────────── tones ─────────────────────────────── */

const EVENT_TONE: Record<string, string> = {
  task: "border-cream/20 bg-cream/[0.06] text-cream-2",
  meeting: "border-terra/40 bg-terra/[0.14] text-terra-bright",
  follow_up: "border-amber-300/35 bg-amber-400/[0.10] text-amber-100",
  payment: "border-emerald-300/35 bg-emerald-400/[0.10] text-emerald-200",
  other: "border-cream/12 bg-cream/[0.04] text-sand",
};

const TODO_TONE: Record<string, string> = {
  urgent: "border-rose-300/40 bg-rose-400/[0.10] text-rose-100",
  high: "border-terra/35 bg-terra/[0.08] text-cream",
  normal: "border-cream/15 bg-ink-3 text-cream-2",
  low: "border-cream/10 bg-ink-3 text-sand",
};

/** Chip colours: events by type, to-dos by priority, money items by kind. */
export function chipTone(item: CalendarItem) {
  switch (item.kind) {
    case "event":
      return EVENT_TONE[item.tone] ?? EVENT_TONE.other;
    case "todo":
      return TODO_TONE[item.tone] ?? TODO_TONE.normal;
    case "invoice_due":
      return item.tone === "overdue"
        ? "border-rose-300/40 bg-rose-400/[0.08] text-rose-200"
        : "border-amber-300/30 bg-amber-400/[0.07] text-amber-100";
    case "quote_expiry":
      return "border-cream/12 bg-cream/[0.03] text-sand";
    case "recurring_run":
      return "border-emerald-300/25 bg-emerald-400/[0.06] text-emerald-200";
    default:
      return "border-cream/12 bg-cream/[0.04] text-cream-2";
  }
}

/** Approved leave is a solid hatched band; pending is a dashed outline. */
export const HATCH = {
  backgroundImage: "repeating-linear-gradient(135deg, rgba(243,233,220,0.10) 0 3px, transparent 3px 7px)",
} as const;

/* ─────────────────────────────── events ─────────────────────────────── */

/** A calendar event with the shared-calendar columns from 0011/0018. */
export type EventDetail = CalendarEvent & {
  location: string | null;
  meeting_url: string | null;
  client_id: string | null;
  created_by: string | null;
};

export type PickOption = { id: string; label: string };

/** What the event modal loads when it opens. */
export type EventFormData = {
  ok: boolean;
  error?: string;
  event: EventDetail | null;
  attendees: string[];
  leads: PickOption[];
  clients: PickOption[];
  canEdit: boolean;
  creator: string | null;
};
