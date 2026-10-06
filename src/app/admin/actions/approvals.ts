"use server";

import { revalidatePath } from "next/cache";
import { authorizeUser } from "@/lib/admin/auth";
import { isApprover } from "@/lib/admin/modules";
import { amount, fail, mustAffect, ok, text, type ActionResult } from "./shared";

function refresh() {
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/expenses");
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
}

/**
 * Approve or reject one request. `decide_approval` (0016) re-checks that the
 * caller is an approver in the same workspace and isn't the requester, then
 * flips the expense / invoice / leave and tells the requester.
 */
export async function decideApproval(id: string, decision: "approve" | "reject", note: string): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeUser();
    if (!isApprover(profile)) throw new Error("Only admins can approve requests.");
    if (decision !== "approve" && decision !== "reject") throw new Error("Pick approve or reject.");
    const trimmed = note.trim().slice(0, 1000);

    const { error } = await supabase.rpc("decide_approval", {
      p_id: id,
      p_decision: decision,
      p_note: trimmed || null,
    });
    if (error) throw error;

    refresh();
    return ok(decision === "approve" ? "Approved." : "Rejected — they've been told why.", id);
  } catch (e) {
    return fail(e);
  }
}

/** Thresholds live on the caller's own workspace row; RLS limits the update to admins. */
export async function saveApprovalSettings(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeUser();
    if (!isApprover(profile)) throw new Error("Only admins can change approval rules.");

    const expense = amount(formData, "expense_approval_threshold");
    const invoice = amount(formData, "invoice_approval_threshold");
    if (expense < 0 || invoice < 0) return { ok: false, error: "Thresholds can't be negative." };

    const { data, error } = await supabase
      .from("workspaces")
      .update({
        expense_approval_threshold: expense,
        invoice_approval_threshold: invoice,
        leave_requires_approval: text(formData, "leave_requires_approval") === "on",
      })
      .eq("id", profile.workspace)
      .select("id");
    if (error) throw error;
    mustAffect(data);

    refresh();
    return ok("Approval rules saved.");
  } catch (e) {
    return fail(e);
  }
}
