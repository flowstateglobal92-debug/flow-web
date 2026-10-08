"use server";

import { revalidatePath } from "next/cache";
import { authorize, type Session } from "@/lib/admin/auth";
import { addDays, formatDate, num, todayISO } from "@/lib/admin/format";
import { cleanTaxes, computeTotals, round2, round3 } from "@/lib/admin/invoice-math";
import { canAccess, isApprover } from "@/lib/admin/modules";
import {
  docMoney,
  type DocumentInput,
  type Frequency,
  type InvoiceKind,
  type InvoiceSchedule,
  type ScheduleInput,
  type ScheduleTemplate,
} from "@/lib/admin/invoice-types";
import { amount, fail, mustAffect, nextPosition, ok, optional, text, type ActionResult } from "./shared";

/**
 * Invoices, quotes, credit notes, payments, refunds and recurring schedules.
 *
 * The database does the bookkeeping: `save_invoice` writes the header and
 * items in one go and recomputes totals once, `issue_document` numbers the
 * document (or routes it to approval), and the payment triggers post each
 * payment to Income. These actions validate early so the person gets a
 * sentence instead of a constraint name, then let RLS and the triggers decide.
 */

type Supabase = Session["supabase"];

function refresh() {
  revalidatePath("/admin/invoices", "layout");
  revalidatePath("/admin/expenses");
  revalidatePath("/admin");
}

const day = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

/** Trim, round to column precision and drop empty rows — or say what's missing. */
function readDocument(input: DocumentInput): { doc: DocumentInput } | { error: string } {
  const items = input.items
    .map((i) => ({
      description: (i.description ?? "").trim(),
      details: clean(i.details),
      quantity: round3(num(i.quantity)),
      unit_price: round2(num(i.unit_price)),
      taxes: cleanTaxes(i.taxes),
    }))
    .filter((i) => i.description || i.details || i.unit_price > 0);

  if (!input.bill_to_name.trim()) return { error: "Add who this is billed to." };
  if (items.length === 0) return { error: "Add at least one line item." };
  if (items.some((i) => !i.description)) return { error: "Every line needs a description." };
  if (items.some((i) => !(i.quantity > 0))) return { error: "Quantities must be more than zero." };
  if (items.some((i) => i.unit_price < 0)) return { error: "Rates can't be negative." };

  const taxRate = round2(num(input.tax_rate));
  if (taxRate < 0 || taxRate > 100) return { error: "Tax rate must be between 0 and 100%." };
  const discount = round2(num(input.discount_value));
  if (discount < 0) return { error: "Discount can't be negative." };
  if (input.discount_type === "percent" && discount > 100) return { error: "A percentage discount can't pass 100%." };

  const issueDate = day(input.issue_date);
  if (!issueDate) return { error: "Pick an issue date." };

  const kind: InvoiceKind = input.kind === "quote" ? "quote" : input.kind === "credit_note" ? "credit_note" : "invoice";
  if (kind === "credit_note" && !input.credited_invoice_id) return { error: "A credit note needs the invoice it credits." };
  const currency = (input.currency || "LKR").toUpperCase();
  const rate = input.exchange_rate == null || input.exchange_rate === ("" as unknown) ? null : num(input.exchange_rate);
  if (rate != null && !(rate > 0)) return { error: "The exchange rate must be more than zero." };
  const taxId = clean(input.bill_to_tax_id);
  if (taxId && taxId.length > 40) return { error: "Keep the TIN to 40 characters." };

  return {
    doc: {
      id: input.id,
      kind,
      client_id: input.client_id || null,
      lead_id: input.lead_id || null,
      owner_id: input.owner_id || null,
      bill_to_name: input.bill_to_name.trim(),
      bill_to_company: clean(input.bill_to_company),
      bill_to_email: clean(input.bill_to_email),
      bill_to_phone: clean(input.bill_to_phone),
      bill_to_address: clean(input.bill_to_address),
      subject: clean(input.subject),
      issue_date: issueDate,
      due_date: kind === "invoice" ? day(input.due_date) : null,
      valid_until: kind === "quote" ? day(input.valid_until) : null,
      currency,
      discount_type: input.discount_type === "percent" ? "percent" : "amount",
      discount_value: discount,
      tax_label: (input.tax_label ?? "").trim() || "Tax",
      tax_rate: taxRate,
      notes: clean(input.notes),
      terms: clean(input.terms),
      payment_details: clean(input.payment_details),
      exchange_rate: currency === "LKR" ? null : rate,
      prices_include_tax: !!input.prices_include_tax,
      supply_date: day(input.supply_date),
      bill_to_tax_id: taxId,
      credited_invoice_id: kind === "credit_note" ? input.credited_invoice_id ?? null : null,
      credit_reason: kind === "credit_note" ? input.credit_reason ?? "other" : null,
      items,
    },
  };
}

