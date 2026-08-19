import type { ReactNode } from "react";
import Shell from "@/components/admin/Shell";
import { requireAdmin } from "@/lib/admin/auth";
import { MAILBOX_ADDRESS, RESEND_READY } from "@/lib/email/config";
import { unreadCount } from "@/lib/email/mailbox";

/** Admin data is per-request and per-user — never prerender or cache it. */
export const dynamic = "force-dynamic";

/** Everything inside this group is admin-only and rendered per request. */
export default async function AdminShellLayout({ children }: { children: ReactNode }) {
  const { supabase, profile, user } = await requireAdmin();

  const [{ count }, unreadMail] = await Promise.all([
    supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
    RESEND_READY ? unreadCount() : Promise.resolve(0),
  ]);

  return (
    <Shell
      name={profile.full_name ?? ""}
      email={profile.email || user.email || ""}
      newInquiries={count ?? 0}
      unreadMail={unreadMail}
      mailbox={MAILBOX_ADDRESS}
    >
      {children}
    </Shell>
  );
}
