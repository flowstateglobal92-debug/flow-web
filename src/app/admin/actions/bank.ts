"use server";

import { revalidatePath } from "next/cache";
import { authorize, type Session } from "@/lib/admin/auth";
import { num } from "@/lib/admin/format";
import { round2 } from "@/lib/admin/invoice-math";
import type { BankRow } from "@/lib/admin/csv";
import { fail, mustAffect, ok, type ActionResult } from "./shared";

/**
 * Bank statements (0041): accounts, importing lines, and tying each line to
 * the books — an existing ledger entry, a payment on an invoice, a payment of
 * a bill, a new entry — or setting it aside.
 */

type Supabase = Session["supabase"];

function refresh() {
  revalidatePath("/admin/expenses", "layout");
  revalidatePath("/admin/invoices", "layout");
  revalidatePath("/admin/reports", "layout");
}

export async function saveBankAccount(id: string | null, input: { name: string; currency: string; last4?: string | null }): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const name = (input.name ?? "").trim();
    if (!name) return { ok: false, error: "Name the account — Commercial Bank current, say." };
    const last4 = (input.last4 ?? "").trim() || null;
    if (last4 && !/^[0-9A-Za-z]{2,6}$/.test(last4)) return { ok: false, error: "The last digits are 2–6 letters or numbers." };
    const row = { name: name.slice(0, 120), currency: (input.currency || "LKR").toUpperCase(), last4 };
    if (id) {
      const { data, error } = await supabase.from("bank_accounts").update(row).eq("id", id).select("id");
      if (error) throw error;
      mustAffect(data);
      refresh();
      return ok("Account saved.", id);
    }
    const { data, error } = await supabase.from("bank_accounts").insert(row).select("id").single<{ id: string }>();
    if (error) throw error;
    refresh();
    return ok(`${name} added.`, data.id);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Lines from one file. Each comes with its fingerprint (lib/admin/csv.ts), so
 * a file imported twice — or two overlapping statements — adds each line once.
 */
export async function importBankLines(
  accountId: string,
  rows: (BankRow & { fingerprint: string })[],
): Promise<ActionResult & { added?: number; repeated?: number }> {
  try {
    const { supabase } = await authorize("finance");
    if (!rows.length) return { ok: false, error: "No transactions in that file." };
    if (rows.length > 5000) return { ok: false, error: "Import 5,000 lines at a time at most." };
    const importId = crypto.randomUUID();
    const clean = rows
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.posted_on) && Number.isFinite(r.amount) && r.amount !== 0)
      .map((r) => ({
        account_id: accountId,
        posted_on: r.posted_on,
        description: String(r.description ?? "").slice(0, 500),
        reference: r.reference ? String(r.reference).slice(0, 120) : null,
        amount: round2(r.amount),
        balance: r.balance == null ? null : round2(r.balance),
        fingerprint: String(r.fingerprint).slice(0, 600),
        import_id: importId,
      }));
    let added = 0;
    for (let i = 0; i < clean.length; i += 500) {
      const { data, error } = await supabase
        .from("bank_lines")
        .upsert(clean.slice(i, i + 500), { onConflict: "account_id,fingerprint", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      added += data?.length ?? 0;
    }
    refresh();
    const repeated = clean.length - added;
    return {
      ok: true,
      added,
      repeated,
      message: `${added} line${added === 1 ? "" : "s"} imported${repeated ? ` — ${repeated} already here` : ""}.`,
    };
  } catch (e) {
    return fail(e);
  }
}

export type Suggestions = {
  entries: { id: string; date: string; description: string; category: string; amount: number; reference: string | null; score: number }[];
  invoices: { id: string; number: string | null; client: string; currency: string; balance: number; balance_lkr: number | null; due_date: string | null; score: number }[];
  bills: { id: string; reference: string | null; supplier: string; currency: string; balance: number; balance_lkr: number | null; due_date: string | null; score: number }[];
};

export async function bankLineSuggestions(lineId: string): Promise<ActionResult & { suggestions?: Suggestions }> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase.rpc("bank_line_suggestions", { p_line: lineId });
    if (error) throw error;
    return { ok: true, suggestions: data as Suggestions };
  } catch (e) {
    return fail(e);
  }
}

async function linkEntry(supabase: Supabase, lineId: string, entryId: string) {
  const { data, error } = await supabase.from("bank_lines").update({ matched_entry_id: entryId }).eq("id", lineId).select("id");
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("That entry is already matched to another line.");
    throw error;
  }
  mustAffect(data);
}

export async function matchBankLine(lineId: string, entryId: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    await linkEntry(supabase, lineId, entryId);
    refresh();
    return ok("Matched.");
  } catch (e) {
    return fail(e);
  }
}

export async function unmatchBankLine(lineId: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase
      .from("bank_lines")
      .update({ matched_entry_id: null, status: "unmatched", note: null })
      .eq("id", lineId)
      .select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Back to unmatched — the ledger entry stays.");
  } catch (e) {
    return fail(e);
  }
}

