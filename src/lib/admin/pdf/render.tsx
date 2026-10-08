import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import type { Branding, Business, DocumentData } from "@/lib/admin/invoice-types";
import type { Statement } from "@/lib/admin/statement";
import { InvoicePdf } from "./InvoicePdf";
import { StatementPdf } from "./StatementPdf";

/**
 * A document as PDF bytes — for email attachments and "Download PDF". Server
 * side only (the website's server, the desktop's main process, scheduled
 * jobs); the browser never loads the PDF renderer.
 */
export async function renderDocumentPdf(input: {
  doc: DocumentData;
  business: Business;
  branding: Branding;
  today: string;
}): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<InvoicePdf {...input} />);
  return new Uint8Array(buffer);
}

/** INV-0007.pdf, CN-0003.pdf, Draft-quote.pdf — the number when there is one. */
export const pdfFileName = (doc: Pick<DocumentData, "kind" | "number">) =>
  `${(doc.number ?? `Draft ${doc.kind === "credit_note" ? "credit note" : doc.kind}`).replace(/[^\w.-]+/g, "-")}.pdf`;

/** A statement of account (0037) as PDF bytes. */
export async function renderStatementPdf(input: { statement: Statement; business: Business; branding: Branding }): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<StatementPdf {...input} />);
  return new Uint8Array(buffer);
}

/** Statement-Kandy-Hotels-2026-10.pdf */
export const statementFileName = (st: Pick<Statement, "client" | "to">) =>
  `Statement-${(st.client.company || st.client.name).replace(/[^\w.-]+/g, "-").slice(0, 40)}-${st.to.slice(0, 7)}.pdf`;
