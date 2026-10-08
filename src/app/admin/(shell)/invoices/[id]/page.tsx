import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession, requireModule } from "@/lib/admin/auth";
import { formatDate, todayISO } from "@/lib/admin/format";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { displayName, loadTeam } from "@/lib/admin/team";
import type { ActivityEntry } from "@/lib/admin/types";
import { Notice } from "@/components/admin/ui";
import { brandingFrom, businessFrom, docLabel, type DocumentEmail, type Invoice } from "@/lib/admin/invoice-types";
import InvoiceDetail, { type CreditNoteRow, type DetailTab, type RelatedLinks } from "./InvoiceDetail";
import { loadDocument, loadSettings } from "../data";

const TABS: DetailTab[] = ["preview", "payments", "comments", "activity"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const session = await getSession();
  if (!session?.profile) return { title: "Invoice" };
  const { id } = await params;
  const { data } = await session.supabase
    .from("invoices")
    .select("kind, number")
    .eq("id", id)
    .maybeSingle<Pick<Invoice, "kind" | "number">>();
  return { title: data ? docLabel(data) : "Invoice" };
}

/** One invoice or quote: the paper, its payments, the discussion and the trail. `?tab=` picks the tab. */
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; just?: string }>;
}) {
  const { supabase, profile } = await requireModule("invoices");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const bundle = await loadDocument(supabase, id);
  if (!bundle) notFound();
  const { invoice, items, payments } = bundle;
  const today = todayISO();

  const name = <T,>(q: PromiseLike<{ data: T | null }>) => Promise.resolve(q).then((r) => r.data);
  const [settings, team, { data: activity }, sourceQuote, converted, schedule, client, lead, creditNotes, credited, emails] = await Promise.all([
    loadSettings(supabase, profile.workspace),
    loadTeam(supabase),
    supabase
      .from("activity_log")
      .select("id, actor_id, action, entity_type, entity_id, entity_label, summary, changes, created_at")
      .eq("entity_type", "invoice")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(60)
      .returns<ActivityEntry[]>(),
    invoice.source_quote_id
      ? name(supabase.from("invoices").select("id, number").eq("id", invoice.source_quote_id).maybeSingle<{ id: string; number: string | null }>())
      : null,
    invoice.converted_invoice_id
      ? name(supabase.from("invoices").select("id, number").eq("id", invoice.converted_invoice_id).maybeSingle<{ id: string; number: string | null }>())
      : null,
    invoice.schedule_id
      ? name(supabase.from("invoice_schedules").select("id, name").eq("id", invoice.schedule_id).maybeSingle<{ id: string; name: string }>())
      : null,
    invoice.client_id && (canAccess(profile, "clients") || canAccess(profile, "crm"))
      ? name(supabase.from("clients").select("id, name").eq("id", invoice.client_id).maybeSingle<{ id: string; name: string }>())
      : null,
    invoice.lead_id && canAccess(profile, "crm")
      ? name(supabase.from("leads").select("id, name").eq("id", invoice.lead_id).maybeSingle<{ id: string; name: string }>())
      : null,
    invoice.kind === "invoice"
      ? name(
          supabase
            .from("invoices")
            .select("id, number, status, total, credit_reason, issue_date")
            .eq("credited_invoice_id", id)
            .order("issue_date", { ascending: true })
            .returns<CreditNoteRow[]>(),
        )
      : null,
    invoice.credited_invoice_id
      ? name(supabase.from("invoices").select("id, number").eq("id", invoice.credited_invoice_id).maybeSingle<{ id: string; number: string | null }>())
      : null,
    // Empty before 0036 — the select just fails quietly.
    name(
      supabase
        .from("document_emails")
        .select("id, kind, invoice_id, client_id, to_addresses, cc_addresses, subject, step, sent_by, sent_at")
        .eq("invoice_id", id)
        .order("sent_at", { ascending: false })
        .limit(50)
        .returns<DocumentEmail[]>(),
    ),
  ]);

  const related: RelatedLinks = {
    sourceQuote: sourceQuote ? { id: sourceQuote.id, label: sourceQuote.number ?? "Draft quote" } : null,
    converted: converted ? { id: converted.id, label: converted.number ?? "Draft invoice" } : null,
    schedule: schedule ? { id: schedule.id, label: schedule.name } : null,
    client: client && canAccess(profile, "clients") ? { id: client.id, label: client.name } : null,
    lead: lead ? { id: lead.id, label: lead.name } : null,
    credited: credited ? { id: credited.id, label: credited.number ?? "Draft invoice" } : null,
  };

  const quote = invoice.kind === "quote";
  const justNote =
    sp.just === "issued" && invoice.status !== "pending_approval"
      ? quote
        ? { title: `Quote ${invoice.number ?? ""} marked sent.`, body: "Record the client's answer here, then convert it to an invoice." }
        : invoice.kind === "credit_note"
          ? { title: `Credit note ${invoice.number} applied.`, body: "Its invoice's balance went down by the credit. Record a refund on the invoice if the client had already paid." }
          : { title: `Issued as ${invoice.number}.`, body: "Print it or save the PDF. Record payments here as they arrive." }
      : sp.just === "saved"
        ? { title: "Changes saved.", body: "The paper below is the updated version." }
        : null;

  return (
    <>
      {invoice.status === "pending_approval" && (
        <div className="mb-4">
          <Notice tone="warn" title="Sent for approval">
            It&apos;s above the approval limit, so an admin signs it off first. It gets its number when approved — you&apos;ll be
            notified either way.
          </Notice>
        </div>
      )}
      {invoice.status === "void" && (
        <div className="mb-4">
          <Notice tone="danger" title={`Voided${invoice.voided_at ? ` on ${formatDate(invoice.voided_at)}` : ""}`}>
            Nothing is owed on it. Duplicate it to bill again.
          </Notice>
        </div>
      )}
      {justNote && (
        <div className="mb-4">
          <Notice tone="info" title={justNote.title}>
            {justNote.body}
          </Notice>
        </div>
      )}
      <InvoiceDetail
        invoice={invoice}
        items={items}
        payments={payments}
        business={businessFrom(settings)}
        branding={brandingFrom(settings)}
        creditNotes={creditNotes ?? []}
        emails={emails ?? []}
        creditedNumber={credited?.number ?? null}
        isAdmin={isApprover(profile)}
        onlinePayments={!!settings.online_payments}
        people={team.filter((m) => canAccess({ ...m, workspace: profile.workspace }, "invoices"))}
        names={Object.fromEntries(team.map((m) => [m.id, displayName(m)]))}
        activity={activity ?? []}
        related={related}
        initialTab={TABS.includes(sp.tab as DetailTab) ? (sp.tab as DetailTab) : "preview"}
        today={today}
        canCrm={canAccess(profile, "crm")}
      />
    </>
  );
}
