import Image from "next/image";
import type { CSSProperties } from "react";
import { formatDate } from "@/lib/admin/format";
import { computeTotals } from "@/lib/admin/invoice-math";
import { docMoney, displayStatus, type Business, type DocumentData } from "@/lib/admin/invoice-types";

/**
 * The invoice / quotation paper. One pure component for the editor's live
 * preview, the detail page and the print page, so what you see while typing
 * is exactly what prints.
 *
 * A4 at 96dpi (210 × 297mm, growing with content). Warm off-white paper with
 * a slim terracotta edge, ink type, a terracotta "Amount due" block and
 * hairline rules. The stock wordmark is cream and would vanish on paper, so
 * it's drawn as a CSS mask filled with ink — cropped to the letters, because
 * the PNG carries a faint glow that would print as a grey haze.
 */

export const SHEET_WIDTH = 794;
export const WORDMARK_SRC = "/brand/wordmark.png";

// Paper palette — fixed, never themed: it has to print the same everywhere.
const PAPER = "#fbf7f1";

// wordmark.png is 863×153; the letters sit at x 28–856, y 58–119.
const WM = { w: 863, h: 153, x: 28, y: 58, gw: 829, gh: 62 };
const WM_WIDTH = 148;
const wmScale = WM_WIDTH / WM.gw;
const wordmarkStyle: CSSProperties = {
  width: WM_WIDTH,
  height: Math.round(WM.gh * wmScale * 100) / 100,
  backgroundColor: "#1c1410",
  WebkitMaskImage: `url(${WORDMARK_SRC})`,
  maskImage: `url(${WORDMARK_SRC})`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: `${WM.w * wmScale}px ${WM.h * wmScale}px`,
  maskSize: `${WM.w * wmScale}px ${WM.h * wmScale}px`,
  WebkitMaskPosition: `${-WM.x * wmScale}px ${-WM.y * wmScale}px`,
  maskPosition: `${-WM.x * wmScale}px ${-WM.y * wmScale}px`,
};

// Section labels: tiny mono caps. Colour is added per use so two never clash.
const caps = "font-mono text-[8.5px] font-normal uppercase tracking-[0.24em]";
const label = `${caps} text-[#a0523a]`;
const th = `${caps} pb-2.5 text-[#7a6a5c]`;

/** The small solid stamp on the amount block — a state worth saying out loud, or nothing. */
function badgeFor(doc: DocumentData, total: number, today: string): string | null {
  const status = displayStatus(
    {
      kind: doc.kind,
      status: doc.status,
      due_date: doc.due_date,
      valid_until: doc.valid_until,
      total,
      amount_paid: doc.amount_paid,
    },
    today,
  );
  switch (status) {
    case "paid":
      return doc.paid_at ? `Paid · ${formatDate(doc.paid_at)}` : "Paid";
    case "partially_paid":
      return "Part paid";
    case "overdue":
      return "Overdue";
    case "void":
      return "Void";
    case "pending_approval":
      return "Pending approval";
    case "draft":
      return "Draft";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "expired":
      return "Expired";
    case "converted":
      return "Invoiced";
    default:
      return null;
  }
}

