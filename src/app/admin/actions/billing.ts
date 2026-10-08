"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/admin/auth";
import { num } from "@/lib/admin/format";
import { round2, round3 } from "@/lib/admin/invoice-math";
import { isApprover } from "@/lib/admin/modules";
import { checkNumberFormat, type NumberReset, type NumberedKind } from "@/lib/admin/numbering";
import type { DocumentLayout, LogoMode } from "@/lib/admin/invoice-types";
import { fail, mustAffect, ok, text, type ActionResult } from "./shared";

/**
 * Invoice settings beyond the business block: document numbering (0030),
 * tax rates (0032), the catalogue (0034) and branding (0035). Settings and
 * rates are admins' (RLS says so too); the catalogue is everyone's with
 * Invoices.
 */

function refresh() {
  revalidatePath("/admin/invoices", "layout");
  revalidatePath("/admin/reports", "layout");
}

async function admin() {
  const session = await authorize("invoices");
  if (!isApprover(session.profile)) throw new Error("Only admins can change invoice settings.");
  return session;
}

/* ───────────────────────────────── numbering ─────────────────────────────── */

const RESETS: NumberReset[] = ["never", "year", "tax_year", "month"];
const KINDS: NumberedKind[] = ["invoice", "quote", "credit_note"];

export async function saveNumbering(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, profile } = await admin();
    const prefix = (k: string, fallback: string) =>
      (text(formData, k) || fallback).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || fallback;
    const formats = {
      invoice_number_format: text(formData, "invoice_number_format") || "{PREFIX}-{SEQ:4}",
      quote_number_format: text(formData, "quote_number_format") || "{PREFIX}-{SEQ:4}",
      credit_note_number_format: text(formData, "credit_note_number_format") || "{PREFIX}-{SEQ:4}",
    };
    for (const f of Object.values(formats)) {
      const problem = checkNumberFormat(f);
      if (problem) return { ok: false, error: problem };
    }
    const reset = text(formData, "number_reset") as NumberReset;
    if (!RESETS.includes(reset)) return { ok: false, error: "Pick when numbering starts again." };

    const { data, error } = await supabase
      .from("invoice_settings")
      .update({
        invoice_prefix: prefix("invoice_prefix", "INV"),
        quote_prefix: prefix("quote_prefix", "QT"),
        credit_note_prefix: prefix("credit_note_prefix", "CN"),
        ...formats,
        number_reset: reset,
      })
      .eq("workspace", profile.workspace)
      .select("workspace");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Numbering saved — the next documents use it.");
  } catch (e) {
    return fail(e);
  }
}

/** The running number the next document of a kind starts from. */
export async function setNextNumber(kind: NumberedKind, next: number): Promise<ActionResult> {
  try {
    const { supabase } = await admin();
    if (!KINDS.includes(kind)) return { ok: false, error: "Unknown document type." };
    const n = Math.floor(num(next));
    if (!(n >= 1 && n <= 99_999_999)) return { ok: false, error: "The next number must be between 1 and 99,999,999." };
    const { data, error } = await supabase.rpc("set_next_document_number", { p_kind: kind, p_next: n });
    if (error) throw error;
    refresh();
    return ok(`The next one will be ${String(data)}.`);
  } catch (e) {
    return fail(e);
  }
}

/** What each kind's next number will be if issued today (nothing is used up). */
export async function previewNumbers(): Promise<Record<NumberedKind, string | null>> {
  const { supabase } = await authorize("invoices");
  const out = { invoice: null, quote: null, credit_note: null } as Record<NumberedKind, string | null>;
  await Promise.all(
    KINDS.map(async (k) => {
      const { data, error } = await supabase.rpc("next_document_number", { p_kind: k });
      out[k] = error ? null : String(data);
    }),
  );
  return out;
}

/* ───────────────────────────────── tax rates ─────────────────────────────── */

export type TaxRateInput = {
  name: string;
  rate: number | string;
  compound: boolean;
  is_default: boolean;
  active: boolean;
  note?: string | null;
};

