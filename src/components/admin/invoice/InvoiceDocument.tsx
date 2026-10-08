import Image from "next/image";
import type { CSSProperties } from "react";
import { DEFAULT_BRANDING, type Branding, type Business, type DocumentData } from "@/lib/admin/invoice-types";
import { INK, PAPER, formatQty, paperModel, trimNum } from "@/lib/admin/invoice-paper";

/**
 * The invoice / quotation / credit-note paper. One pure component for the
 * editor's live preview, the detail page and the print page, so what you see
 * while typing is exactly what prints.
 *
 * A4 at 96dpi (210 × 297mm, growing with content). Warm off-white paper, ink
 * type, hairline rules, and the workspace's accent (0035) on the edge, the
 * "Amount due" block and the labels. Three layouts: classic (the original),
 * modern (an accent band across the top) and compact (tighter, for long
 * documents). The stock wordmark is cream and would vanish on paper, so it's
 * drawn as a CSS mask filled with ink — cropped to the letters, because the
 * PNG carries a faint glow that would print as a grey haze.
 *
 * A VAT-registered workspace's taxed invoices print as a TAX INVOICE: both
 * TINs, the date of supply and, for a foreign currency, the rupee values at
 * the document's rate (Sri Lanka's tax-invoice rules from 1 July 2026).
 */

export const SHEET_WIDTH = 794;
export const WORDMARK_SRC = "/brand/wordmark.png";

