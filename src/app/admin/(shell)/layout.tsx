import type { ReactNode } from "react";
import Shell from "@/components/admin/Shell";
import { requireAdmin } from "@/lib/admin/auth";

/** Admin data is per-request and per-user — never prerender or cache it. */
export const dynamic = "force-dynamic";

/** Everything inside this group is admin-only and rendered per request. */
export default async function AdminShellLayout({ children }: { children: ReactNode }) {
  const { supabase, profile, user } = await requireAdmin();

  const { count } = await supabase
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");

  return (
    <Shell
      name={profile.full_name ?? ""}
      email={profile.email || user.email || ""}
      newInquiries={count ?? 0}
    >
      {children}
    </Shell>
  );
}
