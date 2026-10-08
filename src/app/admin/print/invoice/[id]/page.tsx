import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, requireModule } from "@/lib/admin/auth";
import { todayISO } from "@/lib/admin/format";
import { Icon } from "@/components/admin/icons";
import InvoiceDocument from "@/components/admin/invoice/InvoiceDocument";
import { AutoPrint, PrintButton } from "@/components/admin/invoice/PrintTools";
import ScaledSheet from "@/components/admin/invoice/ScaledSheet";
import { brandingFrom, businessFrom, docLabel, documentFromRow, type Invoice } from "@/lib/admin/invoice-types";
import { loadDocument, loadSettings } from "@/app/admin/(shell)/invoices/data";

/** Never cached — it's somebody's invoice. */
export const dynamic = "force-dynamic";

/**
 * The paper on its own, outside the admin shell. The tab title is the
 * document number, so "Save as PDF" names the file INV-0007.pdf. `?print=1`
 * opens the print dialog once fonts and images are ready. No iframes — the
 * admin sends X-Frame-Options: DENY.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const session = await getSession();
  if (!session?.profile) return { title: { absolute: "Invoice" } };
  const { id } = await params;
  const { data } = await session.supabase
    .from("invoices")
    .select("kind, number")
    .eq("id", id)
    .maybeSingle<Pick<Invoice, "kind" | "number">>();
  return { title: { absolute: data ? docLabel(data) : "Invoice" } };
}

export default async function PrintInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { supabase, profile } = await requireModule("invoices");
  const [{ id }, { print }] = await Promise.all([params, searchParams]);
  const [bundle, settings] = await Promise.all([loadDocument(supabase, id), loadSettings(supabase, profile.workspace)]);
  if (!bundle) notFound();
  const { invoice, items } = bundle;
  const credited = invoice.credited_invoice_id
    ? (await supabase.from("invoices").select("number").eq("id", invoice.credited_invoice_id).maybeSingle<{ number: string | null }>()).data
    : null;

  return (
    <div className="min-h-screen print:min-h-0">
      <div className="no-print sticky top-0 z-10 border-b border-cream/[0.08] bg-ink-2/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <Link
            href={`/admin/invoices/${invoice.id}`}
            className="inline-flex min-h-9 items-center gap-1.5 text-[12px] text-sand transition-colors hover:text-cream"
          >
            <Icon.chevronLeft size={14} /> {docLabel(invoice)}
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-[11.5px] text-sand sm:inline">Choose “Save as PDF” in the dialog for a file.</span>
            <PrintButton />
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[880px] px-4 py-8 print:max-w-none print:p-0">
        <ScaledSheet>
          <InvoiceDocument
            doc={documentFromRow(invoice, items, credited)}
            business={businessFrom(settings)}
            branding={brandingFrom(settings)}
            today={todayISO()}
            className="shadow-[0_40px_120px_-40px_var(--shadow-deep)] print:shadow-none"
          />
        </ScaledSheet>
      </main>

      {print === "1" && <AutoPrint />}
    </div>
  );
}