// wordmark.png is 863×153; the letters sit at x 28–856, y 58–119.
const WM = { w: 863, h: 153, x: 28, y: 58, gw: 829, gh: 62 };
function wordmarkStyle(width: number, color: string): CSSProperties {
  const scale = width / WM.gw;
  return {
    width,
    height: Math.round(WM.gh * scale * 100) / 100,
    backgroundColor: color,
    WebkitMaskImage: `url(${WORDMARK_SRC})`,
    maskImage: `url(${WORDMARK_SRC})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: `${WM.w * scale}px ${WM.h * scale}px`,
    maskSize: `${WM.w * scale}px ${WM.h * scale}px`,
    WebkitMaskPosition: `${-WM.x * scale}px ${-WM.y * scale}px`,
    maskPosition: `${-WM.x * scale}px ${-WM.y * scale}px`,
  };
}

function Lines({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return <span className="block whitespace-pre-line">{text.trim()}</span>;
}

export default function InvoiceDocument({
  doc,
  business,
  branding = DEFAULT_BRANDING,
  today,
  className = "",
}: {
  doc: DocumentData;
  business: Business;
  branding?: Branding;
  /** Colombo `YYYY-MM-DD`, passed in so server and browser agree on "overdue". */
  today: string;
  className?: string;
}) {
  const p = paperModel(doc, business, branding, today);
  const { quote, credit, voided, credited, paid, refund, balance, inclusive, taxInvoice, rate, money, lkr } = p;
  const t = p.totals;
  const discountRate = Number(doc.discount_value);

  const layout = branding.layout ?? "classic";
  const modern = layout === "modern";
  const compact = layout === "compact";
  const colors = p.colors;
  const caps = "font-mono text-[8.5px] font-normal uppercase tracking-[0.24em]";
  const label = `${caps} text-[var(--doc-deep)]`;
  const th = `${caps} pb-2.5 text-[#7a6a5c]`;
  const cell = compact ? "py-[7px]" : "py-[11px]";
  const title = p.title;
  const badge = p.badge;

  const items = doc.items.filter((i) => i.description.trim() || Number(i.unit_price) > 0);
  const hasPayment = !!doc.payment_details?.trim() && !credit;
  const hasNotes = !!doc.notes?.trim() || !!doc.terms?.trim();
  const showLineTax = p.showLineTax;

  const vars = {
    backgroundColor: PAPER,
    "--doc-accent": colors.accent,
    "--doc-deep": colors.deep,
    "--doc-edge": colors.edge,
    "--doc-on": colors.onAccent,
  } as CSSProperties;

  const logo =
    branding.logo_mode === "custom" && branding.logo_data ? (
      // A data: URL the admin uploaded — next/image can't optimise it and needn't.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={branding.logo_data} alt={business.business_name || "Logo"} className="max-h-[54px] max-w-[190px] object-contain" />
    ) : branding.logo_mode === "none" ? (
      <span className="font-display text-[22px] font-normal leading-none tracking-[-0.03em] text-[#1c1410]">
        {business.business_name || "Flow State"}
      </span>
    ) : (
      <span className="flex items-center gap-3.5">
        <Image src="/brand/mark-256.webp" alt="" width={250} height={256} unoptimized loading="eager" className="h-[40px] w-auto" />
        <span role="img" aria-label={business.business_name || "Flow State"} className="block" style={wordmarkStyle(148, INK)} />
      </span>
    );

  return (
    <article
      className={`invoice-sheet relative flex min-h-[297mm] w-[210mm] flex-col overflow-hidden text-[#1c1410] [color-scheme:light] ${className}`}
      style={vars}
      aria-label={`${title} ${doc.number ?? "draft"}`}
    >
      {/* Edge stripe — the accent with a deeper inner line (classic and compact). */}
      {!modern && (
        <div aria-hidden className="absolute inset-y-0 left-0 w-[7px] bg-[var(--doc-accent)]">
          <div className="absolute inset-y-0 right-0 w-px bg-[var(--doc-edge)]/60" />
        </div>
      )}

      {/* Modern: an accent band across the top with the title in it. */}
      {modern && (
        <div className="flex items-end justify-between gap-8 bg-[var(--doc-accent)] px-[60px] pb-6 pt-9 text-[var(--doc-on)]">
          <div>
            <h2 className="font-display text-[40px] font-normal leading-[0.92] tracking-[-0.045em]">{title}</h2>
            <p className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.2em] opacity-90 tabular-nums">
              {doc.number ?? "Draft · number on issue"}
            </p>
          </div>
          <div className="bg-[#fbf7f1] px-4 py-3">{logo}</div>
        </div>
      )}

      <div
        className={`flex flex-1 flex-col pr-[60px] ${modern ? "pl-[60px] pt-7" : compact ? "pl-[60px] pt-[30px]" : "pl-[68px] pt-[42px]"} ${compact ? "pb-[22px]" : "pb-[30px]"}`}
      >
        {/* Masthead */}
        {!modern && (
          <header className="flex items-start justify-between gap-10">
            <div className="flex items-center pt-1">{logo}</div>
            <div className="text-right">
              <h2
                className={`font-display font-normal leading-[0.92] tracking-[-0.045em] text-[#1c1410] ${compact ? "text-[32px]" : "text-[42px]"}`}
              >
                {title}
              </h2>
              <p className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[#7a6a5c] tabular-nums">
                {doc.number ?? "Draft · number on issue"}
              </p>
            </div>
          </header>
        )}

        {!modern && <div className={`${compact ? "mt-4" : "mt-6"} h-px bg-[#e3d8ca]`} />}

        {/* Billed to · From · Details */}
        <section
          className={`${modern ? "mt-1" : compact ? "mt-3.5" : "mt-5"} grid grid-cols-[1.2fr_1fr_0.85fr] gap-9 text-[11.5px] leading-[1.55] text-[#4a3d34]`}
        >
          <div className="min-w-0">
            <p className={label}>{quote ? "Prepared for" : credit ? "Credited to" : "Billed to"}</p>
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
              {doc.bill_to_tax_id?.trim() && <span className="block">TIN {doc.bill_to_tax_id.trim()}</span>}
            </div>
          </div>

          <div className="min-w-0">
            <p className={label}>From</p>
            <p className="mt-2 text-[13.5px] font-medium leading-snug text-[#1c1410]">{business.business_name}</p>
            <div className="mt-1 break-words">
              <Lines text={business.business_address} />
              <Lines text={business.business_email} />
              <Lines text={business.business_phone} />
              {business.tax_id?.trim() && (
                <span className="block">
                  {taxInvoice ? "TIN" : "Tax ID"} {business.tax_id.trim()}
                </span>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <p className={label}>Details</p>
            <dl className="mt-2 space-y-1">
              {p.details.map(([term, value]) => (
                <Detail key={term} term={term} value={value} />
              ))}
            </dl>
          </div>
        </section>

        {/* Amount due */}
        {modern ? (
          <section
            className={`${compact ? "mt-4" : "mt-6"} flex items-start justify-between gap-6 border border-[var(--doc-accent)] px-7 pb-[16px] pt-4 break-inside-avoid`}
          >
            <AmountBlock label={p.amountLabel} amount={money(p.amountValue)} line={p.amountLine} struck={voided} accentText />
            {badge && (
              <span className="mt-0.5 shrink-0 bg-[var(--doc-accent)] px-2 py-[5px] font-mono text-[9px] uppercase leading-none tracking-[0.18em] text-[var(--doc-on)]">
                {badge}
              </span>
            )}
          </section>
        ) : (
          <section
            className={`${compact ? "mt-4 pb-[14px] pt-3" : "mt-6 pb-[18px] pt-4"} flex items-start justify-between gap-6 bg-[var(--doc-accent)] px-7 text-[var(--doc-on)] break-inside-avoid`}
          >
            <AmountBlock label={p.amountLabel} amount={money(p.amountValue)} line={p.amountLine} struck={voided} small={compact} />
            {badge && (
              <span className="mt-0.5 shrink-0 bg-[#1c1410] px-2 py-[5px] font-mono text-[9px] uppercase leading-none tracking-[0.18em] text-[#fdf5ea]">
                {badge}
              </span>
            )}
          </section>
        )}

        {doc.subject?.trim() && (
          <div className={compact ? "mt-4" : "mt-6"}>
            <p className={label}>{quote ? "Proposal" : credit ? "About" : "For"}</p>
            <p className="mt-1.5 font-display text-[16.5px] font-normal leading-snug tracking-[-0.02em] text-[#1c1410]">
              {doc.subject.trim()}
            </p>
          </div>
        )}

        {/* Line items */}
        <table className={`${doc.subject?.trim() ? "mt-3" : compact ? "mt-4" : "mt-6"} w-full border-collapse text-left`}>
          <thead className="table-header-group">
            <tr className="border-b border-[#1c1410]">
              <th className={`${th} w-[34px]`}>#</th>
              <th className={th}>Description</th>
              <th className={`${th} w-[56px] text-right`}>Qty</th>
              <th className={`${th} w-[112px] text-right`}>Rate</th>
              <th className={`${th} w-[124px] text-right`}>Amount</th>
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
                  <td className={`${cell} font-mono text-[10px] text-[#a89a8b] tabular-nums`}>{String(i + 1).padStart(2, "0")}</td>
                  <td className={`${cell} pr-4`}>
                    <p className="text-[12.5px] font-medium leading-snug text-[#1c1410]">{item.description}</p>
                    {item.details?.trim() && (
                      <p className="mt-0.5 whitespace-pre-line text-[11px] leading-[1.5] text-[#6f6357]">{item.details.trim()}</p>
                    )}
                    {showLineTax && (item.taxes?.length ?? 0) > 0 && (
                      <p className="mt-0.5 font-mono text-[9.5px] tracking-[0.04em] text-[#7a6a5c]">
                        {item.taxes!.map((x) => `${x.name} ${trimNum(Number(x.rate), 3)}%`).join(" · ")}
                      </p>
                    )}
                  </td>
                  <td className={`${cell} text-right font-mono text-[11.5px] text-[#4a3d34] tabular-nums`}>{formatQty(item.quantity)}</td>
                  <td className={`${cell} text-right font-mono text-[11.5px] text-[#4a3d34] tabular-nums`}>
                    {money(Number(item.unit_price) || 0)}
                  </td>
                  <td className={`${cell} text-right font-mono text-[11.5px] text-[#1c1410] tabular-nums`}>
                    {money(t.lines[doc.items.indexOf(item)] ?? 0)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Payment details beside the totals — the left of the totals stack is otherwise empty paper. */}
        <section className="mt-5 grid grid-cols-[minmax(0,1fr)_300px] items-start gap-10 break-inside-avoid">
          <div className="min-w-0 space-y-4">
            {hasPayment && (
              <div className="bg-[#f3e9dc]/70 px-5 py-4">
                <p className={label}>{quote ? "Payment" : "Payment details"}</p>
                <p className="mt-2 whitespace-pre-line break-words font-mono text-[10.5px] leading-[1.7] text-[#1c1410]">
                  {doc.payment_details!.trim()}
                </p>
              </div>
            )}
            {/* A tax invoice in another currency also states its values in rupees. */}
            {taxInvoice && rate && (
              <div className="border border-[#e3d8ca] px-5 py-3.5">
                <p className={label}>In Sri Lankan rupees · at Rs {trimNum(rate, 4)}</p>
                <dl className="mt-2 space-y-1 text-[11px] text-[#4a3d34]">
                  <Detail term="Value excluding tax" value={lkr(t.net)} />
                  {t.taxes.map((x) => (
                    <Detail key={`${x.name}${x.rate}`} term={`${x.name} ${trimNum(x.rate, 3)}%`} value={lkr(x.amount)} />
                  ))}
                  <Detail term="Total including tax" value={lkr(t.total)} />
                </dl>
              </div>
            )}
          </div>
          <dl className="text-[11.5px] text-[#4a3d34]">
            <Row term="Subtotal" value={money(t.subtotal)} />
            {t.discount > 0 && (
              <Row
                term={`Discount${doc.discount_type === "percent" && discountRate > 0 ? ` (${trimNum(discountRate, 2)}%)` : ""}`}
                value={`−${money(t.discount)}`}
              />
            )}
            {inclusive && t.tax > 0 && <Row term="Value before tax" value={money(t.net)} />}
            {t.taxes.map((x) => (
              <Row
                key={`${x.name}${x.rate}${x.compound}`}
                term={p.taxTerm(x)}
                value={money(x.amount)}
              />
            ))}
            <div className="my-1.5 h-px bg-[#1c1410]/80" />
            <div className="flex items-baseline justify-between gap-4 py-[3px]">
              <dt className="font-display text-[14px] text-[#1c1410]">{credit ? "Total credit" : taxInvoice ? "Total incl. tax" : "Total"}</dt>
              <dd className="font-mono text-[13.5px] text-[#1c1410] tabular-nums">{money(t.total)}</dd>
            </div>
            {!quote && !credit && paid > 0 && <Row term="Paid" value={`−${money(paid)}`} />}
            {!quote && !credit && credited > 0 && <Row term="Credited" value={`−${money(credited)}`} />}
            {!quote && !credit && (
              <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-[#e3d8ca] pt-2">
                <dt className="font-display text-[14.5px] text-[var(--doc-deep)]">{refund > 0 ? "Refund due" : "Balance due"}</dt>
                <dd className="font-display text-[19px] tracking-[-0.02em] text-[var(--doc-deep)] tabular-nums">
                  {money(voided ? 0 : refund > 0 ? refund : balance)}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Notes · terms */}
        {hasNotes && (
          <section
            className={`${compact ? "mt-4" : "mt-6"} grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 text-[11px] leading-[1.6] text-[#4a3d34] break-inside-avoid`}
          >
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
        <footer className={`mt-auto ${compact ? "pt-5" : "pt-7"} break-inside-avoid`}>
          <div className="h-px bg-[#e3d8ca]" />
          <div className="mt-3.5 flex items-baseline justify-between gap-6">
            <p className="font-display text-[12.5px] tracking-[-0.01em] text-[#1c1410]">
              {p.footerText}
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

function AmountBlock({
  label,
  amount,
  line,
  struck,
  small,
  accentText,
}: {
  label: string;
  amount: string;
  line: string;
  struck?: boolean;
  small?: boolean;
  /** Modern layout: the block is outlined, so the figure takes the deep accent. */
  accentText?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className={`font-mono text-[8.5px] uppercase tracking-[0.26em] ${accentText ? "text-[var(--doc-deep)]" : ""}`}>{label}</p>
      <p
        className={`mt-2 font-display font-normal leading-none tracking-[-0.035em] tabular-nums ${small ? "text-[26px]" : "text-[32px]"} ${accentText ? "text-[var(--doc-deep)]" : ""} ${struck ? "line-through decoration-[1.5px]" : ""}`}
      >
        {amount}
      </p>
      <p className={`mt-2 text-[11.5px] ${accentText ? "text-[#4a3d34]" : ""}`}>{line}</p>
    </div>
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
