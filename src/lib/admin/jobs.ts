import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, num, todayISO } from "@/lib/admin/format";
import { DEFAULT_BODY, DEFAULT_SUBJECT, fillTemplate, firstName } from "@/lib/admin/document-mail";
import {
  DEFAULT_SETTINGS,
  brandingFrom,
  businessFrom,
  docMoney,
  documentFromRow,
  type Invoice,
  type InvoiceItem,
  type InvoiceSettings,
} from "@/lib/admin/invoice-types";
import { pdfFileName, renderDocumentPdf, renderStatementPdf, statementFileName } from "@/lib/admin/pdf/render";
import { monthStart, plusDays } from "@/lib/admin/reports";
import { readStatement } from "@/lib/admin/statement";
import { randomBytes } from "node:crypto";
import { sendMessage } from "@/lib/email/mailbox";
import { SITE } from "@/lib/site";

/**
 * The work nobody clicks for, run by /api/jobs/run every hour (a Netlify
 * scheduled function calls it with CRON_SECRET):
 *   · overdue reminders (0038) — 09:00–18:00 Colombo, the step each invoice
 *     is due, with its PDF;
 *   · monthly statements (0037) — on the 1st, for the month before, to
 *     clients who asked for them and owe something;
 *   · recurring bills (0040) — every period that's come due becomes a bill.
 * Service role: it reads across RLS, and only ever acts on the live
 * workspace (the SQL that picks the work says so). Each item stands alone —
 * one failure is reported and the rest carry on. Repeating a run is safe:
 * what was sent is recorded in document_emails and never picked again.
 */

export type JobReport = { reminders: number; statements: number; bills: number; skipped: string[]; errors: string[] };

const colombo = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", hour12: false }).formatToParts(d);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
};

/** The invoice's pay-online link when online payment is on (0039), made if it has none. */
async function reminderPayLink(invoice: Invoice, settings: InvoiceSettings) {
  if (!settings.online_payments) return null;
  let token = invoice.pay_token ?? null;
  if (!token) {
    const db = createAdminClient();
    await db.from("invoices").update({ pay_token: randomBytes(16).toString("hex") }).eq("id", invoice.id).is("pay_token", null);
    // Whichever token won (a link made at the same moment elsewhere would).
    const { data } = await db.from("invoices").select("pay_token").eq("id", invoice.id).maybeSingle<{ pay_token: string | null }>();
    token = data?.pay_token ?? null;
  }
  return token ? `${SITE.url}/pay/${token}` : null;
}