/** `save_invoice(p_invoice, p_items)` — kind only on create, id only on update. */
async function save(supabase: Supabase, doc: DocumentInput) {
  const { id, kind, items, ...header } = doc;
  const p_invoice = id ? { id, ...header } : { kind, ...header };
  const { data, error } = await supabase.rpc("save_invoice", { p_invoice, p_items: items });
  if (error) throw error;
  if (!data) throw new Error("The invoice wasn't saved.");
  return String(data);
}

async function issue(supabase: Supabase, id: string) {
  const { data, error } = await supabase.rpc("issue_document", { p_id: id });
  if (error) throw error;
  return (data ?? {}) as { status?: string; number?: string | null };
}

function issuedMessage(kind: InvoiceKind, result: { status?: string; number?: string | null }) {
  if (result.status === "pending_approval") return "Sent for approval — an admin will issue it.";
  if (kind === "quote") return result.number ? `Quote ${result.number} marked sent.` : "Quote marked sent.";
  if (kind === "credit_note") return `Credit note ${result.number} applied to its invoice.`;
  if (result.status === "paid") return `Issued as ${result.number} — nothing to pay, so it's marked paid.`;
  return `Issued as ${result.number}.`;
}

/** What a schedule copies each period: the header without its dates, plus the items. */
const TEMPLATE_KEYS = [
  "client_id",
  "lead_id",
  "owner_id",
  "bill_to_name",
  "bill_to_company",
  "bill_to_email",
  "bill_to_phone",
  "bill_to_address",
  "subject",
  "currency",
  "discount_type",
  "discount_value",
  "tax_label",
  "tax_rate",
  "notes",
  "terms",
  "payment_details",
  "exchange_rate",
  "prices_include_tax",
  "bill_to_tax_id",
  "items",
] as const satisfies readonly (keyof ScheduleTemplate)[];

const templateOf = (doc: DocumentInput): ScheduleTemplate =>
  Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, doc[k]])) as ScheduleTemplate;

