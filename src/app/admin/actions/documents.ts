"use server";

import { revalidatePath } from "next/cache";
import { authorize, type Session } from "@/lib/admin/auth";
import { formatDate, num, todayISO } from "@/lib/admin/format";
import { DEFAULT_BODY, DEFAULT_SUBJECT, fillTemplate, firstName, type MailKind, type MailVars } from "@/lib/admin/document-mail";
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
import { displayName } from "@/lib/admin/format";
import { pdfFileName, renderDocumentPdf, renderStatementPdf, statementFileName } from "@/lib/admin/pdf/render";
import { readStatement, type Statement } from "@/lib/admin/statement";
import { sendMessage } from "@/lib/email/mailbox";
import { SITE } from "@/lib/site";
import { fail, ok, type ActionResult } from "./shared";

/**
 * Documents leaving the building: as a PDF download, or by email from the
 * company mailbox with the PDF attached. The PDF is rendered here (the
 * website's server, or the desktop's main process); the mailbox module sends
 * it (Resend on the website, the mail function on the desktop). Every send is
 * recorded in document_emails (0036).
 */

type Supabase = Session["supabase"];

async function loadForPaper(supabase: Supabase, workspace: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [{ data: invoice }, { data: items }, { data: settings }] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).maybeSingle<Invoice>(),
    supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position").returns<InvoiceItem[]>(),
    supabase.from("invoice_settings").select("*").eq("workspace", workspace).maybeSingle<InvoiceSettings>(),
  ]);
  if (!invoice) return null;
  const credited = invoice.credited_invoice_id
    ? (await supabase.from("invoices").select("number").eq("id", invoice.credited_invoice_id).maybeSingle<{ number: string | null }>()).data
    : null;
  const cfg: InvoiceSettings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  return { invoice, items: items ?? [], settings: cfg, credited };
}

async function render(bundle: NonNullable<Awaited<ReturnType<typeof loadForPaper>>>) {
  const doc = documentFromRow(bundle.invoice, bundle.items, bundle.credited);
  const bytes = await renderDocumentPdf({
    doc,
    business: businessFrom(bundle.settings),
    branding: brandingFrom(bundle.settings),
    today: todayISO(),
  });
  return { bytes, filename: pdfFileName(doc) };
}

const kindOf = (invoice: Pick<Invoice, "kind">): MailKind =>
  invoice.kind === "quote" ? "quote" : invoice.kind === "credit_note" ? "credit_note" : "invoice";

/** The pay-online link for an open invoice when online payment is on (0039), else null. */
async function payLink(supabase: Supabase, invoice: Invoice, settings: InvoiceSettings) {
  if (!settings.online_payments || invoice.kind !== "invoice" || !["issued", "partially_paid"].includes(invoice.status)) return null;
  const { data, error } = await supabase.rpc("invoice_pay_link", { p_id: invoice.id });
  return error || !data ? null : `${SITE.url}/pay/${String(data)}`;
}

/** "Payment link": the invoice's pay-online page, to copy into a message. */
export async function paymentLink(id: string): Promise<ActionResult & { url?: string }> {
  try {
    const { supabase } = await authorize("invoices");
    const { data, error } = await supabase.rpc("invoice_pay_link", { p_id: id });
    if (error) throw error;
    revalidatePath("/admin/invoices", "layout");
    return { ok: true, url: `${SITE.url}/pay/${String(data)}`, message: "Payment link copied." };
  } catch (e) {
    return fail(e);
  }
}

/** The PDF of a document, for "Download PDF" (base64 — the window turns it into a file). */
export async function documentPdf(id: string): Promise<ActionResult & { filename?: string; base64?: string }> {
  try {
    const { supabase, profile } = await authorize("invoices");
    const bundle = await loadForPaper(supabase, profile.workspace, id);
    if (!bundle) return { ok: false, error: "That document isn't available." };
    const { bytes, filename } = await render(bundle);
    return { ok: true, filename, base64: Buffer.from(bytes).toString("base64") };
  } catch (e) {
    return fail(e);
  }
}

export type EmailDraft = {
  to: string;
  cc: string;
  subject: string;
  message: string;
  filename: string;
  /** A draft has to be issued (numbered) before it goes out. */
  needsIssue: boolean;
};

