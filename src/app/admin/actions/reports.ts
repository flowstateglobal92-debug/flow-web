"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/admin/auth";
import { todayISO } from "@/lib/admin/format";
import { isApprover } from "@/lib/admin/modules";
import { amount, fail, mustAffect, ok, text, type ActionResult } from "./shared";

/** The cash-flow forecast's starting point — cash in the bank on a given day (0022). */
export async function saveOpeningBalance(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("reports");
    if (!isApprover(profile)) throw new Error("Only admins can set the opening balance.");

    const day = text(formData, "opening_balance_on");
    const { data, error } = await supabase
      .from("workspaces")
      .update({
        opening_balance: amount(formData, "opening_balance"),
        opening_balance_on: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : todayISO(),
      })
      .eq("id", profile.workspace)
      .select("id");
    if (error) throw error;
    mustAffect(data);

    revalidatePath("/admin/reports/cashflow");
    return ok("Opening balance saved.");
  } catch (e) {
    return fail(e);
  }
}
