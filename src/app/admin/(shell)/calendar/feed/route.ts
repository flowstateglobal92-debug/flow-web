import { authorizeUser } from "@/lib/admin/auth";
import { loadCalendarItems } from "@/lib/admin/calendar-feed";
import type { CalendarItemKind } from "@/lib/admin/types";

/** Per-user, per-request — never cache a calendar. */
export const dynamic = "force-dynamic";

const KINDS: CalendarItemKind[] = ["event", "todo", "time_off", "invoice_due", "quote_expiry", "recurring_run"];

/** A month grid is 44 days; anything much wider is not a calendar asking. */
const MAX_SPAN_MS = 100 * 86_400_000;

/**
 * GET /admin/calendar/feed?from=<ISO>&to=<ISO>[&only=todo,event]
 *
 * What CalendarView fetches when the month changes, so paging the dashboard
 * widget or the To-dos calendar never re-runs the whole page. Any active team
 * member may ask; each source inside loadCalendarItems checks its own module
 * and RLS filters the rows underneath.
 */
export async function GET(request: Request) {
  let session;
  try {
    session = await authorizeUser();
  } catch {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const from = Date.parse(params.get("from") ?? "");
  const to = Date.parse(params.get("to") ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_SPAN_MS) {
    return Response.json({ error: "Pass a from/to range of up to 100 days." }, { status: 400 });
  }

  const only = (params.get("only") ?? "")
    .split(",")
    .filter((k): k is CalendarItemKind => (KINDS as string[]).includes(k));

  const items = await loadCalendarItems(
    session.supabase,
    session.profile,
    new Date(from).toISOString(),
    new Date(to).toISOString(),
    only.length ? { only } : {},
  );

  return Response.json(items, { headers: { "Cache-Control": "private, no-store" } });
}