export async function runJobs(now = new Date()): Promise<JobReport> {
  const report: JobReport = { reminders: 0, statements: 0, bills: 0, skipped: [], errors: [] };
  const db = createAdminClient();

  /* ── recurring bills (0040): raise whatever is due ── */
  const raised = await db.rpc("run_bill_schedules_all");
  if (raised.error) report.errors.push(`bills: ${raised.error.message}`);
  else report.bills = Number(raised.data ?? 0);

  if (!process.env.RESEND_API_KEY) {
    report.skipped.push("No RESEND_API_KEY — nothing can be emailed.");
    await db.from("job_runs").upsert({ name: "hourly", last_run_at: new Date().toISOString(), report }, { onConflict: "name" });
    return report;
  }
  const today = todayISO();
  const hour = colombo(now);

  const settingsCache = new Map<string, InvoiceSettings>();
  const settingsFor = async (workspace: string) => {
    if (!settingsCache.has(workspace)) {
      const { data } = await db.from("invoice_settings").select("*").eq("workspace", workspace).maybeSingle<InvoiceSettings>();
      settingsCache.set(workspace, { ...DEFAULT_SETTINGS, ...(data ?? {}) });
    }
    return settingsCache.get(workspace)!;
  };

  /* ── reminders ── */
  if (hour >= 9 && hour < 18) {
    const { data: due, error } = await db.rpc("reminders_due", { p_today: today });
    if (error) report.errors.push(`reminders: ${error.message}`);
    for (const r of (due ?? []) as { invoice_id: string; workspace: string; step: number; days_overdue: number; email: string }[]) {
      try {
        const [{ data: invoice }, { data: items }] = await Promise.all([
          db.from("invoices").select("*").eq("id", r.invoice_id).single<Invoice>(),
          db.from("invoice_items").select("*").eq("invoice_id", r.invoice_id).order("position").returns<InvoiceItem[]>(),
        ]);
        if (!invoice) continue;
        const settings = await settingsFor(r.workspace);
        const doc = documentFromRow(invoice, items ?? []);
        const bytes = await renderDocumentPdf({ doc, business: businessFrom(settings), branding: brandingFrom(settings), today });
        const money = (v: number) => docMoney(v, invoice.currency);
        const vars = {
          client: invoice.bill_to_name,
          first_name: firstName(invoice.bill_to_name),
          number: invoice.number ?? "",
          amount: money(num(invoice.total)),
          balance: money(num(invoice.balance_due)),
          due_date: invoice.due_date ? formatDate(invoice.due_date) : "",
          days_overdue: String(r.days_overdue),
          business: settings.business_name,
          sender: settings.business_name,
          pay_link: await reminderPayLink(invoice, settings),
        };
        const subject = fillTemplate(settings.email_reminder_subject?.trim() || DEFAULT_SUBJECT.reminder, vars);
        const sent = await sendMessage({
          to: r.email,
          subject,
          body: fillTemplate(settings.email_reminder_body?.trim() || DEFAULT_BODY.reminder, vars),
          attachments: [{ filename: pdfFileName(doc), content: bytes, contentType: "application/pdf" }],
          about: { module: "invoices", invoiceId: invoice.id },
        });
        const { error: logError } = await db.from("document_emails").insert({
          kind: "reminder",
          invoice_id: invoice.id,
          to_addresses: sent.to,
          subject,
          step: r.step,
          resend_id: sent.id,
        });
        if (logError) report.errors.push(`reminder ${invoice.number}: sent, but not recorded — ${logError.message}`);
        report.reminders++;
      } catch (e) {
        report.errors.push(`reminder ${r.invoice_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    report.skipped.push("Reminders go out between 09:00 and 18:00 Colombo.");
  }

  /* ── monthly statements ── */
  if (today.endsWith("-01") && hour >= 9) {
    const { data: due, error } = await db.rpc("statements_due", { p_day: today });
    if (error) report.errors.push(`statements: ${error.message}`);
    const from = monthStart(today, -1);
    const to = plusDays(today, -1);
    for (const r of (due ?? []) as { client_id: string; workspace: string; email: string; currency: string }[]) {
      try {
        const { data, error: stError } = await db.rpc("client_statement", { p_client: r.client_id, p_from: from, p_to: to, p_currency: r.currency });
        if (stError) throw stError;
        const statement = readStatement(data);
        if (!statement) continue;
        const settings = await settingsFor(r.workspace);
        const bytes = await renderStatementPdf({ statement, business: businessFrom(settings), branding: brandingFrom(settings) });
        const vars = {
          client: statement.client.name,
          first_name: firstName(statement.client.name),
          balance: docMoney(statement.closing, statement.currency),
          business: settings.business_name,
          sender: settings.business_name,
        };
        const subject = fillTemplate(DEFAULT_SUBJECT.statement, vars);
        const sent = await sendMessage({
          to: r.email,
          subject,
          body: fillTemplate(DEFAULT_BODY.statement, vars),
          attachments: [{ filename: statementFileName(statement), content: bytes, contentType: "application/pdf" }],
          about: { module: "clients", clientId: r.client_id },
        });
        await db.from("document_emails").insert({
          kind: "statement",
          client_id: r.client_id,
          to_addresses: sent.to,
          subject,
          resend_id: sent.id,
        });
        report.statements++;
      } catch (e) {
        report.errors.push(`statement ${r.client_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  await db.from("job_runs").upsert({ name: "hourly", last_run_at: new Date().toISOString(), report }, { onConflict: "name" });
  return report;
}
