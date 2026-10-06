import { addDays, formatTime, fromLocalInput } from "@/lib/admin/format";
import { dayKey, dayShort, daysBetween, weekdayIndex, weekdayShort } from "@/components/admin/calendar/items";

/**
 * To-do shapes (0020), labels and the pure helpers the list, board, drawer
 * and actions share. No React, no server-only imports.
 */

export type TodoStatus = "open" | "in_progress" | "done";
export type TodoPriority = "low" | "normal" | "high" | "urgent";
export type TodoKind = "task" | "reminder";
export type TodoRecurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";

export type ChecklistItem = { id: string; body: string; done: boolean; position: number };

export type Todo = {
  id: string;
  title: string;
  notes: string | null;
  kind: TodoKind;
  status: TodoStatus;
  priority: TodoPriority;
  due_at: string | null;
  all_day: boolean;
  remind_at: string | null;
  recurrence: TodoRecurrence;
  recurrence_until: string | null;
  labels: string[];
  is_private: boolean;
  lead_id: string | null;
  client_id: string | null;
  invoice_id: string | null;
  position: number;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  assignees: string[];
  checklist: ChecklistItem[];
};

/** What the page selects; embeds are flattened into `assignees` / `checklist`. */
export const TODO_SELECT =
  "id, title, notes, kind, status, priority, due_at, all_day, remind_at, recurrence, recurrence_until, labels, is_private, lead_id, client_id, invoice_id, position, completed_at, created_by, created_at, todo_assignees(user_id), todo_checklist(id, body, done, position)";

export type TodoRow = Omit<Todo, "assignees" | "checklist" | "labels"> & {
  labels: string[] | null;
  todo_assignees: { user_id: string }[] | null;
  todo_checklist: ChecklistItem[] | null;
};

export const toTodo = ({ todo_assignees, todo_checklist, labels, ...rest }: TodoRow): Todo => ({
  ...rest,
  labels: labels ?? [],
  assignees: (todo_assignees ?? []).map((a) => a.user_id),
  checklist: [...(todo_checklist ?? [])].sort((a, b) => a.position - b.position),
});

/** What the drawer and quick-add send to actions/todos.ts. */
export type TodoInput = {
  title: string;
  notes?: string | null;
  kind?: TodoKind;
  status?: TodoStatus;
  priority?: TodoPriority;
  /** ISO instant; for all-day to-dos, local midnight of the day. */
  due_at?: string | null;
  all_day?: boolean;
  remind_at?: string | null;
  recurrence?: TodoRecurrence;
  recurrence_until?: string | null;
  labels?: string[];
  is_private?: boolean;
  lead_id?: string | null;
  client_id?: string | null;
  invoice_id?: string | null;
  assignees?: string[];
};

export type LinkOption = { id: string; label: string };
export type TodoLinks = { leads: LinkOption[]; clients: LinkOption[]; invoices: LinkOption[] };

/** Approved or pending leave, for the "on leave that day" warning. */
export type LeaveSpan = {
  user_id: string;
  type: string;
  starts_on: string;
  ends_on: string;
  half_day: "am" | "pm" | null;
  status: string;
};

export const STATUS_LABEL: Record<TodoStatus, string> = { open: "Open", in_progress: "In progress", done: "Done" };
export const PRIORITY_LABEL: Record<TodoPriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const KIND_LABEL: Record<TodoKind, string> = { task: "Task", reminder: "Reminder" };
export const RECURRENCE_LABEL: Record<TodoRecurrence, string> = {
  none: "Doesn't repeat",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const STATUSES = Object.keys(STATUS_LABEL) as TodoStatus[];
export const PRIORITIES = Object.keys(PRIORITY_LABEL) as TodoPriority[];
export const RECURRENCES = Object.keys(RECURRENCE_LABEL) as TodoRecurrence[];

const PRIORITY_RANK: Record<TodoPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/* ─────────────────────────────── dates ──────────────────────────────── */

/** Has it slipped? All-day to-dos are late from the next day; timed ones from their time. */
export function isOverdue(t: Pick<Todo, "due_at" | "all_day" | "status">, today: string, now: number) {
  if (!t.due_at || t.status === "done") return false;
  return t.all_day ? dayKey(t.due_at) < today : Date.parse(t.due_at) < now;
}

/** `Today 14:00`, `Tomorrow`, `Fri`, `12 Nov` — Colombo days. */
export function dueLabel(t: Pick<Todo, "due_at" | "all_day">, today: string) {
  if (!t.due_at) return "No date";
  const day = dayKey(t.due_at);
  const diff = daysBetween(today, day);
  const d =
    diff === 0
      ? "Today"
      : diff === 1
        ? "Tomorrow"
        : diff === -1
          ? "Yesterday"
          : diff > 1 && diff < 7
            ? weekdayShort(day)
            : dayShort(day);
  return t.all_day ? d : `${d} ${formatTime(t.due_at)}`;
}

export type Group = "overdue" | "today" | "week" | "later" | "none" | "done";

export const GROUP_LABEL: Record<Group, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No date",
  done: "Done",
};

