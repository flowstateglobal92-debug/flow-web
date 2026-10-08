/**
 * What the paper says, worked out once for both renderers: the HTML sheet
 * (components/admin/invoice/InvoiceDocument.tsx — preview, detail, print) and
 * the PDF (lib/admin/pdf/InvoicePdf.tsx — downloads and emails). Titles,
 * stamps, figures, the accent palette and the tax-invoice extras all come from
 * here, so a PDF never says something the screen doesn't.
 */
import { formatDate } from "./format";
import { computeTotals, type Totals } from "./invoice-math";
import {
  CREDIT_REASONS,
  DEFAULT_BRANDING,
  displayStatus,
  docMoney,
  type Branding,
  type Business,
  type DocumentData,
} from "./invoice-types";

export const PAPER = "#fbf7f1";
export const INK = "#1c1410";

/* ───────────────────────────── accent colours ───────────────────────────── */

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
/** Mix toward black (f < 0) or white (f > 0). */
export const shade = (hex: string, f: number) => toHex(rgb(hex).map((v) => (f < 0 ? v * (1 + f) : v + (255 - v) * f)));
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export type Palette = { accent: string; deep: string; edge: string; onAccent: string };

/** The accent and what goes with it: a deeper tone for type on paper (≥ 4.5:1), and readable text on a solid fill. */
export function palette(accent: string): Palette {
  const base = /^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_BRANDING.accent_color;
  const light = luminance(base) > 0.32;
  let deep = shade(base, -0.18);
  for (let i = 0; i < 6 && luminance(deep) > 0.16; i++) deep = shade(deep, -0.15);
  return { accent: base, deep, edge: shade(base, -0.28), onAccent: light ? INK : "#fdf5ea" };
}

/* ─────────────────────────────── the model ─────────────────────────────── */

export type Paper = {
  quote: boolean;
  credit: boolean;
  voided: boolean;
  title: string;
  totals: Totals;
  paid: number;
  credited: number;
  balance: number;
  refund: number;
  badge: string | null;
  amountLabel: string;
  amountValue: number;
  amountLine: string;
  inclusive: boolean;
  taxInvoice: boolean;
  foreign: boolean;
  /** LKR per unit, for a foreign document that has one. */
  rate: number | null;
  /** Term → value pairs for the Details column. */
  details: [string, string][];
  showLineTax: boolean;
  dueDays: number | null;
  footerText: string;
  colors: Palette;
  money: (v: number) => string;
  lkr: (v: number) => string;
  /** How a tax line reads in the totals: "VAT (18% on amount + SSCL)", "SSCL (2.5%, included)". */
  taxTerm: (x: { name: string; rate: number; compound: boolean }) => string;
};

/** 18 → "18", 2.5 → "2.5", 299.1234 (4 dp) → "299.1234". */
export const trimNum = (r: number, dp: number) => String(Math.round(r * 10 ** dp) / 10 ** dp);

/** 1 → "1", 1.5 → "1.5", 0.333 → "0.333". */
export function formatQty(q: number | string) {
  const n = Number(q);
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n * 1000) / 1000);
}

export const reasonLabel = (r: string) =>
  r === "write_off" ? "bad debt written off" : (CREDIT_REASONS.find((x) => x.value === r)?.label ?? r).toLowerCase();

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
      credited_total: doc.credited_total ?? 0,
    },
    today,
  );
  switch (status) {
    case "paid":
      return doc.paid_at ? `Paid · ${formatDate(doc.paid_at)}` : "Paid";
    case "partially_paid":
      return "Part paid";
    case "credited":
      return "Credited";
    case "written_off":
      return "Written off";
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
    case "applied":
      return "Applied";
    default:
      return null;
  }
}

