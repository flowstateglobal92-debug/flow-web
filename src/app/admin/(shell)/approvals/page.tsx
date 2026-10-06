import type { Metadata } from "next";
import { requireUser } from "@/lib/admin/auth";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { loadTeam } from "@/lib/admin/team";
import { PageHead } from "@/components/admin/ui";
import Approvals, { type ApprovalRequest, type ApprovalSettings } from "./Approvals";

export const metadata: Metadata = { title: "Approvals" };

const COLUMNS = "id, entity_type, entity_id, requested_by, amount, currency, summary, status, decided_by, decided_at, note, created_at";

/**
 * Open to every active user. RLS decides what each person sees: approvers
 * get every request in the workspace, everyone else only their own.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { supabase, profile } = await requireUser();
  const { open } = await searchParams;
  const approver = isApprover(profile);

  const [pending, decided, team, settings] = await Promise.all([
    supabase
      .from("approval_requests")
      .select(COLUMNS)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(200)
      .returns<ApprovalRequest[]>(),
    supabase
      .from("approval_requests")
      .select(COLUMNS)
      .neq("status", "pending")
      .order("decided_at", { ascending: false, nullsFirst: false })
      .limit(200)
      .returns<ApprovalRequest[]>(),
    loadTeam(supabase),
    supabase
      .from("workspaces")
      .select("expense_approval_threshold, invoice_approval_threshold, leave_requires_approval")
      .eq("id", profile.workspace)
      .maybeSingle<ApprovalSettings>(),
  ]);

  const all = [...(pending.data ?? []), ...(decided.data ?? [])];
  const openId = open && /^[0-9a-f-]{36}$/i.test(open) ? open : null;
  let openRequest = openId ? (all.find((r) => r.id === openId) ?? null) : null;
  if (openId && !openRequest) {
    const { data } = await supabase.from("approval_requests").select(COLUMNS).eq("id", openId).maybeSingle<ApprovalRequest>();
    openRequest = data ?? null;
  }

  return (
    <>
      <PageHead
        eyebrow={approver ? "Sign-off" : "Requests"}
        title="Approvals"
        hint={
          approver
            ? "Expenses, invoices and leave from members that need an admin's yes. The requester hears back either way."
            : "Big expenses, big invoices and leave go to an admin for sign-off. Follow yours here."
        }
      />
      <Approvals
        me={profile.id}
        approver={approver}
        ready={!pending.error}
        pending={pending.data ?? []}
        decided={decided.data ?? []}
        people={team}
        settings={settings.error ? null : (settings.data ?? null)}
        openRequest={openRequest}
        access={{
          finance: canAccess(profile, "finance"),
          invoices: canAccess(profile, "invoices"),
          calendar: canAccess(profile, "calendar"),
        }}
      />
    </>
  );
}
