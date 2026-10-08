import { createAdminClient } from "@/lib/supabase/admin";
import { todayISO } from "@/lib/admin/format";
import { DEFAULT_SETTINGS, brandingFrom, businessFrom, documentFromRow, type Invoice, type InvoiceItem, type InvoiceSettings } from "@/lib/admin/invoice-types";
import { pdfFileName, renderDocumentPdf } from "@/lib/admin/pdf/render";

/**
 * The invoice behind a pay-online link, as a PDF — the same file an email
 * attaches. The token is the key (payment_page decides it's a live, payable
 * invoice); nothing else about the workspace is reachable from here.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) return new Response("Not found", { status: 404 });
  const db = createAdminClient();
  const { data: page } = await db.rpc("payment_page", { p_token: token });
  const id = (page as { invoice_id?: string } | null)?.invoice_id;
  if (!id) return new Response("Not found", { status: 404 });

  const [{ data: invoice }, { data: items }] = await Promise.all([
    db.from("invoices").select("*").eq("id", id).single<Invoice>(),
    db.from("invoice_items").select("*").eq("invoice_id", id).order("position").returns<InvoiceItem[]>(),
  ]);
  if (!invoice) return new Response("Not found", { status: 404 });
  const { data: settings } = await db.from("invoice_settings").select("*").eq("workspace", invoice.workspace ?? "live").maybeSingle<InvoiceSettings>();
  const cfg = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  const doc = documentFromRow(invoice, items ?? []);
  const bytes = await renderDocumentPdf({ doc, business: businessFrom(cfg), branding: brandingFrom(cfg), today: todayISO() });
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${pdfFileName(doc)}"`,
      "cache-control": "private, no-store",
    },
  });
}
