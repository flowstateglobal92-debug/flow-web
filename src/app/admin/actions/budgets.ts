"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/admin/auth";
import { isApprover } from "@/lib/admin/modules";
import { amount, fail, mustAffect, ok, text, type ActionResult } from "./shared";

const PERIODS = ["monthly", "quarterly", "yearly"] as const;

function readBudget(formData: FormData) {
  const period = text(formData, "period");
  const alert = Math.round(amount(formData, "alert_percent") || 80);
  return {
    category: text(formData, "category").slice(0, 120),
    period: (PERIODS as readonly string[]).includes(period) ? period : "monthly",
    amount: Math.abs(amount(formData, "amount")),
    alert_percent: Math.min(100, Math.max(1, alert)),
    active: text(formData, "active") === "on",
  };
}

function refresh() {
  revalidatePath("/admin/expenses/budgets");
  revalidatePath("/admin/reports/cashflow");
  revalidatePath("/admin");
}

/** Everyone with Expenses sees budgets; only admins set them. */
async function authorizeBudgets() {
  const session = await authorize("finance");
  if (!isApprover(session.profile)) throw new Error("Only admins can change budgets.");
  return session;
}

const duplicate = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";

export async function saveBudget(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await authorizeBudgets();
    const budget = readBudget(formData);
    if (!budget.category) return { ok: false, error: "Pick a category." };
    if (!(budget.amount > 0)) return { ok: false, error: "The budget must be more than zero." };

    if (id) {
      const { data, error } = await supabase.from("budgets").update(budget).eq("id", id).select("id");
      if (error) throw error;
      mustAffect(data);
    } else {
      const { error } = await supabase.from("budgets").insert(budget);
      if (error) throw error;
    }

    refresh();
    return ok(id ? "Budget updated." : "Budget added.");
  } catch (e) {
    if (duplicate(e)) return { ok: false, error: "That category already has a budget for this period — edit it instead." };
    return fail(e);
  }
}

export async function deleteBudget(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorizeBudgets();
    const { data, error } = await supabase.from("budgets").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Budget removed.");
  } catch (e) {
    return fail(e);
  }
}
