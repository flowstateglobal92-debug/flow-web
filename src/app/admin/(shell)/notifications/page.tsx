import type { Metadata } from "next";
import { requireUser } from "@/lib/admin/auth";
import { loadTeam } from "@/lib/admin/team";
import type { NotificationRow } from "@/lib/admin/types";
import { PageHead } from "@/components/admin/ui";
import { NOTIFICATION_COLUMNS } from "@/components/admin/notifications/columns";
import NotificationList from "./NotificationList";

export const metadata: Metadata = { title: "Notifications" };

const PAGE_SIZE = 25;

/**
 * Everything sent your way, newest first, a page at a time. Open to every
 * active member — RLS only ever returns your own delivered rows, so scheduled
 * reminders show up here once they're due.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  const { supabase } = await requireUser();
  const params = await searchParams;
  const filter = params.filter === "unread" ? "unread" : "all";
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS, { count: "exact" })
    .order("deliver_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (filter === "unread") query = query.is("read_at", null);

  const [list, people] = await Promise.all([query.returns<NotificationRow[]>(), loadTeam(supabase)]);

  // Past the last page (or a missing table) just reads as empty.
  const total = list.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHead
        eyebrow="Inbox · Alerts"
        title="Notifications"
        hint="Mentions, assignments, reminders, payments and approvals sent your way. Reminders appear once they're due."
      />
      <NotificationList
        items={list.data ?? []}
        people={people}
        filter={filter}
        page={Math.min(page, pages)}
        pages={pages}
        total={total}
        beyond={page > pages}
      />
    </>
  );
}
