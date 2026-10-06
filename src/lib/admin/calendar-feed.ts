import "server-only";

import type { Session } from "./auth";
import { addDays, todayISO } from "./format";
import { hrefFor } from "./links";
import { canAccess, isApprover } from "./modules";
import type { CalendarItem, CalendarItemKind, ShellProfile } from "./types";
import { dayKey, dayStart, UNSCHEDULED } from "@/components/admin/calendar/items";
import { TIME_OFF_COLUMNS, TIME_OFF_LABEL, type TimeOffRow } from "@/components/admin/timeoff/timeoff";

/**
 * Everything with a date that the viewer may see, merged into CalendarItems:
 * events, to-dos, time off, invoice due dates, quote expiries, recurring runs.
 * Each source is read under the viewer's RLS and only asked for when their
 * modules allow it, so a member without Invoices simply gets no invoice items.
 *
 * CONTRACT (the dashboard, the calendar page, the feed route, To-dos and
 * Workload call it):
 *   loadCalendarItems(supabase, profile, fromISO, toISO, { only? }) → CalendarItem[]
 *
 * Every source tolerates a missing table or column — a migration that hasn't
 * run yet reads as "nothing scheduled", never as a crash.
 *
 * Undated to-dos that tag someone ride along in every response with
 * `status: "unscheduled"` (and today's date, so naive consumers still get a
 * valid instant); CalendarView puts them in its Unscheduled tray.
 */

type Supabase = Session["supabase"];
type Result<T> = { data: T[] | null; error: unknown };

/** null = the query failed (usually: that migration isn't in yet). */
async function attempt<T>(query: PromiseLike<Result<T>>): Promise<T[] | null> {
  try {
    const { data, error } = await query;
    return error ? null : (data ?? []);
  } catch {
    return null;
  }
}

const rows = async <T>(query: PromiseLike<Result<T>>) => (await attempt(query)) ?? [];

const DAY_MS = 86_400_000;

export async function loadCalendarItems(
  supabase: Supabase,
  profile: ShellProfile,
  fromISO: string,
  toISO: string,
  opts: { only?: CalendarItemKind[] } = {},
): Promise<CalendarItem[]> {
  const want = (k: CalendarItemKind) => !opts.only || opts.only.includes(k);
  const can = (k: Parameters<typeof canAccess>[1]) => canAccess(profile, k);

  // Date columns compare against Colombo days; the window's end is exclusive.
  const range = {
    from: fromISO,
    to: toISO,
    firstDay: dayKey(fromISO),
    lastDay: dayKey(new Date(Date.parse(toISO) - 1).toISOString()),
  };

  const none = Promise.resolve([] as CalendarItem[]);
  const money = can("invoices");

  const parts = await Promise.all([
    want("event") && can("calendar") ? loadEvents(supabase, profile, range) : none,
    want("todo") && can("todos") ? loadTodos(supabase, profile, range) : none,
    want("time_off") ? loadTimeOff(supabase, profile, range) : none,
    money && (want("invoice_due") || want("quote_expiry")) ? loadInvoiceDates(supabase, range, want) : none,
    money && want("recurring_run") ? loadRecurring(supabase, range) : none,
  ]);

  return parts.flat().sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0));
}

type Range = { from: string; to: string; firstDay: string; lastDay: string };

/* ─────────────────────────────── events ─────────────────────────────── */

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  kind: string;
  done: boolean;
  created_by: string | null;
  calendar_event_attendees?: { user_id: string }[] | null;
};

async function loadEvents(supabase: Supabase, profile: ShellProfile, range: Range): Promise<CalendarItem[]> {
  // Multi-day events that began before the window still belong in it; look
  // back two months rather than writing an OR filter over two columns.
  const since = new Date(Date.parse(range.from) - 62 * DAY_MS).toISOString();
  const base = "id, title, starts_at, ends_at, all_day, kind, done, created_by";
  const select = (cols: string) =>
    supabase
      .from("calendar_events")
      .select(cols)
      .gte("starts_at", since)
      .lt("starts_at", range.to)
      .order("starts_at", { ascending: true })
      .limit(1500)
      .returns<EventRow[]>();

  // Attendees arrive with 0018; until then the plain columns still work.
  const list = (await attempt(select(`${base}, calendar_event_attendees(user_id)`))) ?? (await rows(select(base)));
  const from = Date.parse(range.from);
  const admin = isApprover(profile);

  return list
    .filter((e) => Date.parse(e.ends_at ?? e.starts_at) >= from || Date.parse(e.starts_at) >= from)
    .map((e) => ({
      key: `event:${e.id}`,
      kind: "event" as const,
      id: e.id,
      title: e.title,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      all_day: e.all_day,
      tone: e.kind,
      done: e.done,
      people: (e.calendar_event_attendees ?? []).map((a) => a.user_id),
      created_by: e.created_by,
      status: null,
      href: hrefFor("event", e.id),
      // Mirrors the 0018 policy: the creator or an admin edits; everyone else reads.
      editable: admin || (!!e.created_by && e.created_by === profile.id),
    }));
}

