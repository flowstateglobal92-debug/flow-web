import "server-only";

import type { Session } from "@/lib/admin/auth";
import { canAccess } from "@/lib/admin/modules";
import { loadTeam } from "@/lib/admin/team";
import type { Profile, TeamMember } from "@/lib/admin/types";
import {
  DEFAULT_SETTINGS,
  type ClientOption,
  type Invoice,
  type InvoiceItem,
  type InvoicePayment,
  type InvoiceSettings,
  type LeadOption,
} from "@/lib/admin/invoice-types";

/**
 * Reads shared by the invoice pages and the print page. Every one of them
 * tolerates a missing table or RPC (a migration that hasn't run yet) and
 * returns an empty value instead of throwing — the page shows an empty state.
 */

type Supabase = Session["supabase"];

/** The workspace's business block, numbering and defaults (seeded by 0013). */
export async function loadSettings(supabase: Supabase, workspace: string): Promise<InvoiceSettings> {
  const { data } = await supabase
    .from("invoice_settings")
    .select("*")
    .eq("workspace", workspace)
    .maybeSingle<InvoiceSettings>();
  return { ...DEFAULT_SETTINGS, workspace, ...stripNulls(data) };
}

/** Defaults win over nulls only where a null would break the paper (name, currency, labels). */
function stripNulls(row: InvoiceSettings | null) {
  if (!row) return {};
  const out: Partial<InvoiceSettings> = { ...row };
  if (!row.business_name) delete out.business_name;
  if (!row.default_currency) delete out.default_currency;
  if (!row.tax_label) delete out.tax_label;
  if (!row.invoice_prefix) delete out.invoice_prefix;
  if (!row.quote_prefix) delete out.quote_prefix;
  if (row.default_due_days == null) delete out.default_due_days;
  return out;
}

export async function loadClients(supabase: Supabase): Promise<ClientOption[]> {
  const { data } = await supabase
    .from("clients")
    .select("id, name, company, email, phone, address, city, country")
    .neq("status", "archived")
    .order("name", { ascending: true })
    .limit(500)
    .returns<ClientOption[]>();
  return data ?? [];
}

/** Leads are CRM rows — only offered to people who can open the CRM. */
export async function loadLeads(supabase: Supabase, profile: Profile): Promise<LeadOption[]> {
  if (!canAccess(profile, "crm")) return [];
  const { data } = await supabase
    .from("leads")
    .select("id, name, company, email, phone, client_id")
    .order("updated_at", { ascending: false })
    .limit(300)
    .returns<LeadOption[]>();
  return data ?? [];
}

/** Teammates who can be an invoice's owner or be @mentioned on one. */
export async function loadInvoicePeople(supabase: Supabase, profile: Profile): Promise<TeamMember[]> {
  const team = await loadTeam(supabase);
  return team.filter((m) => canAccess({ ...m, workspace: profile.workspace }, "invoices"));
}

export async function loadDocument(
  supabase: Supabase,
  id: string,
): Promise<{ invoice: Invoice; items: InvoiceItem[]; payments: InvoicePayment[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [{ data: invoice }, { data: items }, { data: payments }] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).maybeSingle<Invoice>(),
    supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position").returns<InvoiceItem[]>(),
    supabase
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", id)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .returns<InvoicePayment[]>(),
  ]);
  if (!invoice) return null;
  return { invoice, items: items ?? [], payments: payments ?? [] };
}

/**
 * Catch up recurring schedules before a list renders, so a missed cron run
 * never hides an invoice that should exist. Idempotent in the database
 * (unique schedule_id + period_start); errors are ignored.
 */
export async function runRecurring(supabase: Supabase) {
  const { data, error } = await supabase.rpc("run_recurring_invoices");
  return error ? 0 : Number(data ?? 0);
}

/** `YYYY-MM-DD` bounds for the KPI period select. */
export function periodBounds(period: string, today: string): { from: string | null; to: string | null } {
  const [y, m] = today.split("-").map(Number);
  if (period === "month") {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }
  if (period === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: null, to: null };
}

/** PostgREST `or=` filters break on commas and brackets — keep search terms plain. */
export const searchTerm = (q: string) => q.replace(/[,()%*\\]/g, " ").trim();
