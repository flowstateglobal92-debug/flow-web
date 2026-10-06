/**
 * Deep links — the one contract notifications, search, the activity log, the
 * ledger and the calendar all use to point at a record. Each page reads its
 * own parameter (`?lead=`, `?open=` …) and opens that record on load.
 *
 * SQL builds the same URLs inside triggers (0009+); keep them in step.
 */
export type LinkTarget =
  | "lead"
  | "client"
  | "invoice"
  | "quote"
  | "invoice_print"
  | "schedule"
  | "todo"
  | "event"
  | "time_off"
  | "approval"
  | "inquiry"
  | "entry"
  | "user";

export function hrefFor(type: LinkTarget | string, id: string | null | undefined): string | null {
  if (!id) return null;
  const q = encodeURIComponent(id);
  switch (type) {
    case "lead":
      return `/admin/crm?lead=${q}`;
    case "client":
      return `/admin/clients/${q}`;
    case "invoice":
    case "quote":
      return `/admin/invoices/${q}`;
    case "invoice_print":
      return `/admin/print/invoice/${q}`;
    case "schedule":
      return `/admin/invoices/recurring?open=${q}`;
    case "todo":
      return `/admin/todos?open=${q}`;
    case "event":
      return `/admin/calendar?event=${q}`;
    case "time_off":
      return `/admin/calendar?timeoff=${q}`;
    case "approval":
      return `/admin/approvals?open=${q}`;
    case "inquiry":
      return `/admin/inquiries?open=${q}`;
    case "entry":
      return `/admin/expenses?open=${q}`;
    case "user":
      return `/admin/team?user=${q}`;
    default:
      return null;
  }
}

/** "New …" entry points used by quick actions and cross-module buttons. */
export const NEW = {
  invoice: (opts: { lead?: string; client?: string } = {}) => withParams("/admin/invoices/new", opts),
  quote: (opts: { lead?: string; client?: string } = {}) => withParams("/admin/invoices/new", { kind: "quote", ...opts }),
  todo: () => "/admin/todos?new=1",
  event: () => "/admin/calendar?new=1",
  client: () => "/admin/clients?new=1",
  timeOff: () => "/admin/account#time-off",
  expense: () => "/admin/expenses?new=expense",
} as const;

function withParams(path: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