/* ─────────────────────────────── to-dos ─────────────────────────────── */

type TodoRow = {
  id: string;
  title: string;
  due_at: string | null;
  all_day: boolean;
  status: string;
  priority: string;
  created_by: string | null;
  todo_assignees: { user_id: string }[] | null;
};

const TODO_COLUMNS = "id, title, due_at, all_day, status, priority, created_by";

async function loadTodos(supabase: Supabase, profile: ShellProfile, range: Range): Promise<CalendarItem[]> {
  const [dated, undated] = await Promise.all([
    rows(
      supabase
        .from("todos")
        .select(`${TODO_COLUMNS}, todo_assignees(user_id)`)
        .gte("due_at", range.from)
        .lt("due_at", range.to)
        .order("due_at", { ascending: true })
        .limit(1500)
        .returns<TodoRow[]>(),
    ),
    // Tagged but undated — the Unscheduled tray. `!inner` keeps only to-dos with an assignee.
    rows(
      supabase
        .from("todos")
        .select(`${TODO_COLUMNS}, todo_assignees!inner(user_id)`)
        .is("due_at", null)
        .neq("status", "done")
        .order("created_at", { ascending: false })
        .limit(60)
        .returns<TodoRow[]>(),
    ),
  ]);

  const admin = isApprover(profile);
  const today = dayStart(todayISO());
  const toItem = (t: TodoRow, unscheduled: boolean): CalendarItem => {
    const people = (t.todo_assignees ?? []).map((a) => a.user_id);
    return {
      key: `todo:${t.id}`,
      kind: "todo",
      id: t.id,
      title: t.title,
      starts_at: unscheduled ? today : (t.due_at as string),
      ends_at: null,
      all_day: unscheduled || t.all_day,
      tone: t.priority,
      done: t.status === "done",
      people,
      created_by: t.created_by,
      status: unscheduled ? UNSCHEDULED : null,
      href: hrefFor("todo", t.id),
      editable: admin || t.created_by === profile.id || people.includes(profile.id),
    };
  };

  return [...dated.map((t) => toItem(t, false)), ...undated.map((t) => toItem(t, true))];
}

/* ────────────────────────────── time off ────────────────────────────── */

async function loadTimeOff(supabase: Supabase, profile: ShellProfile, range: Range): Promise<CalendarItem[]> {
  // Without Calendar or Workload you still see your own leave (the 0019 policy agrees).
  const everyone = canAccess(profile, "calendar") || canAccess(profile, "workload");
  let query = supabase
    .from("time_off")
    .select(TIME_OFF_COLUMNS)
    .in("status", ["approved", "pending"])
    .lte("starts_on", range.lastDay)
    .gte("ends_on", range.firstDay);
  if (!everyone) query = query.eq("user_id", profile.id);
  const list = await rows(query.order("starts_on", { ascending: true }).limit(600).returns<TimeOffRow[]>());
  if (list.length === 0) return [];

  const ids = [...new Set(list.map((t) => t.user_id))];
  const names = await rows(
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null; email: string }[]>(),
  );
  const nameOf = new Map(names.map((p) => [p.id, p.full_name || p.email.split("@")[0]]));

  return list.map((t) => ({
    key: `time_off:${t.id}`,
    kind: "time_off" as const,
    id: t.id,
    title: `${nameOf.get(t.user_id) ?? "Someone"} · ${TIME_OFF_LABEL[t.type] ?? "Away"}${
      t.half_day ? ` (${t.half_day.toUpperCase()})` : ""
    }`,
    // Both ends are local midnights of inclusive days.
    starts_at: dayStart(t.starts_on),
    ends_at: dayStart(t.ends_on),
    all_day: true,
    tone: t.type,
    done: false,
    people: [t.user_id],
    // The person who is out — that's whose "Mine" it is.
    created_by: t.user_id,
    status: t.status,
    href: hrefFor("time_off", t.id),
    editable: false,
  }));
}

/* ───────────────────────── invoices and quotes ──────────────────────── */

type DocRow = {
  id: string;
  number: string | null;
  status: string;
  due_date?: string | null;
  valid_until?: string | null;
  bill_to_name: string | null;
  bill_to_company: string | null;
  owner_id: string | null;
};

