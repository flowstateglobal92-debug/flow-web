"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/admin/auth";
import { num } from "@/lib/admin/format";
import { round2, round3 } from "@/lib/admin/invoice-math";
import { fail, mustAffect, ok, type ActionResult } from "./shared";

/**
 * Suppliers, bills, bill payments and recurring bills (0040) — the Expenses
 * module's. The database keeps totals and status, posts each payment to the
 * ledger as an expense, and raises recurring bills; these actions check the
 * input and say what's wrong in a sentence.
 */

function refresh() {
  revalidatePath("/admin/expenses", "layout");
  revalidatePath("/admin/reports", "layout");
  revalidatePath("/admin");
}

const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const clean = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

/* ──────────────────────────────── suppliers ──────────────────────────────── */

export type SupplierInput = {
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  tax_id?: string | null;
  default_category?: string | null;
  notes?: string | null;
};

export async function saveSupplier(id: string | null, input: SupplierInput): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const name = (input.name ?? "").trim();
    if (!name) return { ok: false, error: "Name the supplier." };
    const email = clean(input.email, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: `"${email}" isn't an email address.` };
    const row = {
      name: name.slice(0, 200),
      contact_name: clean(input.contact_name, 200),
      email,
      phone: clean(input.phone, 60),
      address: clean(input.address, 500),
      tax_id: clean(input.tax_id, 40),
      default_category: clean(input.default_category, 80),
      notes: clean(input.notes, 4000),
    };
    if (id) {
      const { data, error } = await supabase.from("suppliers").update(row).eq("id", id).select("id");
      if (error) throw error;
      mustAffect(data);
      refresh();
      return ok("Supplier saved.", id);
    }
    const { data, error } = await supabase.from("suppliers").insert(row).select("id").single<{ id: string }>();
    if (error) throw error;
    refresh();
    return ok(`${name} added.`, data.id);
  } catch (e) {
    return fail(e);
  }
}

export async function setSupplierActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase.from("suppliers").update({ active }).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(active ? "Supplier restored." : "Supplier archived — their bills stay.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSupplier(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase.from("suppliers").delete().eq("id", id).select("id");
    if (error) {
      if ((error as { code?: string }).code === "23503") return { ok: false, error: "They have bills — archive the supplier instead." };
      throw error;
    }
    mustAffect(data);
    refresh();
    return ok("Supplier deleted.");
  } catch (e) {
    return fail(e);
  }
}

/* ────────────────────────────────── bills ────────────────────────────────── */

export type BillTax = { name: string; rate?: number | string | null; amount: number | string };

export type BillInput = {
  supplier_id: string;
  reference?: string | null;
  bill_date: string;
  due_date?: string | null;
  currency: string;
  exchange_rate?: number | string | null;
  description?: string | null;
  category: string;
  subtotal: number | string;
  taxes: BillTax[];
  notes?: string | null;
  draft?: boolean;
};

function readTaxes(taxes: BillTax[]) {
  const out: { name: string; rate: number | null; amount: number }[] = [];
  for (const t of taxes ?? []) {
    const name = (t.name ?? "").trim();
    if (!name && !num(t.amount)) continue;
    if (!name) throw new Error("Each tax needs a name.");
    const amount = round2(num(t.amount));
    if (amount < 0) throw new Error("Tax amounts can't be negative.");
    const rate = t.rate == null || String(t.rate).trim() === "" ? null : round3(num(t.rate));
    out.push({ name: name.slice(0, 40), rate, amount });
  }
  if (out.length > 4) throw new Error("Four taxes at most.");
  return out;
}

export async function saveBill(id: string | null, input: BillInput): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    if (!input.supplier_id) return { ok: false, error: "Pick the supplier." };
    const billDate = day(input.bill_date);
    if (!billDate) return { ok: false, error: "Pick the bill's date." };
    const due = day(input.due_date);
    if (due && due < billDate) return { ok: false, error: "The due date is before the bill's date." };
    const subtotal = round2(num(input.subtotal));
    if (!(subtotal >= 0)) return { ok: false, error: "Enter the amount before tax." };
    const currency = (input.currency || "LKR").toUpperCase();
    const rate = currency === "LKR" || input.exchange_rate == null || String(input.exchange_rate).trim() === "" ? null : num(input.exchange_rate);
    if (rate != null && !(rate > 0)) return { ok: false, error: "The exchange rate must be more than zero." };
    const category = (input.category ?? "").trim();
    if (!category) return { ok: false, error: "Pick a category — payments land in the ledger under it." };
    const row = {
      supplier_id: input.supplier_id,
      reference: clean(input.reference, 80),
      bill_date: billDate,
      due_date: due,
      currency,
      exchange_rate: rate,
      description: clean(input.description, 500),
      category: category.slice(0, 80),
      subtotal,
      tax_breakdown: readTaxes(input.taxes),
      notes: clean(input.notes, 4000),
      ...(input.draft !== undefined && !id ? { status: input.draft ? "draft" : "open" } : {}),
    };
    if (id) {
      const { data, error } = await supabase.from("bills").update(row).eq("id", id).select("id");
      if (error) throw error;
      mustAffect(data);
      refresh();
      return ok("Bill saved.", id);
    }
    const { data, error } = await supabase.from("bills").insert(row).select("id").single<{ id: string }>();
    if (error) throw error;
    refresh();
    return ok("Bill added.", data.id);
  } catch (e) {
    return fail(e);
  }
}

