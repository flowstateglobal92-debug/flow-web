"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import type { FinanceKind } from "@/lib/admin/types";
import { amount, fail, ok, optional, text, type ActionResult } from "./shared";

function readEntry(formData: FormData) {
  const kind = (text(formData, "kind") || "expense") as FinanceKind;
  const value = Math.abs(amount(formData, "amount"));
  return {
    kind,
    entry_date: text(formData, "entry_date") || new Date().toISOString().slice(0, 10),
    description: text(formData, "description"),
    category: text(formData, "category") || "General",
    // Stored positive; the generated `signed_amount` column applies the sign,
    // so a month of expenses with no income sums to a negative profit.
    amount: value,
    method: optional(formData, "method"),
    reference: optional(formData, "reference"),
  };
}

export async function createEntry(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireAdmin();
    const entry = readEntry(formData);
    if (!entry.description) return { ok: false, error: "Describe the entry." };
    if (!(entry.amount > 0)) return { ok: false, error: "Amount must be greater than zero." };

    const { error } = await supabase.from("finance_entries").insert({ ...entry, created_by: user.id });
    if (error) throw error;

    revalidatePath("/admin/expenses");
    revalidatePath("/admin");
    return ok(entry.kind === "income" ? "Income recorded." : "Expense recorded.");
  } catch (e) {
    return fail(e);
  }
}

export async function updateEntry(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const entry = readEntry(formData);
    if (!entry.description) return { ok: false, error: "Describe the entry." };
    if (!(entry.amount > 0)) return { ok: false, error: "Amount must be greater than zero." };

    const { error } = await supabase.from("finance_entries").update(entry).eq("id", id);
    if (error) throw error;

    revalidatePath("/admin/expenses");
    revalidatePath("/admin");
    return ok("Entry updated.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEntry(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("finance_entries").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/expenses");
    revalidatePath("/admin");
    return ok("Entry deleted.");
  } catch (e) {
    return fail(e);
  }
}