export function paperModel(doc: DocumentData, business: Business, branding: Branding, today: string): Paper {
  const quote = doc.kind === "quote";
  const credit = doc.kind === "credit_note";
  const totals = computeTotals(doc);
  const paid = quote || credit ? 0 : doc.amount_paid;
  const credited = quote || credit ? 0 : Number(doc.credited_total ?? 0);
  const owed = Math.round((totals.total - paid - credited) * 100) / 100;
  const balance = Math.max(0, owed);
  const refund = Math.max(0, -owed);
  const voided = doc.status === "void";
  const money = (v: number) => docMoney(v, doc.currency);
  const inclusive = !!doc.prices_include_tax;
  const taxInvoice = !!business.tax_registered && !quote && totals.taxes.length > 0;
  const foreign = doc.currency.toUpperCase() !== "LKR";
  const rate = foreign && doc.exchange_rate ? Number(doc.exchange_rate) : null;
  const lkr = (v: number) => docMoney(Math.round(v * (rate ?? 1) * 100) / 100, "LKR");

  const title = credit ? "Credit note" : quote ? "Quotation" : taxInvoice ? "Tax invoice" : "Invoice";
  const dueDays =
    !quote && !credit && doc.due_date ? Math.round((Date.parse(doc.due_date) - Date.parse(doc.issue_date)) / 86_400_000) : null;

  const amountLine = credit
    ? doc.credited_number
      ? `Credits ${doc.credited_number}${doc.credit_reason ? ` · ${reasonLabel(doc.credit_reason)}` : ""}`
      : "Credits an invoice"
    : quote
      ? doc.valid_until
        ? `Valid until ${formatDate(doc.valid_until)}`
        : `Prepared ${formatDate(doc.issue_date)}`
      : voided
        ? "This invoice was voided — nothing is due."
        : refund > 0
          ? `${money(refund)} is owed back to you.`
          : balance <= 0 && totals.total > 0
            ? credited > 0 && paid <= 0
              ? "Settled by credit note."
              : "Paid in full — thank you."
            : paid > 0 || credited > 0
              ? `${money(paid + credited)} of ${money(totals.total)} settled${doc.due_date ? ` · ${doc.due_date < today ? "was due" : "due"} ${formatDate(doc.due_date)}` : ""}`
              : doc.due_date
                ? `${doc.due_date < today && doc.status !== "draft" ? "Was due" : "Due by"} ${formatDate(doc.due_date)}`
                : "Due on receipt";

  const details: [string, string][] = [["Issued", formatDate(doc.issue_date)]];
  if (taxInvoice) details.push(["Supplied", formatDate(doc.supply_date || doc.issue_date)]);
  if (credit) details.push(["Credits", doc.credited_number ?? "—"]);
  else if (quote) details.push(["Valid until", doc.valid_until ? formatDate(doc.valid_until) : "—"]);
  else {
    details.push(["Due", doc.due_date ? formatDate(doc.due_date) : "On receipt"]);
    details.push(["Terms", dueDays == null || dueDays <= 0 ? "On receipt" : `Net ${dueDays}`]);
  }
  if (foreign) details.push(["Currency", doc.currency.toUpperCase()]);
  if (rate) details.push(["Rate", `Rs ${trimNum(rate, 4)}`]);

  const plainTaxes = [...new Set(totals.taxes.filter((x) => !x.compound).map((x) => x.name))];
  const taxTerm = (x: { name: string; rate: number; compound: boolean }) =>
    `${x.name} (${trimNum(x.rate, 3)}%${x.compound && plainTaxes.length ? ` on amount + ${plainTaxes.join(" + ")}` : ""}${inclusive ? ", included" : ""})`;

  const items = doc.items.filter((i) => i.description.trim() || Number(i.unit_price) > 0);
  const taxSets = new Set(items.map((i) => (i.taxes ?? []).map((x) => `${x.name}:${Number(x.rate)}:${!!x.compound}`).join("|")));

  return {
    quote,
    credit,
    voided,
    title,
    totals,
    paid,
    credited,
    balance,
    refund,
    badge: badgeFor(doc, totals.total, today),
    amountLabel: credit ? "Credit amount" : quote ? "Quote total" : voided ? "Amount" : refund > 0 ? "Refund due" : "Amount due",
    amountValue: credit || quote || voided ? totals.total : refund > 0 ? refund : balance,
    amountLine,
    inclusive,
    taxInvoice,
    foreign,
    rate,
    details,
    showLineTax: taxSets.size > 1,
    dueDays,
    footerText:
      branding.footer_text?.trim() ||
      (credit
        ? `This credit note reduces what's owed on ${doc.credited_number ?? "the invoice"}.`
        : quote
          ? "We'd love to work with you."
          : "Thank you for your business."),
    colors: palette(branding.accent_color),
    money,
    lkr,
    taxTerm,
  };
}