export async function ignoreBankLine(lineId: string, note: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase
      .from("bank_lines")
      .update({ status: "ignored", matched_entry_id: null, note: note.trim().slice(0, 500) || null })
      .eq("id", lineId)
      .select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Set aside — it won't count as unmatched.");
  } catch (e) {
    return fail(e);
  }
}

type Line = { id: string; posted_on: string; amount: number; description: string; reference: string | null };

async function loadLine(supabase: Supabase, id: string) {
  const { data, error } = await supabase.from("bank_lines").select("id, posted_on, amount, description, reference, status").eq("id", id).maybeSingle<Line & { status: string }>();
  if (error) throw error;
  if (!data) throw new Error("That line isn't available.");
  if (data.status !== "unmatched") throw new Error("That line is already matched or set aside.");
  return data;
}

/** Money in → a payment on an open invoice (posts income), matched to the line. */
export async function payInvoiceFromLine(lineId: string, invoiceId: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const line = await loadLine(supabase, lineId);
    if (!(num(line.amount) > 0)) return { ok: false, error: "Only money coming in pays an invoice." };
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, currency, exchange_rate, balance_due")
      .eq("id", invoiceId)
      .maybeSingle<{ id: string; currency: string; exchange_rate: number | null; balance_due: number }>();
    if (!inv) return { ok: false, error: "That invoice isn't available — it needs Invoices access too." };
    const lkr = round2(num(line.amount));
    // The bank line is rupees: on a foreign invoice it's that many rupees' worth at the invoice's rate.
    const amount = inv.currency === "LKR" ? lkr : inv.exchange_rate ? round2(lkr / num(inv.exchange_rate)) : null;
    if (amount == null) return { ok: false, error: `Set the ${inv.currency} invoice's exchange rate first.` };
    const { data: pay, error } = await supabase
      .from("invoice_payments")
      .insert({
        invoice_id: inv.id,
        kind: "payment",
        amount: Math.min(amount, round2(num(inv.balance_due))),
        amount_base: lkr,
        paid_on: line.posted_on,
        method: "Bank transfer",
        reference: line.reference || line.description.slice(0, 80) || null,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    const { data: entry } = await supabase.from("finance_entries").select("id").eq("invoice_payment_id", pay.id).maybeSingle<{ id: string }>();
    if (entry) await linkEntry(supabase, lineId, entry.id);
    refresh();
    return ok("Payment recorded on the invoice and matched.");
  } catch (e) {
    return fail(e);
  }
}

/** Money out → a payment of an open bill (posts the expense), matched to the line. */
export async function payBillFromLine(lineId: string, billId: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const line = await loadLine(supabase, lineId);
    if (!(num(line.amount) < 0)) return { ok: false, error: "Only money going out pays a bill." };
    const { data: bill } = await supabase
      .from("bills")
      .select("id, currency, exchange_rate, balance_due")
      .eq("id", billId)
      .maybeSingle<{ id: string; currency: string; exchange_rate: number | null; balance_due: number }>();
    if (!bill) return { ok: false, error: "That bill isn't available." };
    const lkr = round2(Math.abs(num(line.amount)));
    const amount = bill.currency === "LKR" ? lkr : bill.exchange_rate ? round2(lkr / num(bill.exchange_rate)) : null;
    if (amount == null) return { ok: false, error: `Set the ${bill.currency} bill's exchange rate first.` };
    const { data: pay, error } = await supabase
      .from("bill_payments")
      .insert({
        bill_id: bill.id,
        amount: Math.min(amount, round2(num(bill.balance_due))),
        amount_base: lkr,
        paid_on: line.posted_on,
        method: "Bank transfer",
        reference: line.reference || null,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    const { data: entry } = await supabase.from("finance_entries").select("id").eq("bill_payment_id", pay.id).maybeSingle<{ id: string }>();
    if (entry) await linkEntry(supabase, lineId, entry.id);
    refresh();
    return ok("Bill payment recorded and matched.");
  } catch (e) {
    return fail(e);
  }
}

/** A new ledger entry from the line (income or expense by its sign), matched to it. */
export async function entryFromLine(lineId: string, input: { category: string; description: string }): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const line = await loadLine(supabase, lineId);
    const category = (input.category ?? "").trim();
    if (!category) return { ok: false, error: "Pick a category." };
    const { data: entry, error } = await supabase
      .from("finance_entries")
      .insert({
        kind: num(line.amount) > 0 ? "income" : "expense",
        entry_date: line.posted_on,
        description: (input.description || line.description || "Bank").trim().slice(0, 300),
        category: category.slice(0, 80),
        amount: round2(Math.abs(num(line.amount))),
        method: "Bank transfer",
        reference: line.reference,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    await linkEntry(supabase, lineId, entry.id);
    refresh();
    return ok(num(line.amount) > 0 ? "Income added and matched." : "Expense added and matched.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBankLines(ids: string[]): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase.from("bank_lines").delete().in("id", ids).select("id");
    if (error) throw error;
    refresh();
    return ok(`${data?.length ?? 0} line${data?.length === 1 ? "" : "s"} removed. Ledger entries stay.`);
  } catch (e) {
    return fail(e);
  }
}