/** The same day a year back, clamped the way Postgres does it (29 Feb → 28 Feb). */
function yearBefore(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** What a saved schedule's row says about when it bills — compared before a member's change. */
type StoredTiming = Pick<
  InvoiceSchedule,
  "auto_issue" | "active" | "frequency" | "interval_count" | "next_run_on" | "ends_on" | "max_occurrences"
>;
const TIMING_COLUMNS = "auto_issue, active, frequency, interval_count, next_run_on, ends_on, max_occurrences";

const retimed = (stored: StoredTiming, v: ScheduleInput) =>
  stored.frequency !== v.frequency ||
  num(stored.interval_count, 1) !== v.interval_count ||
  stored.next_run_on !== v.next_run_on ||
  (stored.ends_on ?? null) !== v.ends_on ||
  (stored.max_occurrences == null ? null : num(stored.max_occurrences)) !== v.max_occurrences;

/**
 * `stored` is the schedule as saved, when editing one: like the database
 * (0027), only a next run that moves is held to the year-back limit, so a
 * long-paused schedule can still be saved as it is.
 */
function readSchedule(
  input: ScheduleInput,
  admin: boolean,
  stored?: Pick<StoredTiming, "next_run_on"> | null,
): { schedule: ScheduleInput } | { error: string } {
  const name = input.name.trim();
  if (!name) return { error: "Name the schedule." };
  const frequencies: Frequency[] = ["weekly", "monthly", "quarterly", "yearly"];
  if (!frequencies.includes(input.frequency)) return { error: "Pick how often it repeats." };
  const anchor = day(input.anchor_date);
  const next = day(input.next_run_on);
  if (!anchor || !next) return { error: "Pick when the next invoice is due to be created." };
  // A run bills every period from the next run to today — same limit and sentence as the database.
  if (next !== stored?.next_run_on && next < yearBefore(todayISO())) {
    return { error: "The next run can't be more than a year ago." };
  }
  const ends = day(input.ends_on);
  if (ends && ends < next) return { error: "The end date is before the next invoice." };
  const max = input.max_occurrences != null && num(input.max_occurrences) > 0 ? Math.floor(num(input.max_occurrences)) : null;
  return {
    schedule: {
      name,
      is_retainer: !!input.is_retainer,
      frequency: input.frequency,
      interval_count: Math.max(1, Math.floor(num(input.interval_count, 1))),
      anchor_date: anchor,
      next_run_on: next,
      ends_on: ends,
      max_occurrences: max,
      // Members' schedules always produce drafts for review (the database re-checks).
      auto_issue: admin && !!input.auto_issue,
      active: input.active !== false,
    },
  };
}

/* ─────────────────────────────── documents ─────────────────────────────── */

/**
 * Save the editor. Optionally issue it straight after, start a recurring
 * schedule from it, or file the bill-to block as a new client first.
 * When the save lands but a later step fails, the result still carries the
 * id so the editor moves to the saved draft instead of creating a twin.
 */
export async function saveDocument(
  input: DocumentInput,
  opts: { issue?: boolean; recurring?: ScheduleInput | null; saveClient?: boolean } = {},
): Promise<ActionResult> {
  let savedId: string | undefined;
  let createdClient: { supabase: Supabase; id: string } | undefined;
  let step: "save" | "schedule" | "link" | "issue" = "save";
  try {
    const { supabase, profile } = await authorize("invoices");
    const read = readDocument(input);
    if ("error" in read) return { ok: false, error: read.error };
    const doc = read.doc;

    let schedule: ScheduleInput | null = null;
    if (opts.recurring && doc.kind === "invoice") {
      const s = readSchedule(opts.recurring, isApprover(profile));
      if ("error" in s) return { ok: false, error: s.error };
      schedule = s.schedule;
    }

    if (opts.saveClient && !doc.client_id) {
      if (!canAccess(profile, "clients")) return { ok: false, error: "Saving a new client needs access to Clients." };
      // A payment locks the client (0013 refuses the change) — don't file one it could never link to.
      if (doc.id) {
        const { data: current } = await supabase
          .from("invoices")
          .select("amount_paid")
          .eq("id", doc.id)
          .maybeSingle<{ amount_paid: number }>();
        if (num(current?.amount_paid) > 0) {
          return { ok: false, error: "The client is locked once a payment is recorded, so this invoice can't move to a new one." };
        }
      }
      const { data: client, error } = await supabase
        .from("clients")
        .insert({
          name: doc.bill_to_name,
          company: doc.bill_to_company,
          email: doc.bill_to_email,
          phone: doc.bill_to_phone,
          address: doc.bill_to_address,
        })
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      createdClient = { supabase, id: client.id };
      doc.client_id = client.id;
    }

    savedId = await save(supabase, doc);

    let message = doc.id
      ? "Saved."
      : doc.kind === "quote"
        ? "Quote saved as a draft."
        : doc.kind === "credit_note"
          ? "Credit note saved as a draft."
          : "Draft saved.";
    let nextRun: string | null = null;

    if (schedule) {
      // This invoice is the series' first: it counts towards "stops after N"
      // and is linked to the schedule, so its page stops offering "Make
      // recurring". The database restarts the cadence from next_run_on when
      // that date is off it (0015 schedule_run_dates).
      step = "schedule";
      const { data: created, error } = await supabase
        .from("invoice_schedules")
        .insert({
          ...schedule,
          client_id: doc.client_id,
          owner_id: doc.owner_id,
          template: templateOf(doc),
          amount: computeTotals(doc).total,
          currency: doc.currency,
          occurrences: 1,
          last_invoice_id: savedId,
        })
        .select("id, next_run_on")
        .single<{ id: string; next_run_on: string }>();
      if (error) throw error;
      nextRun = created.next_run_on;

      step = "link";
      const { error: linkError } = await supabase.rpc("link_first_scheduled_invoice", {
        p_schedule: created.id,
        p_invoice: savedId,
      });
      if (linkError) throw linkError;
    }

    if (opts.issue) {
      step = "issue";
      message = issuedMessage(doc.kind, await issue(supabase, savedId));
    }

    refresh();
    return ok(nextRun ? `${message} Next one ${formatDate(nextRun)}.` : message, savedId);
  } catch (e) {
    const result = fail(e);
    if (!savedId) {
      // Nothing saved: take back the client filed for it, or every retry adds a twin.
      if (createdClient) await createdClient.supabase.from("clients").delete().eq("id", createdClient.id);
      return result;
    }
    refresh();
    const what =
      step === "issue"
        ? "it wasn't issued"
        : step === "link"
          ? "it isn't linked to its new schedule"
          : "the schedule wasn't created";
    return { ok: false, id: savedId, error: `${input.id ? "Saved" : "Saved as a draft"}, but ${what}: ${result.error}` };
  }
}

/** Number a draft: invoices become issued (or wait for approval), quotes become sent. */
export async function issueDocument(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data: row } = await supabase.from("invoices").select("kind").eq("id", id).maybeSingle<{ kind: InvoiceKind }>();
    const result = await issue(supabase, id);
    refresh();
    return ok(issuedMessage(row?.kind ?? "invoice", result), id);
  } catch (e) {
    return fail(e);
  }
}