/** A draft bill becomes open (owed). */
export async function openBill(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase.from("bills").update({ status: "open" }).eq("id", id).eq("status", "draft").select("id");
    if (error) throw error;
    mustAffect(data, "Only a draft bill can be opened.");
    refresh();
    return ok("Bill open — it counts as owed now.", id);
  } catch (e) {
    return fail(e);
  }
}

export async function voidBill(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase.from("bills").update({ status: "void" }).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Bill voided — it's no longer owed.", id);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBill(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase.from("bills").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Bill deleted.");
  } catch (e) {
    return fail(e);
  }
}

export type BillPaymentInput = {
  amount: number | string;
  amount_base?: number | string | null;
  paid_on: string;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
};

export async function recordBillPayment(billId: string, input: BillPaymentInput): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const amount = round2(num(input.amount));
    if (!(amount > 0)) return { ok: false, error: "Enter the amount paid." };
    const paidOn = day(input.paid_on);
    if (!paidOn) return { ok: false, error: "Pick the date it was paid." };
    const base = input.amount_base == null || String(input.amount_base).trim() === "" ? null : round2(num(input.amount_base));
    const { error } = await supabase.from("bill_payments").insert({
      bill_id: billId,
      amount,
      amount_base: base,
      paid_on: paidOn,
      method: clean(input.method, 60),
      reference: clean(input.reference, 80),
      note: clean(input.note, 500),
    });
    if (error) throw error;
    refresh();
    return ok("Payment recorded — it's in the ledger as an expense.", billId);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBillPayment(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase.from("bill_payments").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Payment removed — its expense left the ledger too.");
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────────── recurring bills ───────────────────────────── */

export type BillScheduleInput = {
  supplier_id: string;
  name: string;
  description?: string | null;
  category: string;
  amount: number | string;
  taxes: BillTax[];
  currency: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  interval_count: number | string;
  next_run_on: string;
  due_days: number | string;
  ends_on?: string | null;
  active: boolean;
};

export async function saveBillSchedule(id: string | null, input: BillScheduleInput): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const name = (input.name ?? "").trim();
    if (!name) return { ok: false, error: "Name it — Office rent, Hosting…" };
    if (!input.supplier_id) return { ok: false, error: "Pick the supplier." };
    const amount = round2(num(input.amount));
    if (!(amount > 0)) return { ok: false, error: "Enter the amount before tax." };
    const next = day(input.next_run_on);
    if (!next) return { ok: false, error: "Pick when the next bill is raised." };
    const ends = day(input.ends_on);
    if (ends && ends < next) return { ok: false, error: "It ends before the next bill." };
    if (!["weekly", "monthly", "quarterly", "yearly"].includes(input.frequency)) return { ok: false, error: "Pick how often." };
    const row = {
      supplier_id: input.supplier_id,
      name: name.slice(0, 120),
      description: clean(input.description, 500),
      category: (input.category || "Other").trim().slice(0, 80),
      amount,
      tax_breakdown: readTaxes(input.taxes),
      currency: (input.currency || "LKR").toUpperCase(),
      frequency: input.frequency,
      interval_count: Math.min(24, Math.max(1, Math.floor(num(input.interval_count, 1)))),
      next_run_on: next,
      due_days: Math.min(120, Math.max(0, Math.floor(num(input.due_days)))),
      ends_on: ends,
      active: input.active !== false,
    };
    if (id) {
      const { data, error } = await supabase.from("bill_schedules").update(row).eq("id", id).select("id");
      if (error) throw error;
      mustAffect(data);
    } else {
      const { error } = await supabase.from("bill_schedules").insert({ ...row, anchor_date: next });
      if (error) throw error;
    }
    // Anything due already is raised now.
    await supabase.rpc("run_bill_schedules");
    refresh();
    return ok(id ? "Recurring bill saved." : `${name} set up — bills appear as they come due.`);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBillSchedule(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase.from("bill_schedules").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Recurring bill removed. Bills it raised stay.");
  } catch (e) {
    return fail(e);
  }
}