async function loadInvoiceDates(
  supabase: Supabase,
  range: Range,
  want: (k: CalendarItemKind) => boolean,
): Promise<CalendarItem[]> {
  const cols = "id, number, status, bill_to_name, bill_to_company, owner_id";
  const [due, quotes] = await Promise.all([
    want("invoice_due")
      ? rows(
          supabase
            .from("invoices")
            .select(`${cols}, due_date`)
            .eq("kind", "invoice")
            .in("status", ["issued", "partially_paid"])
            .gte("due_date", range.firstDay)
            .lte("due_date", range.lastDay)
            .limit(500)
            .returns<DocRow[]>(),
        )
      : Promise.resolve([] as DocRow[]),
    want("quote_expiry")
      ? rows(
          supabase
            .from("invoices")
            .select(`${cols}, valid_until`)
            .eq("kind", "quote")
            .eq("status", "sent")
            .gte("valid_until", range.firstDay)
            .lte("valid_until", range.lastDay)
            .limit(500)
            .returns<DocRow[]>(),
        )
      : Promise.resolve([] as DocRow[]),
  ]);

  const today = todayISO();
  const who = (d: DocRow) => d.bill_to_company || d.bill_to_name || "Client";
  const item = (d: DocRow, kind: "invoice_due" | "quote_expiry", day: string, title: string, tone: string) => ({
    key: `${kind}:${d.id}`,
    kind,
    id: d.id,
    title,
    starts_at: dayStart(day),
    ends_at: null,
    all_day: true,
    tone,
    done: false,
    people: d.owner_id ? [d.owner_id] : [],
    created_by: d.owner_id,
    status: d.status,
    href: hrefFor(kind === "quote_expiry" ? "quote" : "invoice", d.id),
    editable: false,
  });

  return [
    ...due
      .filter((d) => d.due_date)
      .map((d) =>
        item(d, "invoice_due", d.due_date as string, `Due · ${d.number ?? "Invoice"} · ${who(d)}`,
          (d.due_date as string) < today ? "overdue" : "due"),
      ),
    ...quotes
      .filter((d) => d.valid_until)
      .map((d) => item(d, "quote_expiry", d.valid_until as string, `Quote expires · ${d.number ?? "Quote"} · ${who(d)}`, "quote")),
  ];
}

/* ──────────────────────────── recurring runs ────────────────────────── */

type ScheduleRow = {
  id: string;
  name: string;
  is_retainer: boolean | null;
  frequency: string;
  interval_count: number | null;
  anchor_date: string;
  next_run_on: string;
  ends_on: string | null;
  max_occurrences: number | null;
  occurrences: number | null;
  owner_id: string | null;
};

async function loadRecurring(supabase: Supabase, range: Range): Promise<CalendarItem[]> {
  const list = await rows(
    supabase
      .from("invoice_schedules")
      .select(
        "id, name, is_retainer, frequency, interval_count, anchor_date, next_run_on, ends_on, max_occurrences, occurrences, owner_id",
      )
      .eq("active", true)
      .lte("next_run_on", range.lastDay)
      .limit(300)
      .returns<ScheduleRow[]>(),
  );

  return list.flatMap((s) =>
    projectRuns(s, range.firstDay, range.lastDay).map((day) => ({
      key: `recurring_run:${s.id}:${day}`,
      kind: "recurring_run" as const,
      id: s.id,
      title: `${s.is_retainer ? "Retainer" : "Recurring"} · ${s.name}`,
      starts_at: dayStart(day),
      ends_at: null,
      all_day: true,
      tone: s.is_retainer ? "retainer" : "recurring",
      done: false,
      people: s.owner_id ? [s.owner_id] : [],
      created_by: s.owner_id,
      status: null,
      href: hrefFor("schedule", s.id),
      editable: false,
    })),
  );
}

/** `day` plus n months, clamped to the month's end — the 31st never drifts (same rule as 0015). */
function addMonths(day: string, months: number) {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

const STEP_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };

function runOn(s: ScheduleRow, k: number) {
  const every = Math.max(1, s.interval_count ?? 1);
  return s.frequency === "weekly"
    ? addDays(s.anchor_date, 7 * every * k)
    : addMonths(s.anchor_date, (STEP_MONTHS[s.frequency] ?? 1) * every * k);
}

/** The schedule's next run plus the ones after it that land inside the window. */
function projectRuns(s: ScheduleRow, firstDay: string, lastDay: string) {
  const out: string[] = [];
  let k = 0;
  while (k < 2000 && runOn(s, k) <= s.next_run_on) k++;
  let left = s.max_occurrences ? Math.max(0, s.max_occurrences - (s.occurrences ?? 0)) : Infinity;
  for (let day = s.next_run_on; day <= lastDay && left > 0 && out.length < 60; day = runOn(s, k++)) {
    if (s.ends_on && day > s.ends_on) break;
    if (day >= firstDay) out.push(day);
    left--;
  }
  return out;
}