/** The vars every document email fills its wording with. */
function varsFor(invoice: Invoice, settings: InvoiceSettings, sender: string, credited: { number: string | null } | null): MailVars {
  const money = (v: number) => docMoney(v, invoice.currency);
  const total = num(invoice.total);
  return {
    client: invoice.bill_to_name,
    first_name: firstName(invoice.bill_to_name),
    number: invoice.number ?? "(number on issue)",
    amount: money(total),
    balance: money(Math.max(0, total - num(invoice.amount_paid) - num(invoice.credited_total))),
    due_date: invoice.due_date ? formatDate(invoice.due_date) : "on receipt",
    valid_until: invoice.valid_until ? formatDate(invoice.valid_until) : "—",
    credited_number: credited?.number ?? "",
    business: settings.business_name,
    sender,
    pay_link: null,
  };
}

const wording = (settings: InvoiceSettings, kind: MailKind) => {
  const pick = { invoice: "invoice", quote: "quote", credit_note: "credit" }[kind as "invoice" | "quote" | "credit_note"];
  const subject = pick ? (settings[`email_${pick}_subject` as keyof InvoiceSettings] as string | null) : null;
  const body = pick ? (settings[`email_${pick}_body` as keyof InvoiceSettings] as string | null) : null;
  return { subject: subject?.trim() || DEFAULT_SUBJECT[kind], body: body?.trim() || DEFAULT_BODY[kind] };
};

/** What the Email dialog opens with: recipients, subject and message, filled in. */
export async function documentEmailDraft(id: string): Promise<ActionResult & { draft?: EmailDraft }> {
  try {
    const { supabase, profile } = await authorize("invoices");
    const bundle = await loadForPaper(supabase, profile.workspace, id);
    if (!bundle) return { ok: false, error: "That document isn't available." };
    const { invoice, settings, credited } = bundle;
    let to = invoice.bill_to_email?.trim() ?? "";
    if (!to && invoice.client_id) {
      const { data: client } = await supabase.from("clients").select("email").eq("id", invoice.client_id).maybeSingle<{ email: string | null }>();
      to = client?.email?.trim() ?? "";
    }
    const kind = kindOf(invoice);
    const w = wording(settings, kind);
    const vars = { ...varsFor(invoice, settings, displayName(profile), credited), pay_link: await payLink(supabase, invoice, settings) };
    const doc = documentFromRow(invoice, bundle.items, credited);
    return {
      ok: true,
      draft: {
        to,
        cc: "",
        subject: fillTemplate(w.subject, vars),
        message: fillTemplate(w.body, vars),
        filename: pdfFileName(doc),
        needsIssue: invoice.status === "draft",
      },
    };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Send a document with its PDF. A draft is issued first when asked (so it
 * goes out numbered); a quote that's issued becomes "sent".
 */
export async function emailDocument(
  id: string,
  input: { to: string; cc: string; subject: string; message: string; issueFirst?: boolean },
): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("invoices");
    let bundle = await loadForPaper(supabase, profile.workspace, id);
    if (!bundle) return { ok: false, error: "That document isn't available." };

    if (bundle.invoice.status === "pending_approval") return { ok: false, error: "It's waiting for approval — it can go out once an admin issues it." };
    if (bundle.invoice.status === "void") return { ok: false, error: "A void document isn't sent." };
    if (bundle.invoice.status === "draft") {
      if (!input.issueFirst) return { ok: false, error: "Issue it first, so it goes out with its number." };
      const { data, error } = await supabase.rpc("issue_document", { p_id: id });
      if (error) throw error;
      if ((data as { status?: string } | null)?.status === "pending_approval") {
        revalidatePath("/admin/invoices", "layout");
        return { ok: false, error: "It needs an admin's approval first — it's been sent for approval, not to the client." };
      }
      bundle = await loadForPaper(supabase, profile.workspace, id);
      if (!bundle) return { ok: false, error: "That document isn't available." };
    }

    // The number may have arrived with the issue: put it where the wording said "(number on issue)".
    const subject = input.subject.replace("(number on issue)", bundle.invoice.number ?? "");
    const message = input.message.replace("(number on issue)", bundle.invoice.number ?? "");
    const { bytes, filename } = await render(bundle);
    const sent = await sendMessage({
      to: input.to,
      cc: input.cc,
      subject,
      body: message,
      attachments: [{ filename, content: bytes, contentType: "application/pdf" }],
      about: { module: "invoices", invoiceId: id },
    });

    const { error: logError } = await supabase.from("document_emails").insert({
      kind: "document",
      invoice_id: id,
      to_addresses: sent.to,
      cc_addresses: sent.cc,
      subject,
      resend_id: sent.id,
    });
    revalidatePath("/admin/invoices", "layout");
    // The message went; a missing history line shouldn't read as a failure.
    if (logError) return ok(`Sent to ${sent.to.join(", ")} — but it couldn't be added to the history.`, id);
    return ok(`Sent to ${sent.to.join(", ")}.`, id);
  } catch (e) {
    return fail(e);
  }
}

