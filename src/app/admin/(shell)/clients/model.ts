/**
 * Clients — row shapes and small helpers shared by the list, the profile and
 * the CRM board. Mirrors supabase/migrations/0011_clients.sql and
 * 0012_record_ownership.sql (account_manager_id).
 *
 * Naming follows leads: `name` is the contact, `company` the business, and the
 * business leads wherever a client is shown — the same way invoices fill
 * bill_to_name / bill_to_company.
 */
import { money } from "@/lib/admin/format";

export type ClientStatus = "active" | "prospect" | "archived";

export type Client = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  tax_id: string | null;
  website: string | null;
  notes: string | null;
  status: ClientStatus;
  account_manager_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** 0011 columns; `account_manager_id` arrives with 0012 and is selected separately so either can lag. */
export const CLIENT_COLUMNS =
  "id, name, company, email, phone, address, city, country, tax_id, website, notes, status, created_by, created_at, updated_at";

/** What a picker needs (the lead modal's client field). */
export type ClientOption = Pick<Client, "id" | "name" | "company" | "status">;

export const CLIENT_STATUSES: ClientStatus[] = ["active", "prospect", "archived"];

export const CLIENT_STATUS: Record<ClientStatus, { label: string; tone: "success" | "terra" | "muted" }> = {
  active: { label: "Active", tone: "success" },
  prospect: { label: "Prospect", tone: "terra" },
  archived: { label: "Archived", tone: "muted" },
};

export const clientTitle = (c: Pick<Client, "name" | "company">) => c.company || c.name;

/** The muted line under the title: the contact when the business leads, else how to reach them. */
export const clientSubtitle = (c: Pick<Client, "name" | "company" | "email" | "phone">) =>
  c.company ? c.name : c.email || c.phone || "No contact details";

/* ───────────────────────────── invoices ──────────────────────────────── */

/** The slice of an invoice or quote the client screens show (0013/0014). */
export type ClientDocument = {
  id: string;
  kind: "invoice" | "quote";
  number: string | null;
  status: string;
  subject: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total: number;
  amount_paid: number;
  balance_due: number;
};

export const DOCUMENT_COLUMNS =
  "id, kind, number, status, subject, issue_date, due_date, currency, total, amount_paid, balance_due";

/** Issued invoices that count as billed — drafts, voids and ones awaiting sign-off don't. */
export const BILLED_STATUSES = ["issued", "partially_paid", "paid"];
export const OPEN_STATUSES = ["issued", "partially_paid"];

type Tone = "neutral" | "terra" | "cream" | "success" | "warn" | "danger" | "muted";

/** Badge for an invoice or quote row. `overdue` is worked out by the caller against today. */
export function documentBadge(doc: Pick<ClientDocument, "kind" | "status">, overdue = false): { label: string; tone: Tone } {
  if (doc.kind === "quote") {
    const q: Record<string, { label: string; tone: Tone }> = {
      draft: { label: "Draft", tone: "muted" },
      sent: { label: "Sent", tone: "cream" },
      accepted: { label: "Accepted", tone: "success" },
      declined: { label: "Declined", tone: "danger" },
      expired: { label: "Expired", tone: "muted" },
      converted: { label: "Invoiced", tone: "muted" },
    };
    return q[doc.status] ?? { label: doc.status, tone: "neutral" };
  }
  if (overdue) return { label: "Overdue", tone: "danger" };
  const i: Record<string, { label: string; tone: Tone }> = {
    draft: { label: "Draft", tone: "muted" },
    pending_approval: { label: "Pending approval", tone: "warn" },
    issued: { label: "Unpaid", tone: "terra" },
    partially_paid: { label: "Part paid", tone: "warn" },
    paid: { label: "Paid", tone: "success" },
    void: { label: "Void", tone: "muted" },
  };
  return i[doc.status] ?? { label: doc.status, tone: "neutral" };
}

/* ───────────────────────────── currencies ────────────────────────────── */

/** Amounts in mixed currencies, summed per currency, largest first. */
export type CurrencyTotals = { code: string; amount: number }[];

export function sumByCurrency<T>(rows: T[], code: (row: T) => string, value: (row: T) => number): CurrencyTotals {
  const by = new Map<string, number>();
  for (const row of rows) {
    const c = (code(row) || "LKR").toUpperCase();
    by.set(c, (by.get(c) ?? 0) + value(row));
  }
  return [...by.entries()].map(([c, amount]) => ({ code: c, amount })).sort((a, b) => b.amount - a.amount);
}

/**
 * Lead with the biggest currency; the rest go on a quiet second line. Never
 * adds rupees to dollars.
 */
export function formatTotals(totals: CurrencyTotals) {
  const [first, ...rest] = totals.filter((t) => t.amount !== 0);
  return {
    main: first ? money(first.amount, { code: first.code }) : money(0),
    rest: rest.length ? `+ ${rest.map((t) => money(t.amount, { code: t.code })).join(" · ")}` : null,
  };
}