export async function saveTaxRate(id: string | null, input: TaxRateInput): Promise<ActionResult> {
  try {
    const { supabase } = await admin();
    const name = (input.name ?? "").trim();
    if (!name) return { ok: false, error: "Name the tax — VAT, SSCL…" };
    if (name.length > 40) return { ok: false, error: "Keep the name to 40 characters." };
    const rate = round3(num(input.rate));
    if (String(input.rate ?? "").trim() === "" || rate < 0 || rate > 100) {
      return { ok: false, error: "The rate must be between 0 and 100%." };
    }
    const row = {
      name,
      rate,
      compound: !!input.compound,
      is_default: !!input.is_default,
      active: input.active !== false,
      note: (input.note ?? "").trim().slice(0, 300) || null,
    };
    if (id) {
      const { data, error } = await supabase.from("tax_rates").update(row).eq("id", id).select("id");
      if (error) throw error;
      mustAffect(data);
    } else {
      const { count } = await supabase.from("tax_rates").select("id", { count: "exact", head: true });
      const { error } = await supabase.from("tax_rates").insert({ ...row, position: count ?? 0 });
      if (error) throw error;
    }
    refresh();
    return ok(id ? "Tax rate saved. Documents already made keep the rate they had." : `${name} ${rate}% added.`);
  } catch (e) {
    return fail(e);
  }
}