function Lines({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return <span className="block whitespace-pre-line">{text.trim()}</span>;
}

export default function InvoiceDocument({
  doc,
  business,
  today,
  className = "",
}: {
  doc: DocumentData;
  business: Business;
  /** Colombo `YYYY-MM-DD`, passed in so server and browser agree on "overdue". */
  today: string;
  className?: string;
}) {
  const quote = doc.kind === "quote";
  const t = computeTotals(doc);
  const paid = quote ? 0 : doc.amount_paid;
  const balance = Math.max(0, Math.round((t.total - paid) * 100) / 100);
  const badge = badgeFor(doc, t.total, today);
  const money = (v: number) => docMoney(v, doc.currency);
  const voided = doc.status === "void";
  const discountRate = Number(doc.discount_value);
  const taxRate = Number(doc.tax_rate);

  const dueDays =
    !quote && doc.due_date
      ? Math.round((Date.parse(doc.due_date) - Date.parse(doc.issue_date)) / 86_400_000)
      : null;

  const amountLine = quote
    ? doc.valid_until
      ? `Valid until ${formatDate(doc.valid_until)}`
      : `Prepared ${formatDate(doc.issue_date)}`
    : voided
      ? "This invoice was voided — nothing is due."
      : balance <= 0 && t.total > 0
        ? "Paid in full — thank you."
        : paid > 0
          ? `${money(paid)} of ${money(t.total)} received${doc.due_date ? ` · ${doc.due_date < today ? "was due" : "due"} ${formatDate(doc.due_date)}` : ""}`
          : doc.due_date
            ? `${doc.due_date < today && doc.status !== "draft" ? "Was due" : "Due by"} ${formatDate(doc.due_date)}`
            : "Due on receipt";

  const items = doc.items.filter((i) => i.description.trim() || Number(i.unit_price) > 0);
  const hasPayment = !!doc.payment_details?.trim();
  const hasNotes = !!doc.notes?.trim() || !!doc.terms?.trim();

  return (
    <article
      className={`invoice-sheet relative flex min-h-[297mm] w-[210mm] flex-col overflow-hidden text-[#1c1410] [color-scheme:light] ${className}`}
      style={{ backgroundColor: PAPER }}
      aria-label={`${quote ? "Quotation" : "Invoice"} ${doc.number ?? "draft"}`}
    >
      {/* Edge stripe — terracotta with a deeper inner line. */}
      <div aria-hidden className="absolute inset-y-0 left-0 w-[7px] bg-[#c65d3b]">
        <div className="absolute inset-y-0 right-0 w-px bg-[#8e3e24]/60" />
      </div>

      <div className="flex flex-1 flex-col pb-[30px] pl-[68px] pr-[60px] pt-[42px]">
        {/* Masthead */}
        <header className="flex items-start justify-between gap-10">
          <div className="flex items-center gap-3.5 pt-1">
            <Image
              src="/brand/mark-256.webp"
              alt=""
              width={250}
              height={256}
              unoptimized
              loading="eager"
              className="h-[40px] w-auto"
            />
            <span role="img" aria-label={business.business_name || "Flow State"} className="block" style={wordmarkStyle} />
          </div>
          <div className="text-right">
            <h2 className="font-display text-[42px] font-normal leading-[0.92] tracking-[-0.045em] text-[#1c1410]">
              {quote ? "Quotation" : "Invoice"}
            </h2>
            <p className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[#7a6a5c] tabular-nums">
              {doc.number ?? "Draft · number on issue"}
            </p>
          </div>
        </header>

        <div className="mt-6 h-px bg-[#e3d8ca]" />

        {/* Billed to · From · Details */}
        <section className="mt-5 grid grid-cols-[1.2fr_1fr_0.85fr] gap-9 text-[11.5px] leading-[1.55] text-[#4a3d34]">
          <div className="min-w-0">
            <p className={label}>{quote ? "Prepared for" : "Billed to"}</p>
            <p className="mt-2 text-[13.5px] font-medium leading-snug text-[#1c1410]">
              {doc.bill_to_name.trim() || <span className="text-[#b3a595]">Client name</span>}
            </p>
            {doc.bill_to_company?.trim() && doc.bill_to_company.trim() !== doc.bill_to_name.trim() && (
              <p className="text-[#1c1410]">{doc.bill_to_company.trim()}</p>
            )}
            <div className="mt-1 break-words">
              <Lines text={doc.bill_to_address} />
              <Lines text={doc.bill_to_email} />
              <Lines text={doc.bill_to_phone} />
            </div>
          </div>

          <div className="min-w-0">
            <p className={label}>From</p>
            <p className="mt-2 text-[13.5px] font-medium leading-snug text-[#1c1410]">{business.business_name}</p>
            <div className="mt-1 break-words">
              <Lines text={business.business_address} />
              <Lines text={business.business_email} />
              <Lines text={business.business_phone} />
              {business.tax_id?.trim() && <span className="block">Tax ID {business.tax_id.trim()}</span>}
            </div>
          </div>

          <div className="min-w-0">
            <p className={label}>Details</p>
            <dl className="mt-2 space-y-1">
              <Detail term="Issued" value={formatDate(doc.issue_date)} />
              {quote ? (
                <Detail term="Valid until" value={doc.valid_until ? formatDate(doc.valid_until) : "—"} />
              ) : (
                <>
                  <Detail term="Due" value={doc.due_date ? formatDate(doc.due_date) : "On receipt"} />
                  <Detail term="Terms" value={dueDays == null || dueDays <= 0 ? "On receipt" : `Net ${dueDays}`} />
                </>
              )}
              {doc.currency.toUpperCase() !== "LKR" && <Detail term="Currency" value={doc.currency.toUpperCase()} />}
            </dl>
          </div>
        </section>

        {/* Amount due */}
        <section className="mt-6 flex items-start justify-between gap-6 bg-[#c65d3b] px-7 pb-[18px] pt-4 text-[#fdf5ea] break-inside-avoid">
          <div className="min-w-0">
            <p className="font-mono text-[8.5px] uppercase tracking-[0.26em] text-[#fdf5ea]">
              {quote ? "Quote total" : voided ? "Amount" : "Amount due"}
            </p>
            <p
              className={`mt-2 font-display text-[32px] font-normal leading-none tracking-[-0.035em] tabular-nums ${voided ? "line-through decoration-[1.5px]" : ""}`}
            >
              {money(quote || voided ? t.total : balance)}
            </p>
            <p className="mt-2 text-[11.5px] text-[#fdf5ea]">{amountLine}</p>
          </div>
          {badge && (
            <span className="mt-0.5 shrink-0 bg-[#1c1410] px-2 py-[5px] font-mono text-[9px] uppercase leading-none tracking-[0.18em] text-[#fdf5ea]">
              {badge}
            </span>
          )}
        </section>

        {doc.subject?.trim() && (
          <div className="mt-6">
            <p className={label}>{quote ? "Proposal" : "For"}</p>
            <p className="mt-1.5 font-display text-[16.5px] font-normal leading-snug tracking-[-0.02em] text-[#1c1410]">
              {doc.subject.trim()}
            </p>
          </div>
        )}

        {/* Line items */}
        <table className={`${doc.subject?.trim() ? "mt-3" : "mt-6"} w-full border-collapse text-left`}>
          <thead className="table-header-group">
            <tr className="border-b border-[#1c1410]">
              <th className={`${th} w-[34px]`}>#</th>
              <th className={th}>Description</th>
              <th className={`${th} w-[64px] text-right`}>Qty</th>
              <th className={`${th} w-[118px] text-right`}>Rate</th>
              <th className={`${th} w-[128px] text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr className="border-b border-[#e3d8ca]">
                <td colSpan={5} className="py-6 text-center text-[11.5px] text-[#b3a595]">
                  Line items appear here.
                </td>
              </tr>
            ) : (
              items.map((item, i) => (
                <tr key={i} className="border-b border-[#e3d8ca] align-top break-inside-avoid">
                  <td className="py-[11px] font-mono text-[10px] text-[#a89a8b] tabular-nums">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-[11px] pr-4">
                    <p className="text-[12.5px] font-medium leading-snug text-[#1c1410]">{item.description}</p>
                    {item.details?.trim() && (
                      <p className="mt-0.5 whitespace-pre-line text-[11px] leading-[1.5] text-[#6f6357]">{item.details.trim()}</p>
                    )}
                  </td>
                  <td className="py-[11px] text-right font-mono text-[11.5px] text-[#4a3d34] tabular-nums">{formatQty(item.quantity)}</td>
                  <td className="py-[11px] text-right font-mono text-[11.5px] text-[#4a3d34] tabular-nums">
                    {money(Number(item.unit_price) || 0)}
                  </td>
                  <td className="py-[11px] text-right font-mono text-[11.5px] text-[#1c1410] tabular-nums">
                    {money(t.lines[doc.items.indexOf(item)] ?? 0)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Payment details beside the totals — the left of the totals stack is otherwise empty paper. */}
        <section className="mt-5 grid grid-cols-[minmax(0,1fr)_288px] items-start gap-10 break-inside-avoid">
          <div className="min-w-0">
            {hasPayment && (
              <div className="bg-[#f3e9dc]/70 px-5 py-4">
                <p className={label}>{quote ? "Payment" : "Payment details"}</p>
                <p className="mt-2 whitespace-pre-line break-words font-mono text-[10.5px] leading-[1.7] text-[#1c1410]">
                  {doc.payment_details!.trim()}
                </p>
              </div>
            )}
          </div>
          <dl className="text-[11.5px] text-[#4a3d34]">
            <Row term="Subtotal" value={money(t.subtotal)} />
            {t.discount > 0 && (
              <Row
                term={`Discount${doc.discount_type === "percent" && discountRate > 0 ? ` (${trimRate(discountRate)}%)` : ""}`}
                value={`−${money(t.discount)}`}
              />
            )}
            {taxRate > 0 && <Row term={`${doc.tax_label || "Tax"} (${trimRate(taxRate)}%)`} value={money(t.tax)} />}
            <div className="my-1.5 h-px bg-[#1c1410]/80" />
            <div className="flex items-baseline justify-between gap-4 py-[3px]">
              <dt className="font-display text-[14px] text-[#1c1410]">Total</dt>
              <dd className="font-mono text-[13.5px] text-[#1c1410] tabular-nums">{money(t.total)}</dd>
            </div>
            {!quote && paid > 0 && <Row term="Paid" value={`−${money(paid)}`} />}
            {!quote && (
              <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-[#e3d8ca] pt-2">
                <dt className="font-display text-[14.5px] text-[#a0523a]">Balance due</dt>
                <dd className="font-display text-[19px] tracking-[-0.02em] text-[#a0523a] tabular-nums">
                  {money(voided ? 0 : balance)}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Notes · terms */}
        {hasNotes && (
          <section className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 text-[11px] leading-[1.6] text-[#4a3d34] break-inside-avoid">
            {doc.notes?.trim() && (
              <div className="min-w-0">
                <p className={label}>Notes</p>
                <p className="mt-1.5 whitespace-pre-line break-words">{doc.notes.trim()}</p>
              </div>
            )}
            {doc.terms?.trim() && (
              <div className="min-w-0">
                <p className={label}>Terms</p>
                <p className="mt-1.5 whitespace-pre-line break-words text-[#6f6357]">{doc.terms.trim()}</p>
              </div>
            )}
          </section>
        )}

        {/* Footer */}
        <footer className="mt-auto pt-7 break-inside-avoid">
          <div className="h-px bg-[#e3d8ca]" />
          <div className="mt-3.5 flex items-baseline justify-between gap-6">
            <p className="font-display text-[12.5px] tracking-[-0.01em] text-[#1c1410]">
              {quote ? "We'd love to work with you." : "Thank you for your business."}
            </p>
            <p className="font-mono text-[9.5px] tracking-[0.06em] text-[#7a6a5c]">
              {[business.business_website, business.business_email].filter(Boolean).join("  ·  ")}
            </p>
          </div>
        </footer>
      </div>
    </article>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[#7a6a5c]">{term}</dt>
      <dd className="font-mono text-[11px] text-[#1c1410] tabular-nums">{value}</dd>
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[3px]">
      <dt>{term}</dt>
      <dd className="font-mono tabular-nums text-[#1c1410]">{value}</dd>
    </div>
  );
}

/** 1 → "1", 1.5 → "1.5", 0.333 → "0.333". */
function formatQty(q: number | string) {
  const n = Number(q);
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n * 1000) / 1000);
}

const trimRate = (r: number) => String(Math.round(r * 100) / 100);
