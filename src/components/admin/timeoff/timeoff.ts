/**
 * Time-off shapes and labels (0019), shared by the account panel, the
 * calendar, the feed and actions/timeoff.ts. No React, no server-only imports.
 */

export type TimeOffType = "annual" | "sick" | "wfh" | "travel" | "other";
export type TimeOffStatus = "pending" | "approved" | "rejected" | "cancelled";
export type HalfDay = "am" | "pm";

export type TimeOffRow = {
  id: string;
  user_id: string;
  type: TimeOffType;
  starts_on: string;
  ends_on: string;
  half_day: HalfDay | null;
  note: string | null;
  status: TimeOffStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export const TIME_OFF_COLUMNS =
  "id, user_id, type, starts_on, ends_on, half_day, note, status, decided_by, decided_at, created_at";

export const TIME_OFF_TYPES: TimeOffType[] = ["annual", "sick", "wfh", "travel", "other"];

export const TIME_OFF_LABEL: Record<TimeOffType, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  wfh: "Working from home",
  travel: "Travelling",
  other: "Away",
};

export const HALF_DAY_LABEL: Record<HalfDay, string> = { am: "Morning", pm: "Afternoon" };

export const STATUS_TONE: Record<TimeOffStatus, "success" | "warn" | "danger" | "muted"> = {
  approved: "success",
  pending: "warn",
  rejected: "danger",
  cancelled: "muted",
};

/** What the account panel loads: your own leave, plus the team when you may add it for others. */
export type TimeOffList = {
  ok: boolean;
  error?: string;
  items: TimeOffRow[];
  people: { id: string; full_name: string | null; email: string }[];
};

/** One request, as the calendar's detail modal shows it. */
export type TimeOffDetailData = {
  ok: boolean;
  error?: string;
  row: TimeOffRow | null;
  person: string | null;
  decider: string | null;
  canCancel: boolean;
  canDelete: boolean;
  isApprover: boolean;
};