/** The documents' email history, newest first. */
export async function documentEmails(id: string) {
  const { supabase } = await authorize("invoices");
  const { data } = await supabase
    .from("document_emails")
    .select("id, kind, invoice_id, client_id, to_addresses, cc_addresses, subject, step, sent_by, sent_at")
    .eq("invoice_id", id)
    .order("sent_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

/* ─────────────────────────────── statements ─────────────────────────────── */

type StatementArgs = { clientId: string; from: string; to: string; currency?: string | null };

async function loadStatement(supabase: Supabase, workspace: string, args: StatementArgs) {
  const [{ data, error }, { data: settings }] = await Promise.all([
    supabase.rpc("client_statement", {
      p_client: args.clientId,
      p_from: args.from,
      p_to: args.to,
      p_currency: args.currency || null,
    }),
    supabase.from("invoice_settings").select("*").eq("workspace", workspace).maybeSingle<InvoiceSettings>(),
  ]);
  if (error) throw error;
  const statement = readStatement(data);
  if (!statement) throw new Error("That client isn't available.");
  return { statement, settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) } as InvoiceSettings };
}

/** The figures, for the statement page. */
export async function clientStatement(args: StatementArgs): Promise<ActionResult & { statement?: Statement }> {
  try {
    const { supabase, profile } = await authorize("invoices");
    const { statement } = await loadStatement(supabase, profile.workspace, args);
    return { ok: true, statement };
  } catch (e) {
    return fail(e);
  }
}

export async function statementPdf(args: StatementArgs): Promise<ActionResult & { filename?: string; base64?: string }> {
  try {
    const { supabase, profile } = await authorize("invoices");
    const { statement, settings } = await loadStatement(supabase, profile.workspace, args);
    const bytes = await renderStatementPdf({ statement, business: businessFrom(settings), branding: brandingFrom(settings) });
    return { ok: true, filename: statementFileName(statement), base64: Buffer.from(bytes).toString("base64") };
  } catch (e) {
    return fail(e);
  }
}

export async function statementEmailDraft(args: StatementArgs): Promise<ActionResult & { draft?: EmailDraft }> {
  try {
    const { supabase, profile } = await authorize("invoices");
    const { statement, settings } = await loadStatement(supabase, profile.workspace, args);
    const vars: MailVars = {
      client: statement.client.name,
      first_name: firstName(statement.client.name),
      balance: docMoney(statement.closing, statement.currency),
      business: settings.business_name,
      sender: displayName(profile),
    };
    return {
      ok: true,
      draft: {
        to: statement.client.email ?? "",
        cc: "",
        subject: fillTemplate(DEFAULT_SUBJECT.statement, vars),
        message: fillTemplate(DEFAULT_BODY.statement, vars),
        filename: statementFileName(statement),
        needsIssue: false,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function emailStatement(
  args: StatementArgs,
  input: { to: string; cc: string; subject: string; message: string },
): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("invoices");
    const { statement, settings } = await loadStatement(supabase, profile.workspace, args);
    const bytes = await renderStatementPdf({ statement, business: businessFrom(settings), branding: brandingFrom(settings) });
    const sent = await sendMessage({
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      body: input.message,
      attachments: [{ filename: statementFileName(statement), content: bytes, contentType: "application/pdf" }],
      about: { module: "clients", clientId: args.clientId },
    });
    await supabase.from("document_emails").insert({
      kind: "statement",
      client_id: args.clientId,
      to_addresses: sent.to,
      cc_addresses: sent.cc,
      subject: input.subject,
      resend_id: sent.id,
    });
    revalidatePath(`/admin/clients/${args.clientId}`);
    return ok(`Statement sent to ${sent.to.join(", ")}.`);
  } catch (e) {
    return fail(e);
  }
}