export const GROUPS = Object.keys(GROUP_LABEL) as Group[];

export function groupOf(t: Todo, today: string, now: number): Group {
  if (t.status === "done") return "done";
  if (!t.due_at) return "none";
  if (isOverdue(t, today, now)) return "overdue";
  const day = dayKey(t.due_at);
  if (day === today) return "today";
  // Through Sunday of the current week.
  return day <= addDays(today, 6 - weekdayIndex(today)) ? "week" : "later";
}

export function byDue(a: Todo, b: Todo) {
  if (a.due_at !== b.due_at) {
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return a.due_at < b.due_at ? -1 : 1;
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.created_at.localeCompare(b.created_at);
}

/** Board order: the saved position, newest first among equals. */
export const byPosition = (a: Todo, b: Todo) => a.position - b.position || b.created_at.localeCompare(a.created_at);

/** Local midnight for a day picked in a date input. */
export const dayInstant = (day: string) => fromLocalInput(day);

/* ───────────────────────────── reminders ────────────────────────────── */

export type ReminderPreset = "none" | "at_due" | "15m" | "1h" | "1d" | "custom";

export const REMINDER_LABEL: Record<ReminderPreset, { timed: string; allDay: string }> = {
  none: { timed: "No reminder", allDay: "No reminder" },
  at_due: { timed: "At the due time", allDay: "On the day, 09:00" },
  "15m": { timed: "15 minutes before", allDay: "" },
  "1h": { timed: "1 hour before", allDay: "" },
  "1d": { timed: "1 day before", allDay: "The day before, 09:00" },
  custom: { timed: "Custom…", allDay: "Custom…" },
};

/** When a preset fires, given the due day and (optional) time. */
export function reminderAt(preset: ReminderPreset, day: string, time: string, custom: string) {
  if (preset === "none") return null;
  if (preset === "custom") return fromLocalInput(custom);
  if (!day) return null;
  if (!time) {
    if (preset === "at_due") return fromLocalInput(`${day}T09:00`);
    if (preset === "1d") return fromLocalInput(`${addDays(day, -1)}T09:00`);
    return null;
  }
  const due = Date.parse(fromLocalInput(`${day}T${time}`) ?? "");
  if (!Number.isFinite(due)) return null;
  const minutes = { at_due: 0, "15m": 15, "1h": 60, "1d": 1440 }[preset];
  return new Date(due - minutes * 60_000).toISOString();
}

/** Which preset (if any) produced a stored reminder — so editing shows "1 hour before", not a raw time. */
export function presetFor(remindAt: string | null, day: string, time: string): ReminderPreset {
  if (!remindAt) return "none";
  const at = Date.parse(remindAt);
  for (const p of ["at_due", "15m", "1h", "1d"] as const) {
    const iso = reminderAt(p, day, time, "");
    if (iso && Date.parse(iso) === at) return p;
  }
  return "custom";
}

/* ─────────────────────────────── people ─────────────────────────────── */

/** Leave covering a day for one person, if any. */
export const leaveOn = (leave: LeaveSpan[], userId: string, day: string) =>
  leave.find((l) => l.user_id === userId && l.starts_on <= day && l.ends_on >= day) ?? null;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Drop "@Name" mentions from a quick-add title — they become assignees instead. */
export function stripMentions(text: string, names: string[]) {
  let out = text;
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (!name) continue;
    out = out.replace(new RegExp(`(^|\\s)@${escapeRe(name)}(?=$|[\\s,.;:!?])`, "gi"), "$1");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Ids of the people whose "@Name" appears in `text` — so quick-add tags work
 * from typed text as well as from the mention picker.
 */
export function findMentions(text: string, people: { id: string; name: string }[]) {
  if (!text.includes("@")) return [];
  return people
    .filter((p) => p.name && new RegExp(`(^|\\s)@${escapeRe(p.name)}(?=$|[\\s,.;:!?])`, "i").test(text))
    .map((p) => p.id);
}
