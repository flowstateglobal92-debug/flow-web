import type { ReactNode } from "react";
import Shell from "@/components/admin/Shell";
import { requireUser } from "@/lib/admin/auth";
import { canAccess, isApprover } from "@/lib/admin/modules";
import type { NotificationRow } from "@/lib/admin/types";
import { addDays, todayISO } from "@/lib/admin/format";
import { MAILBOX_ADDRESS, RESEND_READY } from "@/lib/email/config";
import { unreadCount } from "@/lib/email/mailbox";

/** Admin data is per-request and per-user — never prerender or cache it. */
export const dynamic = "force-dynamic";

const NOTIFICATION_COLUMNS =
  "id, type, title, body, link, actor_id, entity_type, entity_id, deliver_at, read_at, created_at";

/**
 * Everything inside this group needs an active team account. Each page then
 * checks its own module (layouts don't re-run on client navigation, so they
 * are never the only gate). Badge queries only run for modules the person
 * can open — the demo account never touches the real mailbox.
 */
export default async function AdminShellLayout({ children }: { children: ReactNode }) {
  const { supabase, profile } = await requireUser();

  const can = (k: Parameters<typeof canAccess>[1]) => canAccess(profile, k);
  const endOfToday = `${addDays(todayISO(), 1)}T00:00:00+05:30`;
  const zero = Promise.resolve({ count: 0 });

  const [inquiries, mail, todos, approvals, unread, latest] = await Promise.all([
    can("inquiries")
      ? supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new")
      : zero,
    can("email") && RESEND_READY ? unreadCount() : Promise.resolve(0),
    can("todos")
      ? supabase
          .from("todos")
          .select("id, todo_assignees!inner(user_id)", { count: "exact", head: true })
          .eq("todo_assignees.user_id", profile.id)
          .neq("status", "done")
          .lt("due_at", endOfToday)
      : zero,
    isApprover(profile)
      ? supabase
          .from("approval_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
          // A request whose requester was deleted still needs deciding (neq drops nulls).
          .or(`requested_by.is.null,requested_by.neq.${profile.id}`)
      : zero,
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase
      .from("notifications")
      .select(NOTIFICATION_COLUMNS)
      .order("deliver_at", { ascending: false })
      .limit(20)
      .returns<NotificationRow[]>(),
  ]);

  // A feature whose migration hasn't run yet just reads as zero.
  const n = (r: { count?: number | null }) => r.count ?? 0;

  return (
    <Shell
      profile={{
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
        permissions: profile.permissions,
        workspace: profile.workspace,
        is_active: profile.is_active,
        title: profile.title,
      }}
      counts={{ inquiries: n(inquiries), mail, todos: n(todos), approvals: n(approvals) }}
      mailbox={can("email") ? MAILBOX_ADDRESS : ""}
      notifications={{ unread: n(unread), items: latest.data ?? [] }}
    >
      {children}
    </Shell>
  );
}