/** A fresh draft with the same bill-to and lines, dated today. */
export async function duplicateDocument(id: string): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("invoices");
    const [{ data: row, error }, { data: items }] = await Promise.all([
      supabase.from("invoices").select("*").eq("id", id).maybeSingle<Record<string, unknown>>(),
      supabase
        .from("invoice_items")
        .select("description, details, quantity, unit_price, taxes")
        .eq("invoice_id", id)
        .order("position")
        .returns<{ description: string; details: string | null; quantity: number; unit_price: number; taxes: unknown }[]>(),
    ]);
    if (error) throw error;
    if (!row) return { ok: false, error: "That document isn't available." };
    if (row.kind === "credit_note") return { ok: false, error: "Credit notes aren't copied — make a new one from the invoice." };

    const s = (k: string) => (row[k] == null ? null : String(row[k]));
    const issueDate = todayISO();
    // Keep the original's window (issue → due, issue → valid until) on the copy.
    const span = (k: string) => {
      const to = day(s(k));
      const from = day(s("issue_date"));
      return to && from ? addDays(issueDate, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)) : null;
    };

    const newId = await save(supabase, {
      kind: row.kind === "quote" ? "quote" : "invoice",
      client_id: s("client_id"),
      lead_id: s("lead_id"),
      // Whoever makes the copy follows it up.
      owner_id: profile.id,
      bill_to_name: s("bill_to_name") ?? "",
      bill_to_company: s("bill_to_company"),
      bill_to_email: s("bill_to_email"),
      bill_to_phone: s("bill_to_phone"),
      bill_to_address: s("bill_to_address"),
      subject: s("subject"),
      issue_date: issueDate,
      due_date: row.kind === "quote" ? null : span("due_date"),
      valid_until: row.kind === "quote" ? span("valid_until") : null,
      currency: s("currency") ?? "LKR",
      discount_type: row.discount_type === "percent" ? "percent" : "amount",
      discount_value: num(row.discount_value),
      tax_label: s("tax_label") ?? "VAT",
      tax_rate: num(row.tax_rate),
      notes: s("notes"),
      terms: s("terms"),
      payment_details: s("payment_details"),
      exchange_rate: row.exchange_rate == null ? null : num(row.exchange_rate),
      prices_include_tax: !!row.prices_include_tax,
      bill_to_tax_id: s("bill_to_tax_id"),
      items: (items ?? []).map((i) => ({
        description: i.description,
        details: i.details,
        quantity: num(i.quantity),
        unit_price: num(i.unit_price),
        taxes: cleanTaxes(Array.isArray(i.taxes) ? i.taxes : []),
      })),
    });

    refresh();
    return ok("Copied to a new draft.", newId);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Void an issued invoice (the database refuses while payments or credit notes
 * stand) or an issued credit note (its invoice owes the amount again).
 */