/** Lines keep a copy of their taxes, so a rate can go without touching any document. */
export async function deleteTaxRate(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await admin();
    const { data, error } = await supabase.from("tax_rates").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Tax rate removed. Documents that used it keep it.");
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────────────── branding ──────────────────────────────── */

export type BrandingInput = {
  logo_mode: LogoMode;
  /** data: URL, or null to remove a custom logo. undefined leaves it as it is. */
  logo_data?: string | null;
  accent_color: string;
  document_layout: DocumentLayout;
  footer_text: string | null;
};

const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export async function saveBranding(input: BrandingInput): Promise<ActionResult> {
  try {
    const { supabase, profile } = await admin();
    if (!["brand", "custom", "none"].includes(input.logo_mode)) return { ok: false, error: "Pick a logo option." };
    if (!["classic", "modern", "compact"].includes(input.document_layout)) return { ok: false, error: "Pick a layout." };
    if (!/^#[0-9a-f]{6}$/i.test(input.accent_color)) return { ok: false, error: "Pick an accent colour." };
    const footer = (input.footer_text ?? "").trim();
    if (footer.length > 500) return { ok: false, error: "Keep the footer to 500 characters." };

    const patch: Record<string, unknown> = {
      logo_mode: input.logo_mode,
      accent_color: input.accent_color.toUpperCase(),
      document_layout: input.document_layout,
      footer_text: footer || null,
    };
    if (input.logo_data !== undefined) {
      if (input.logo_data !== null) {
        if (!LOGO.test(input.logo_data)) return { ok: false, error: "The logo must be a PNG, JPEG or WebP image." };
        if (input.logo_data.length > 420_000) return { ok: false, error: "That logo is too large — keep it under about 300 KB." };
      }
      patch.logo_data = input.logo_data;
    }
    if (input.logo_mode === "custom" && input.logo_data === null) {
      return { ok: false, error: "Upload a logo, or pick the Flow State mark or just the name." };
    }

    const { data, error } = await supabase
      .from("invoice_settings")
      .update(patch)
      .eq("workspace", profile.workspace)
      .select("workspace");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Branding saved — every document, PDF and print uses it.");
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────────────── catalogue ─────────────────────────────── */

export type CatalogueInput = {
  name: string;
  details: string | null;
  kind: "service" | "product";
  code: string | null;
  unit: string | null;
  unit_price: number | string;
  currency: string;
  prices: Record<string, number | string>;
  tax_rate_ids: string[];
  active: boolean;
};

export async function saveCatalogueItem(id: string | null, input: CatalogueInput): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const name = (input.name ?? "").trim();
    if (!name) return { ok: false, error: "Name it — that's the line's description." };
    if (name.length > 200) return { ok: false, error: "Keep the name to 200 characters." };
    const price = round2(num(input.unit_price));
    if (price < 0) return { ok: false, error: "The price can't be negative." };
    const currency = (input.currency || "LKR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "Pick a currency." };
    const prices: Record<string, number> = {};
    for (const [c, v] of Object.entries(input.prices ?? {})) {
      const code = c.toUpperCase();
      if (code === currency || !/^[A-Z]{3}$/.test(code) || String(v ?? "").trim() === "") continue;
      const p = round2(num(v));
      if (p < 0) return { ok: false, error: `The ${code} price can't be negative.` };
      prices[code] = p;
    }
    const ids = [...new Set((input.tax_rate_ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 4);
    const row = {
      name,
      details: (input.details ?? "").trim().slice(0, 2000) || null,
      kind: input.kind === "product" ? "product" : "service",
      code: (input.code ?? "").trim().slice(0, 40) || null,
      unit: (input.unit ?? "").trim().slice(0, 20) || null,
      unit_price: price,
      currency,
      prices,
      tax_rate_ids: ids,
      active: input.active !== false,
    };
    if (id) {
      const { data, error } = await supabase.from("catalogue_items").update(row).eq("id", id).select("id");
      if (error) throw error;
      mustAffect(data);
    } else {
      const { count } = await supabase.from("catalogue_items").select("id", { count: "exact", head: true });
      const { error } = await supabase.from("catalogue_items").insert({ ...row, position: count ?? 0 });
      if (error) throw error;
    }
    refresh();
    return ok(id ? "Saved. Documents already made keep their own lines." : `${name} added to the catalogue.`);
  } catch (e) {
    return fail(e);
  }
}

export async function setCatalogueItemActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase.from("catalogue_items").update({ active }).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(active ? "Back in the catalogue." : "Hidden from the editor — it's kept here under Hidden.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCatalogueItem(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase.from("catalogue_items").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok("Removed from the catalogue. Documents that used it keep their lines.");
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────────── emails & reminders ─────────────────────────── */

export type EmailSettingsInput = {
  reminders_enabled: boolean;
  /** "3, 7, 14" — days after the due date. */
  reminder_days: string;
  templates: Record<"invoice" | "quote" | "credit" | "reminder", { subject: string; body: string }>;
};

export async function saveEmailSettings(input: EmailSettingsInput): Promise<ActionResult> {
  try {
    const { supabase, profile } = await admin();
    const days = [...new Set(input.reminder_days.split(/[^0-9]+/).filter(Boolean).map(Number))]
      .filter((d) => d >= 1 && d <= 365)
      .sort((a, b) => a - b);
    if (days.length === 0) return { ok: false, error: "Give at least one day after the due date — 3, 7, 14 for example." };
    if (days.length > 6) return { ok: false, error: "Six reminders at most." };
    const patch: Record<string, unknown> = { reminders_enabled: !!input.reminders_enabled, reminder_days: days };
    for (const [kind, t] of Object.entries(input.templates)) {
      const subject = (t.subject ?? "").trim();
      const body = (t.body ?? "").trim();
      if (subject.length > 200) return { ok: false, error: "Keep subjects to 200 characters." };
      if (body.length > 4000) return { ok: false, error: "Keep messages to 4,000 characters." };
      patch[`email_${kind}_subject`] = subject || null;
      patch[`email_${kind}_body`] = body || null;
    }
    const { data, error } = await supabase.from("invoice_settings").update(patch).eq("workspace", profile.workspace).select("workspace");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(
      input.reminders_enabled
        ? `Saved. Overdue invoices get reminders ${days.map((d) => `+${d}`).join(", ")} days after they're due.`
        : "Saved. Automatic reminders are off.",
    );
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────────────── payments ──────────────────────────────── */

export type PaymentSettingsInput = { online_payments: boolean; payhere_enabled: boolean; stripe_enabled: boolean };

export async function savePaymentSettings(input: PaymentSettingsInput): Promise<ActionResult> {
  try {
    const { supabase, profile } = await admin();
    const { data, error } = await supabase
      .from("invoice_settings")
      .update({
        online_payments: !!input.online_payments,
        payhere_enabled: !!input.payhere_enabled,
        stripe_enabled: !!input.stripe_enabled,
      })
      .eq("workspace", profile.workspace)
      .select("workspace");
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(input.online_payments ? "Online payment is on — invoices get a pay link." : "Online payment is off.");
  } catch (e) {
    return fail(e);
  }
}
