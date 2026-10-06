import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { loadCalendarItems } from "@/lib/admin/calendar-feed";
import { todayISO } from "@/lib/admin/format";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { loadTeam } from "@/lib/admin/team";
import type { CalendarItemKind } from "@/lib/admin/types";
import { PageHead } from "@/components/admin/ui";
import CalendarView from "@/components/admin/calendar/CalendarView";
import { dayKey, gridRange, isMonth } from "@/components/admin/calendar/items";
import TimeOffButton from "@/components/admin/timeoff/TimeOffButton";

export const metadata: Metadata = { title: "Calendar" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The shared team calendar. Deep links: ?event=<id> opens that event,
 * ?timeoff=<id> that leave entry (each on the month it falls in), ?new=1 the
 * new-event dialog, ?month=YYYY-MM a month.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; event?: string; timeoff?: string; new?: string }>;
}) {
  const { supabase, profile } = await requireModule("calendar");
  const params = await searchParams;
  const eventId = params.event && UUID.test(params.event) ? params.event : null;
  const timeOffId = params.timeoff && UUID.test(params.timeoff) ? params.timeoff : null;

  // A deep-linked record decides the month, so its chip is on screen behind the dialog.
  let month = isMonth(params.month) ? params.month : todayISO().slice(0, 7);
  if (eventId) {
    const { data } = await supabase
      .from("calendar_events")
      .select("starts_at")
      .eq("id", eventId)
      .maybeSingle<{ starts_at: string }>();
    if (data) month = dayKey(data.starts_at).slice(0, 7);
  } else if (timeOffId) {
    const { data, error } = await supabase
      .from("time_off")
      .select("starts_on")
      .eq("id", timeOffId)
      .maybeSingle<{ starts_on: string }>();
    if (!error && data) month = data.starts_on.slice(0, 7);
  }

  const { from, to } = gridRange(month);
  const [items, team] = await Promise.all([loadCalendarItems(supabase, profile, from, to), loadTeam(supabase)]);

  // Type toggles only for what this person can actually see.
  const only: CalendarItemKind[] = [
    "event",
    ...(canAccess(profile, "todos") ? (["todo"] as const) : []),
    "time_off",
    ...(canAccess(profile, "invoices") ? (["invoice_due", "quote_expiry", "recurring_run"] as const) : []),
  ];
  const admin = isApprover(profile);

  return (
    <>
      <PageHead
        eyebrow="Team"
        title="Calendar"
        hint="Everyone's events, leave and dated to-dos in one place — plus invoice due dates when you handle money."
        actions={
          <TimeOffButton
            me={profile.id}
            people={admin ? team.map((m) => ({ id: m.id, full_name: m.full_name, email: m.email })) : undefined}
          />
        }
      />
      <CalendarView
        initialItems={items}
        initialMonth={month}
        people={team}
        only={only}
        me={profile.id}
        openEventId={eventId}
        openTimeOffId={timeOffId}
        openNew={params.new === "1"}
      />
    </>
  );
}