export async function voidInvoice(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase
      .from("invoices")
      .update({ status: "void", voided_at: new Date().toISOString() })
      .eq("id", id)
      .in("kind", ["invoice", "credit_note"])
      .select("id, kind")
      .returns<{ id: string; kind: InvoiceKind }[]>();
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(data?.[0]?.kind === "credit_note" ? "Credit note voided — its invoice owes that amount again." : "Invoice voided.", id);
  } catch (e) {
    return fail(e);
  }
}

/** Drafts only — anything issued is voided instead, so its number stays accounted for. */
export async function deleteDocument(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase.from("invoices").delete().eq("id", id).eq("status", "draft").select("id");
    if (error) throw error;
    mustAffect(data, "Only drafts can be deleted — void an issued invoice instead.");
    refresh();
    return ok("Draft deleted.");
  } catch (e) {
    return fail(e);
  }
}

/* ──────────────────────────────── payments ──────────────────────────────── */

/** Add a payment. It posts to Income in LKR (`amount_base`) through the ledger trigger. */
export async function recordPayment(invoiceId: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const inv = await paymentTarget(supabase, invoiceId);
    if (!inv) return { ok: false, error: "That invoice isn't available." };
    if (inv.kind !== "invoice" || !["issued", "partially_paid"].includes(inv.status)) {
      return { ok: false, error: "Payments can only be recorded on an issued, unpaid invoice." };
    }

    const value = round2(amount(formData, "amount"));
    if (!(value > 0)) return { ok: false, error: "Enter the amount received." };
    const left = round2(num(inv.total) - num(inv.amount_paid) - num(inv.credited_total));
    if (value > left) return { ok: false, error: `That's more than the ${docMoney(left, inv.currency)} left to pay.` };

    const base = rupees(formData, inv, value);
    if ("error" in base) return { ok: false, error: base.error };

    const { error } = await supabase.from("invoice_payments").insert({
      invoice_id: invoiceId,
      kind: "payment",
      amount: value,
      amount_base: base.value,
      paid_on: text(formData, "paid_on") || undefined,
      method: optional(formData, "method"),
      reference: optional(formData, "reference"),
      note: optional(formData, "note"),
    });
    if (error) throw error;

    refresh();
    const after = round2(left - value);
    return ok(after <= 0 ? "Paid in full — added to Income." : `Payment recorded — ${docMoney(after, inv.currency)} left to pay.`, invoiceId);
  } catch (e) {
    return fail(e);
  }
}

type PaymentTarget = {
  id: string;
  kind: string;
  status: string;
  currency: string;
  total: number;
  amount_paid: number;
  credited_total?: number;
  exchange_rate?: number | null;
  number: string | null;
};

async function paymentTarget(supabase: Supabase, invoiceId: string) {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle<PaymentTarget>();
  if (error) throw error;
  return data;
}

/** What arrived (or left) in rupees: as is for LKR; typed in, or the document's rate × amount, otherwise. */
function rupees(formData: FormData, inv: PaymentTarget, value: number): { value: number | null } | { error: string } {
  if (inv.currency.toUpperCase() === "LKR") return { value };
  const typed = round2(amount(formData, "amount_base"));
  if (typed > 0) return { value: typed };
  if (inv.exchange_rate && num(inv.exchange_rate) > 0) return { value: round2(value * num(inv.exchange_rate)) };
  return { error: "Enter the amount in rupees — Income is kept in LKR." };
}

/**
 * Money going back to the client: up to what they've paid beyond what they
 * now owe (after credit notes). Posts to Income as a negative line.
 */
export async function recordRefund(invoiceId: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const inv = await paymentTarget(supabase, invoiceId);
    if (!inv || inv.kind !== "invoice") return { ok: false, error: "That invoice isn't available." };
    const due = round2(num(inv.amount_paid) + num(inv.credited_total) - num(inv.total));
    if (!(due > 0)) return { ok: false, error: "Nothing to refund — the client hasn't paid more than they owe." };

    const value = round2(amount(formData, "amount"));
    if (!(value > 0)) return { ok: false, error: "Enter the amount refunded." };
    if (value > due) return { ok: false, error: `That's more than the ${docMoney(due, inv.currency)} owed back.` };

    const base = rupees(formData, inv, value);
    if ("error" in base) return { ok: false, error: base.error };

    const { error } = await supabase.from("invoice_payments").insert({
      invoice_id: invoiceId,
      kind: "refund",
      amount: value,
      amount_base: base.value,
      paid_on: text(formData, "paid_on") || undefined,
      method: optional(formData, "method"),
      reference: optional(formData, "reference"),
      note: optional(formData, "note"),
    });
    if (error) throw error;
    refresh();
    return ok("Refund recorded — it comes off Income.", invoiceId);
  } catch (e) {
    return fail(e);
  }
}

