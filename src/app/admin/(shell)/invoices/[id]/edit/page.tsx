import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/admin/auth";
import { num, todayISO } from "@/lib/admin/format";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { displayName } from "@/lib/admin/team";
import { Icon } from "@/components/admin/icons";
import { Notice } from "@/components/admin/ui";
import InvoiceEditor from "@/components/admin/invoice/InvoiceEditor";
import { linkButton } from "@/components/admin/invoice/parts";
import { docLabel, editorDocFromRow } from "@/lib/admin/invoice-types";
import { loadClients, loadDocument, loadInvoicePeople, loadLeads, loadSettings } from "../../data";

export const metadata: Metadata = { title: "Edit invoice" };

const JUST: Record<string, { tone: "info" | "warn"; title: string; body: string }> = {
  draft: { tone: "info", title: "Draft saved.", body: "It's in your drafts — issue it when it's ready." },
  scheduled: {
    tone: "info",
    title: "Draft saved and the schedule is set.",
    body: "This is the first invoice; the next ones appear on the Recurring tab's dates.",
  },
  partial: {
    tone: "warn",
    title: "Saved as a draft — the last step didn't go through.",
    body: "Check the details and try again; the reason shows when you retry.",
  },
};

export default async function EditInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ just?: string }>;
}) {
  const { supabase, profile } = await requireModule("invoices");
  const [{ id }, { just }] = await Promise.all([params, searchParams]);
  const bundle = await loadDocument(supabase, id);
  if (!bundle) notFound();
  const { invoice, items } = bundle;

  const back = (
    <Link href={`/admin/invoices/${id}`} className="inline-flex min-h-9 items-center gap-1.5 text-[12px] text-sand transition-colors hover:text-cream">
      <Icon.chevronLeft size={14} /> {docLabel(invoice)}
    </Link>
  );

  // Void, pending approval and converted documents are settled — nothing to edit.
  const frozen =
    invoice.status === "void"
      ? "A voided invoice can't be edited. Duplicate it to start again."
      : invoice.status === "pending_approval"
        ? "It's waiting for an admin's approval. Once approved or sent back, it can be edited again."
        : invoice.status === "converted"
          ? "This quote became an invoice — edit the invoice instead."
          : null;
  if (frozen) {
    return (
      <div className="max-w-xl space-y-4">
        {back}
        <Notice tone="warn" title={`${docLabel(invoice)} is locked`}>
          {frozen}
        </Notice>
        <Link href={`/admin/invoices/${id}`} className={linkButton.ghost}>
          Open it
        </Link>
      </div>
    );
  }

  const [settings, clients, leads, owners, source] = await Promise.all([
    loadSettings(supabase, profile.workspace),
    loadClients(supabase),
    loadLeads(supabase, profile),
    loadInvoicePeople(supabase, profile),
    invoice.source_quote_id
      ? supabase.from("invoices").select("number").eq("id", invoice.source_quote_id).maybeSingle<{ number: string | null }>()
      : Promise.resolve({ data: null }),
  ]);
  const note = just ? JUST[just] : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {back}
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-sand">
          Editing {invoice.kind === "quote" ? "quote" : "invoice"}
        </p>
      </div>
      {note && (
        <div className="mb-4">
          <Notice tone={note.tone} title={note.title}>
            {note.body}
          </Notice>
        </div>
      )}
      <InvoiceEditor
        mode="edit"
        initial={editorDocFromRow(invoice, items, settings)}
        invoice={{
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          amount_paid: num(invoice.amount_paid),
          paid_at: invoice.paid_at,
          source_quote_number: source.data?.number ?? null,
          scheduled: !!invoice.schedule_id,
        }}
        settings={settings}
        clients={clients}
        leads={leads}
        owners={owners.map((o) => ({ id: o.id, name: displayName(o) }))}
        viewer={{ id: profile.id, admin: isApprover(profile), canClients: canAccess(profile, "clients") }}
        today={todayISO()}
      />
    </>
  );
}
