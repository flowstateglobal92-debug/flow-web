import type { Metadata } from "next";
import Link from "next/link";
import { requireModule } from "@/lib/admin/auth";
import { formatDateShort, num, todayISO } from "@/lib/admin/format";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { displayName } from "@/lib/admin/team";
import { Panel } from "@/components/admin/ui";
import InvoiceEditor from "@/components/admin/invoice/InvoiceEditor";
import {
  billedTo,
  blankEditorDoc,
  docMoney,
  type ClientOption,
  type Invoice,
  type LeadOption,
} from "@/lib/admin/invoice-types";
import { loadClients, loadInvoicePeople, loadLeads, loadSettings, runRecurring } from "../data";

export const metadata: Metadata = { title: "Create invoice" };

type DraftRow = Pick<Invoice, "id" | "kind" | "bill_to_name" | "bill_to_company" | "subject" | "total" | "currency" | "updated_at">;

/**
 * The Create tab: drafts to pick up again, then the editor. `?kind=quote`,
 * `?client=` and `?lead=` pre-fill it (the CRM and client pages link here);
 * `?recurring=1` opens it with "Make recurring" switched on.
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; client?: string; lead?: string; recurring?: string }>;
}) {
  const { supabase, profile } = await requireModule("invoices");
  const sp = await searchParams;
  const today = todayISO();
  const kind = sp.kind === "quote" ? "quote" : "invoice";

  await runRecurring(supabase);

  const draftCount = (k: "invoice" | "quote") =>
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "draft").eq("kind", k);
  const [settings, clients, leads, owners, { data: drafts }, { count: invoiceDrafts }, { count: quoteDrafts }] = await Promise.all([
    loadSettings(supabase, profile.workspace),
    loadClients(supabase),
    loadLeads(supabase, profile),
    loadInvoicePeople(supabase, profile),
    supabase
      .from("invoices")
      .select("id, kind, bill_to_name, bill_to_company, subject, total, currency, updated_at")
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(6)
      .returns<DraftRow[]>(),
    draftCount("invoice"),
    draftCount("quote"),
  ]);
  // Invoice drafts are listed under Issued invoices → Drafts, quote drafts under Quotes → Open.
  const more = [
    { count: invoiceDrafts ?? 0, shown: drafts?.filter((d) => d.kind === "invoice").length ?? 0, href: "/admin/invoices?status=draft", noun: "invoice" },
    { count: quoteDrafts ?? 0, shown: drafts?.filter((d) => d.kind === "quote").length ?? 0, href: "/admin/invoices/quotes", noun: "quote" },
  ].filter((m) => m.count > m.shown);

  // The deep-linked lead or client may be older than the picker's window — fetch it directly.
  let lead: LeadOption | null = null;
  if (sp.lead && canAccess(profile, "crm")) {
    lead =
      leads.find((l) => l.id === sp.lead) ??
      (
        await supabase
          .from("leads")
          .select("id, name, company, email, phone, client_id")
          .eq("id", sp.lead)
          .maybeSingle<LeadOption>()
      ).data;
  }
  const clientId = sp.client ?? lead?.client_id ?? null;
  let client: ClientOption | null = null;
  if (clientId) {
    client =
      clients.find((c) => c.id === clientId) ??
      (
        await supabase
          .from("clients")
          .select("id, name, company, email, phone, address, city, country")
          .eq("id", clientId)
          .maybeSingle<ClientOption>()
      ).data;
  }

  return (
    <>
      {(drafts?.length ?? 0) > 0 && (
        <Panel
          title="Drafts"
          hint="Pick up where you left off."
          className="mb-5"
          bodyClass="p-3"
          right={
            more.length > 0 ? (
              <span className="flex flex-wrap justify-end gap-x-3">
                {more.map((m) => (
                  <Link
                    key={m.noun}
                    href={m.href}
                    className="inline-flex items-center text-[11.5px] text-sand transition-colors hover:text-cream pointer-coarse:min-h-9"
                  >
                    All {m.count} {m.noun} drafts
                  </Link>
                ))}
              </span>
            ) : undefined
          }
        >
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {drafts!.map((d) => (
              <li key={d.id} className="min-w-0">
                <Link
                  href={`/admin/invoices/${d.id}/edit`}
                  className="block border border-cream/[0.08] bg-ink/40 px-3 py-2.5 transition-colors duration-300 hover:border-terra/40 hover:bg-cream/[0.03]"
                >
                  <span className="block font-mono text-[9.5px] uppercase tracking-[0.16em] text-terra-bright">
                    {d.kind === "quote" ? "Quote draft" : "Invoice draft"}
                  </span>
                  <span className="mt-1 block truncate font-display text-[13.5px] text-cream">{billedTo(d)}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-sand">
                    {docMoney(num(d.total), d.currency)} · edited {formatDateShort(d.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <InvoiceEditor
        // A new prefill (e.g. "New quote" while already here) starts a fresh editor;
        // a refresh after saving keeps the one being typed in.
        key={[kind, sp.client, sp.lead, sp.recurring].join(":")}
        mode="create"
        initial={blankEditorDoc(settings, { kind, today, ownerId: profile.id, client, lead })}
        startRecurring={sp.recurring === "1" && kind === "invoice"}
        settings={settings}
        clients={client && !clients.some((c) => c.id === client.id) ? [client, ...clients] : clients}
        leads={lead && !leads.some((l) => l.id === lead.id) ? [lead, ...leads] : leads}
        owners={owners.map((o) => ({ id: o.id, name: displayName(o) }))}
        viewer={{ id: profile.id, admin: isApprover(profile), canClients: canAccess(profile, "clients") }}
        today={today}
      />
    </>
  );
}