/** An admin closes what's left as bad debt (a write-off credit note, issued at once). */
export async function writeOffInvoice(invoiceId: string, note: string): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("invoices");
    if (!isApprover(profile)) return { ok: false, error: "Only an admin can write off an invoice." };
    const { data, error } = await supabase.rpc("write_off_invoice", { p_invoice: invoiceId, p_note: note.trim() || null });
    if (error) throw error;
    refresh();
    revalidatePath("/admin/reports", "layout");
    return ok("Written off — the balance is closed by a credit note.", String(data ?? invoiceId));
  } catch (e) {
    return fail(e);
  }
}

/** Remove one payment; its income entry leaves Expenses with it. */
export async function deletePayment(paymentId: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase
      .from("invoice_payments")
      .delete()
      .eq("id", paymentId)
      .select("id, kind")
      .returns<{ id: string; kind?: string }[]>();
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(
      data?.[0]?.kind === "refund"
        ? "Refund removed — its line is gone from Income."
        : "Payment removed — its income entry is gone from Expenses.",
    );
  } catch (e) {
    return fail(e);
  }
}

/** "→ Unpaid": remove every payment on the invoice. */
export async function clearPayments(invoiceId: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase.from("invoice_payments").delete().eq("invoice_id", invoiceId).select("id");
    if (error) throw error;
    mustAffect(data, "There were no payments to remove.");
    refresh();
    const n = data?.length ?? 0;
    return ok(`Marked unpaid — ${n} income ${n === 1 ? "entry" : "entries"} removed from Expenses.`, invoiceId);
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────────────── quotes ──────────────────────────────── */

/**
 * Accepted / declined / expired, or back to sent. Sending a draft numbers it,
 * so that goes through `issueDocument`. Accepting can also move the linked
 * lead to the won stage when the person has the CRM.
 */
export async function setQuoteStatus(
  id: string,
  status: "sent" | "accepted" | "declined" | "expired",
  opts: { winLead?: boolean } = {},
): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("invoices");
    if (!["sent", "accepted", "declined", "expired"].includes(status)) return { ok: false, error: "Unknown status." };

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status };
    if (status === "accepted") patch.accepted_at = now;
    if (status === "declined") patch.declined_at = now;

    const { data, error } = await supabase
      .from("invoices")
      .update(patch)
      .eq("id", id)
      .eq("kind", "quote")
      .neq("status", "draft")
      .select("id, lead_id")
      .returns<{ id: string; lead_id: string | null }[]>();
    if (error) throw error;
    mustAffect(data, "Send the quote first — drafts can't be accepted or declined.");

    const label = { sent: "Quote reopened.", accepted: "Quote accepted.", declined: "Quote declined.", expired: "Quote marked expired." }[status];
    const leadId = data?.[0]?.lead_id;
    if (status === "accepted" && opts.winLead && leadId && canAccess(profile, "crm")) {
      const moved = await winLead(supabase, leadId);
      refresh();
      revalidatePath("/admin/crm");
      return ok(moved ? "Quote accepted — the lead moved to Won." : "Quote accepted. The lead couldn't be moved.", id);
    }

    refresh();
    return ok(label, id);
  } catch (e) {
    return fail(e);
  }
}

async function winLead(supabase: Supabase, leadId: string) {
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("is_won", true)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!stage) return false;
  const position = await nextPosition(supabase, stage.id);
  const { data, error } = await supabase
    .from("leads")
    .update({ stage_id: stage.id, position })
    .eq("id", leadId)
    .select("id");
  return !error && !!data?.length;
}

/** Copy a sent or accepted quote into a new draft invoice (once — the database locks and checks). */
export async function convertQuote(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase.rpc("convert_quote_to_invoice", { p_quote: id });
    if (error) throw error;
    refresh();
    return ok("Converted — the invoice is a draft, ready to check and issue.", String(data));
  } catch (e) {
    return fail(e);
  }
}

