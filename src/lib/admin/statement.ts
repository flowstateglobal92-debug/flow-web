/**
 * Statements of account (0037): the shape client_statement() returns, read
 * into numbers, plus the period presets the statement page offers.
 */
import { num } from "./format";
import { monthStart, periodRange, plusDays } from "./reports";

export type StatementLine = {
  date: string;
  type: "invoice" | "credit_note" | "payment" | "refund";
  doc_id: string;
  ref: string | null;
  detail: string;
  debit: number;
  credit: number;
  balance: number;
};

export type StatementOpen = {
  id: string;
  number: string | null;
  issue_date: string;
  due_date: string | null;
  total: number;
  balance: number;
  days_overdue: number;
};

export type Statement = {
  client: { id: string; name: string; company: string | null; email: string | null; address: string | null; tax_id: string | null };
  currency: string;
  currencies: string[];
  from: string;
  to: string;
  opening: number;
  closing: number;
  period_debit: number;
  period_credit: number;
  lines: StatementLine[];
  open: StatementOpen[];
};

export function readStatement(raw: unknown): Statement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lines = (Array.isArray(r.lines) ? r.lines : []) as Record<string, unknown>[];
  const open = (Array.isArray(r.open) ? r.open : []) as Record<string, unknown>[];
  return {
    client: r.client as Statement["client"],
    currency: String(r.currency ?? "LKR"),
    currencies: (Array.isArray(r.currencies) ? r.currencies : []).map(String),
    from: String(r.from),
    to: String(r.to),
    opening: num(r.opening as number),
    closing: num(r.closing as number),
    period_debit: num(r.period_debit as number),
    period_credit: num(r.period_credit as number),
    lines: lines.map((l) => ({
      date: String(l.date),
      type: l.type as StatementLine["type"],
      doc_id: String(l.doc_id),
      ref: (l.ref as string | null) ?? null,
      detail: String(l.detail ?? ""),
      debit: num(l.debit as number),
      credit: num(l.credit as number),
      balance: num(l.balance as number),
    })),
    open: open.map((o) => ({
      id: String(o.id),
      number: (o.number as string | null) ?? null,
      issue_date: String(o.issue_date),
      due_date: (o.due_date as string | null) ?? null,
      total: num(o.total as number),
      balance: num(o.balance as number),
      days_overdue: num(o.days_overdue as number),
    })),
  };
}

export type StatementPreset = "last_month" | "this_month" | "quarter" | "tax_year" | "custom";

export const STATEMENT_PRESETS: { value: StatementPreset; label: string }[] = [
  { value: "last_month", label: "Last month" },
  { value: "this_month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "tax_year", label: "Tax year" },
  { value: "custom", label: "Custom" },
];

export function statementRange(preset: StatementPreset, today: string, fyStart = 4) {
  if (preset === "this_month") return periodRange("month", today);
  if (preset === "quarter") return periodRange("quarter", today);
  if (preset === "tax_year") return { from: periodRange("tax_year", today, fyStart).from, to: today };
  const last = monthStart(today, -1);
  return { from: last, to: plusDays(monthStart(today, 0), -1) };
}

/** "Payment · Bank transfer" for the type column. */
export const LINE_LABEL: Record<StatementLine["type"], string> = {
  invoice: "Invoice",
  credit_note: "Credit note",
  payment: "Payment",
  refund: "Refund",
};