/* ──────────────────────────────── settings ─────────────────────────────── */

export async function saveInvoiceSettings(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("invoices");
    if (!isApprover(profile)) return { ok: false, error: "Only admins can change invoice settings." };

    const business_name = text(formData, "business_name");
    if (!business_name) return { ok: false, error: "The business name prints on every invoice — add it." };
    const dueDays = Math.floor(amount(formData, "default_due_days"));
    if (dueDays < 0 || dueDays > 365) return { ok: false, error: "Payment terms must be 0–365 days." };
    const fyStart = Math.floor(amount(formData, "fiscal_year_start_month")) || 4;
    if (fyStart < 1 || fyStart > 12) return { ok: false, error: "Pick the month the tax year starts." };

    const { data, error } = await supabase
      .from("invoice_settings")
      .update({
        business_name,
        business_email: optional(formData, "business_email"),
        business_phone: optional(formData, "business_phone"),
        business_address: optional(formData, "business_address"),
        business_website: optional(formData, "business_website"),
        tax_id: optional(formData, "tax_id"),
        default_currency: (text(formData, "default_currency") || "LKR").toUpperCase(),
        default_due_days: dueDays,
        default_notes: optional(formData, "default_notes"),
        default_terms: optional(formData, "default_terms"),
        payment_details: optional(formData, "payment_details"),
        tax_registered: formData.get("tax_registered") === "on",
        prices_include_tax: formData.get("prices_include_tax") === "on",
        fiscal_year_start_month: fyStart,
      })
      .eq("workspace", profile.workspace)
      .select("workspace");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Invoice settings saved.");
  } catch (e) {
    return fail(e);
  }
}

/* ──────────────────────────────── recurring ─────────────────────────────── */

/** The schedule editor: the template's lines and bill-to plus the cadence. */
export async function saveScheduleTemplate(
  scheduleId: string,
  input: DocumentInput,
  scheduleInput: ScheduleInput,
): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("invoices");
    const read = readDocument({ ...input, kind: "invoice" });
    if ("error" in read) return { ok: false, error: read.error };
    const admin = isApprover(profile);
    const { data: current } = await supabase
      .from("invoice_schedules")
      .select("auto_issue, next_run_on")
      .eq("id", scheduleId)
      .maybeSingle<Pick<InvoiceSchedule, "auto_issue" | "next_run_on">>();
    const s = readSchedule(scheduleInput, admin, current);
    if ("error" in s) return { ok: false, error: s.error };
    // The stored anchor comes back as sent; the database restarts the cadence
    // when next_run_on is moved off it, and skips paused periods on resume
    // (0015 schedule_run_dates).
    const { auto_issue, ...rest } = s.schedule;

    // A member may edit what an admin's auto-issuing schedule bills, and
    // when, but then it makes drafts for review — otherwise the change would
    // skip approval (0015 and 0027 refuse it).
    const backToDrafts = !admin && !!current?.auto_issue;

    const { data, error } = await supabase
      .from("invoice_schedules")
      .update({
        ...rest,
        ...(admin ? { auto_issue } : backToDrafts ? { auto_issue: false } : {}),
        client_id: read.doc.client_id,
        owner_id: read.doc.owner_id,
        template: templateOf(read.doc),
        amount: computeTotals(read.doc).total,
        currency: read.doc.currency,
      })
      .eq("id", scheduleId)
      .select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(
      backToDrafts
        ? "Schedule saved and switched to drafts for review — only an admin can change one that issues itself."
        : "Schedule saved.",
      scheduleId,
    );
  } catch (e) {
    return fail(e);
  }
}

/** The quick edit from the Recurring list — cadence, dates, mode. */
export async function updateSchedule(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("invoices");
    const admin = isApprover(profile);
    const { data: current, error: readError } = await supabase
      .from("invoice_schedules")
      .select(TIMING_COLUMNS)
      .eq("id", id)
      .maybeSingle<StoredTiming>();
    if (readError) throw readError;
    const s = readSchedule(
      {
        name: text(formData, "name"),
        is_retainer: formData.get("is_retainer") === "on",
        frequency: text(formData, "frequency") as Frequency,
        interval_count: amount(formData, "interval_count") || 1,
        anchor_date: text(formData, "anchor_date") || text(formData, "next_run_on"),
        next_run_on: text(formData, "next_run_on"),
        ends_on: optional(formData, "ends_on"),
        max_occurrences: amount(formData, "max_occurrences") || null,
        auto_issue: formData.get("auto_issue") === "on",
        active: formData.get("active") === "on",
      },
      admin,
      current,
    );
    if ("error" in s) return { ok: false, error: s.error };
    const v = s.schedule;

    // When an auto-issuing schedule bills, and resuming it, are an admin's
    // call (0027). A member's change to either still goes through, with
    // auto-issue off in the same save, so the runs make drafts for review.
    const toDrafts = !admin && !!current?.auto_issue && (retimed(current, v) || (v.active && !current.active));

    // The anchor isn't written: it keeps month-end runs from drifting. A next
    // run off its cadence restarts the cadence from that date, and ticking
    // Active on a paused schedule skips the periods it missed — both in the
    // database (0015 schedule_run_dates), so no period is billed twice.
    const { data, error } = await supabase
      .from("invoice_schedules")
      .update({
        name: v.name,
        is_retainer: v.is_retainer,
        frequency: v.frequency,
        interval_count: v.interval_count,
        next_run_on: v.next_run_on,
        ends_on: v.ends_on,
        max_occurrences: v.max_occurrences,
        active: v.active,
        ...(admin ? { auto_issue: v.auto_issue } : toDrafts ? { auto_issue: false } : {}),
      })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(
      toDrafts
        ? "Schedule updated and switched to drafts for review — only an admin can re-time or resume one that issues itself."
        : "Schedule updated.",
      id,
    );
  } catch (e) {
    return fail(e);
  }
}

/**
 * Pause or resume. Resuming doesn't bill the periods that passed while it was
 * paused: the database moves next_run_on to the first run date from today
 * (0015 schedule_run_dates), which the message reports. A member resuming an
 * auto-issuing schedule turns auto-issue off with it (0027: resuming one is
 * an admin's call), so it comes back making drafts.
 */
export async function setScheduleActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("invoices");
    let toDrafts = false;
    if (active && !isApprover(profile)) {
      const { data: current } = await supabase
        .from("invoice_schedules")
        .select("auto_issue, active")
        .eq("id", id)
        .maybeSingle<Pick<InvoiceSchedule, "auto_issue" | "active">>();
      toDrafts = !!current?.auto_issue && !current.active;
    }
    const { data, error } = await supabase
      .from("invoice_schedules")
      .update(toDrafts ? { active, auto_issue: false } : { active })
      .eq("id", id)
      .select("id, next_run_on")
      .returns<{ id: string; next_run_on: string }[]>();
    if (error) throw error;
    mustAffect(data);
    refresh();
    const next = data?.[0]?.next_run_on;
    if (!active) return ok("Schedule paused — nothing will be generated until you resume it.", id);
    const when = next ? ` Next invoice ${formatDate(next)}; paused periods aren't billed.` : "";
    if (toDrafts) {
      return ok(`Schedule resumed and switched to drafts for review — only an admin can resume one that issues itself.${when}`, id);
    }
    return ok(next ? `Schedule resumed — next invoice ${formatDate(next)}. Paused periods aren't billed.` : "Schedule resumed.", id);
  } catch (e) {
    return fail(e);
  }
}

/** Invoices it already made stay; they just stop pointing at a schedule. */
export async function deleteSchedule(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase.from("invoice_schedules").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Schedule deleted. Invoices it already made are untouched.");
  } catch (e) {
    return fail(e);
  }
}

/** Generate every period that's due now (the daily cron does the same). */
export async function runRecurringNow(): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase.rpc("run_recurring_invoices");
    if (error) throw error;
    const n = Number(data ?? 0);
    refresh();
    return ok(n > 0 ? `Generated ${n} invoice${n === 1 ? "" : "s"}.` : "Nothing due — every schedule is up to date.");
  } catch (e) {
    return fail(e);
  }
}

/** Stop (or restart) the automatic reminders for one invoice (0038). */
export async function setInvoiceReminders(id: string, paused: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase.from("invoices").update({ reminders_paused: paused }).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(paused ? "No more reminders for this invoice." : "Reminders back on for this invoice.", id);
  } catch (e) {
    return fail(e);
  }
}
