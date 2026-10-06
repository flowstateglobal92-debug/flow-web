/**
 * Invoices, quotes and recurring schedules — row shapes, the editor's input
 * shapes and the small pure helpers the screens share.
 *
 * Mirrors supabase/migrations/0013_invoices.sql, 0014_quotes.sql and
 * 0015_recurring_invoices.sql. Columns added by later migrations are optional
 * so a page still renders while a migration is pending.
 */
import { CURRENCY_SYMBOL, addDays, money, num } from "./format";

export type InvoiceKind = "invoice" | "quote";

export type InvoiceStatus = "draft" | "pending_approval" | "issued" | "partially_paid" | "paid" | "void";
export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "converted";
export type DocStatus = InvoiceStatus | QuoteStatus;

export type DiscountType = "amount" | "percent";

export type Invoice = {
  id: string;
  kind: InvoiceKind;
  number: string | null;
  status: DocStatus;
  client_id: string | null;
  lead_id: string | null;
  owner_id: string | null;
  bill_to_name: string;
  bill_to_company: string | null;
  bill_to_email: string | null;
  bill_to_phone: string | null;
  bill_to_address: string | null;
  subject: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  discount_type: DiscountType;
  discount_value: number;
  tax_label: string;
  tax_rate: number;
  notes: string | null;
  terms: string | null;
  payment_details: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  issued_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  /* 0014 */
  valid_until?: string | null;
  accepted_at?: string | null;
  declined_at?: string | null;
  source_quote_id?: string | null;
  converted_invoice_id?: string | null;
  /* 0015 */
  schedule_id?: string | null;
  period_start?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  details: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
};

export type InvoicePayment = {
  id: string;
  invoice_id: string;
  amount: number;
  amount_base: number;
  paid_on: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

/** A row in the Issued list carries its payments so "→ Unpaid" can list them. */
export type InvoiceWithPayments = Invoice & {
  invoice_payments?: Pick<InvoicePayment, "id" | "amount" | "amount_base" | "paid_on" | "method" | "reference">[];
};

export type InvoiceSettings = {
  workspace: string;
  business_name: string;
  business_email: string | null;
  business_phone: string | null;
  business_address: string | null;
  business_website: string | null;
  tax_id: string | null;
  default_currency: string;
  tax_label: string;
  default_tax_rate: number;
  default_due_days: number;
  default_notes: string | null;
  default_terms: string | null;
  payment_details: string | null;
  invoice_prefix: string;
  quote_prefix: string;
  next_invoice_number: number;
  next_quote_number: number;
};

/** What the document needs to print the "From" block and footer. */
export type Business = Pick<
  InvoiceSettings,
  "business_name" | "business_email" | "business_phone" | "business_address" | "business_website" | "tax_id"
>;

export const DEFAULT_SETTINGS: InvoiceSettings = {
  workspace: "live",
  business_name: "Flow State",
  business_email: "support@flowstate.lk",
  business_phone: null,
  business_address: null,
  business_website: "www.flowstate.lk",
  tax_id: null,
  default_currency: "LKR",
  tax_label: "VAT",
  default_tax_rate: 0,
  default_due_days: 14,
  default_notes: null,
  default_terms: null,
  payment_details: null,
  invoice_prefix: "INV",
  quote_prefix: "QT",
  next_invoice_number: 1,
  next_quote_number: 1,
};

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

export type InvoiceSchedule = {
  id: string;
  name: string;
  is_retainer: boolean;
  client_id: string | null;
  owner_id: string | null;
  template: ScheduleTemplate;
  amount: number;
  currency: string;
  frequency: Frequency;
  interval_count: number;
  anchor_date: string;
  next_run_on: string;
  ends_on: string | null;
  max_occurrences: number | null;
  occurrences: number;
  auto_issue: boolean;
  active: boolean;
  last_invoice_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceKpis = {
  issued_total: number;
  issued_count: number;
  received_total: number;
  outstanding_total: number;
  outstanding_count: number;
  overdue_total: number;
  overdue_count: number;
  currency: string;
  other_currencies: string[];
};

/** Picker rows — just enough to autofill the bill-to block. */
export type ClientOption = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
};

export type LeadOption = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  client_id: string | null;
};

/* ───────────────────────────── editor input ───────────────────────────── */

export type ItemInput = { description: string; details: string | null; quantity: number; unit_price: number };

/** The `save_invoice` p_invoice keys plus the items, as the editor sends them. */
export type DocumentInput = {
  id?: string;
  kind: InvoiceKind;
  client_id: string | null;
  lead_id: string | null;
  owner_id: string | null;
  bill_to_name: string;
  bill_to_company: string | null;
  bill_to_email: string | null;
  bill_to_phone: string | null;
  bill_to_address: string | null;
  subject: string | null;
  issue_date: string;
  due_date: string | null;
  valid_until: string | null;
  currency: string;
  discount_type: DiscountType;
  discount_value: number;
  tax_label: string;
  tax_rate: number;
  notes: string | null;
  terms: string | null;
  payment_details: string | null;
  items: ItemInput[];
};

/** A schedule's template: the same header keys minus the dates, plus the items. */
export type ScheduleTemplate = Partial<Omit<DocumentInput, "id" | "kind" | "issue_date" | "due_date" | "valid_until">>;

export type ScheduleInput = {
  name: string;
  is_retainer: boolean;
  frequency: Frequency;
  interval_count: number;
  anchor_date: string;
  next_run_on: string;
  ends_on: string | null;
  max_occurrences: number | null;
  auto_issue: boolean;
  active: boolean;
};

/** Everything the paper needs. The preview builds it from the form; print from the row. */
export type DocumentData = {
  kind: InvoiceKind;
  number: string | null;
  status: DocStatus;
  bill_to_name: string;
  bill_to_company: string | null;
  bill_to_email: string | null;
  bill_to_phone: string | null;
  bill_to_address: string | null;
  subject: string | null;
  issue_date: string;
  due_date: string | null;
  valid_until: string | null;
  currency: string;
  discount_type: DiscountType;
  discount_value: number | string;
  tax_label: string;
  tax_rate: number | string;
  notes: string | null;
  terms: string | null;
  payment_details: string | null;
  items: { description: string; details: string | null; quantity: number | string; unit_price: number | string }[];
  amount_paid: number;
  paid_at: string | null;
};

export function documentFromRow(row: Invoice, items: InvoiceItem[]): DocumentData {
  return {
    kind: row.kind,
    number: row.number,
    status: row.status,
    bill_to_name: row.bill_to_name,
    bill_to_company: row.bill_to_company,
    bill_to_email: row.bill_to_email,
    bill_to_phone: row.bill_to_phone,
    bill_to_address: row.bill_to_address,
    subject: row.subject,
    issue_date: row.issue_date,
    due_date: row.due_date,
    valid_until: row.valid_until ?? null,
    currency: row.currency,
    discount_type: row.discount_type,
    discount_value: num(row.discount_value),
    tax_label: row.tax_label,
    tax_rate: num(row.tax_rate),
    notes: row.notes,
    terms: row.terms,
    payment_details: row.payment_details,
    items: [...items]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ description: i.description, details: i.details, quantity: num(i.quantity), unit_price: num(i.unit_price) })),
    amount_paid: num(row.amount_paid),
    paid_at: row.paid_at,
  };
}

export function businessFrom(settings: InvoiceSettings): Business {
  return {
    business_name: settings.business_name,
    business_email: settings.business_email,
    business_phone: settings.business_phone,
    business_address: settings.business_address,
    business_website: settings.business_website,
    tax_id: settings.tax_id,
  };
}

/* ─────────────────────────────── statuses ─────────────────────────────── */

/** What a row reads as today: stored status plus the two date-derived states. */
export type DisplayStatus = DocStatus | "overdue";

export function displayStatus(
  doc: Pick<Invoice, "kind" | "status" | "due_date" | "total" | "amount_paid"> & { valid_until?: string | null },
  today: string,
): DisplayStatus {
  if (doc.kind === "quote") {
    if (doc.status === "sent" && doc.valid_until && doc.valid_until < today) return "expired";
    return doc.status;
  }
  const open = doc.status === "issued" || doc.status === "partially_paid";
  if (open && doc.due_date && doc.due_date < today && num(doc.total) - num(doc.amount_paid) > 0) return "overdue";
  return doc.status;
}

type Tone = "neutral" | "terra" | "cream" | "success" | "warn" | "danger" | "muted";

export const STATUS_META: Record<DisplayStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "muted" },
  pending_approval: { label: "Awaiting approval", tone: "warn" },
  issued: { label: "Unpaid", tone: "cream" },
  partially_paid: { label: "Part paid", tone: "terra" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "muted" },
  overdue: { label: "Overdue", tone: "danger" },
  sent: { label: "Sent", tone: "cream" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "muted" },
  converted: { label: "Invoiced", tone: "terra" },
};

/** Where the Unpaid · Part paid · Paid switch sits for an issued invoice. */
export type PaymentState = "unpaid" | "part" | "paid";

export function paymentState(doc: Pick<Invoice, "status" | "amount_paid">): PaymentState {
  if (doc.status === "paid") return "paid";
  if (doc.status === "partially_paid" || num(doc.amount_paid) > 0) return "part";
  return "unpaid";
}

/** Issued, part paid or paid — the states where payments can be added or removed. */
export const hasPaymentSwitch = (doc: Pick<Invoice, "kind" | "status" | "total">) =>
  doc.kind === "invoice" &&
  (doc.status === "issued" || doc.status === "partially_paid" || doc.status === "paid") &&
  num(doc.total) > 0;

/* ─────────────────────────────── helpers ─────────────────────────────── */

export const CURRENCIES = Object.keys(CURRENCY_SYMBOL);

export const PAYMENT_METHODS = ["Bank transfer", "Cash", "Card", "Cheque", "Online gateway", "Other"] as const;

/** `Rs 1,250.00` / `$ 400.00` — invoices always show cents. */
export const docMoney = (value: number, currency: string) => money(value, { decimals: true, code: currency });

/** Who the document is for, as one line. */
export const billedTo = (doc: Pick<Invoice, "bill_to_name" | "bill_to_company">) =>
  doc.bill_to_company?.trim() || doc.bill_to_name?.trim() || "Untitled";

export const docLabel = (doc: Pick<Invoice, "kind" | "number">) =>
  doc.number ?? (doc.kind === "quote" ? "Draft quote" : "Draft invoice");

/** The one display-name rule (lib/admin/format), under this module's old name. */
export { displayName as personName } from "@/lib/admin/format";

/* ───────────────────────────── recurring ───────────────────────────── */

export const FREQUENCIES: { value: Frequency; label: string; unit: string }[] = [
  { value: "weekly", label: "Weekly", unit: "week" },
  { value: "monthly", label: "Monthly", unit: "month" },
  { value: "quarterly", label: "Quarterly", unit: "quarter" },
  { value: "yearly", label: "Yearly", unit: "year" },
];

export function cadenceLabel(frequency: Frequency, every: number) {
  const f = FREQUENCIES.find((x) => x.value === frequency) ?? FREQUENCIES[1];
  return every > 1 ? `Every ${every} ${f.unit}s` : f.label;
}

/**
 * Step a date by `count` periods from its anchor. Months clamp to the last
 * day instead of drifting (31 Jan → 28 Feb → 31 Mar), as the SQL does.
 */
export function addPeriods(anchor: string, frequency: Frequency, count: number) {
  if (frequency === "weekly") return addDays(anchor, 7 * count);
  const [y, m, d] = anchor.slice(0, 10).split("-").map(Number);
  const months = (frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12) * count;
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** A schedule's amount normalised to one month — the MRR contribution. */
export function monthlyValue(amount: number, frequency: Frequency, every: number) {
  const n = Math.max(1, every);
  const perMonth = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[frequency] ?? 1;
  return (amount * perMonth) / n;
}

/** Has the schedule run its course (end date passed or occurrences used up)? */
export const scheduleEnded = (s: Pick<InvoiceSchedule, "ends_on" | "next_run_on" | "max_occurrences" | "occurrences">) =>
  (!!s.ends_on && s.next_run_on > s.ends_on) || (s.max_occurrences != null && s.occurrences >= s.max_occurrences);

/* ───────────────────────────── editor state ───────────────────────────── */

/**
 * The editor's working copy: every field a string (so "1." can be typed),
 * empty string for "none". Built on the server by the helpers below and
 * turned back into a DocumentInput on save.
 */
export type EditorItem = { description: string; details: string; quantity: string; unit_price: string };

export type EditorDoc = {
  kind: InvoiceKind;
  client_id: string;
  lead_id: string;
  owner_id: string;
  bill_to_name: string;
  bill_to_company: string;
  bill_to_email: string;
  bill_to_phone: string;
  bill_to_address: string;
  subject: string;
  issue_date: string;
  due_date: string;
  valid_until: string;
  currency: string;
  discount_type: DiscountType;
  discount_value: string;
  tax_label: string;
  tax_rate: string;
  notes: string;
  terms: string;
  payment_details: string;
  items: EditorItem[];
};

export type ScheduleDraft = {
  name: string;
  is_retainer: boolean;
  frequency: Frequency;
  interval_count: string;
  anchor_date: string;
  next_run_on: string;
  ends_on: string;
  max_occurrences: string;
  auto_issue: boolean;
  active: boolean;
};

const s = (v: unknown) => (v == null ? "" : String(v));
const blankItem = (): EditorItem => ({ description: "", details: "", quantity: "1", unit_price: "" });

export const clientAddress = (c: Pick<ClientOption, "address" | "city" | "country">) =>
  [c.address, c.city, c.country].map((x) => x?.trim()).filter(Boolean).join("\n");

/** A new invoice or quote with the workspace defaults, optionally pre-billed to a client or lead. */
export function blankEditorDoc(
  settings: InvoiceSettings,
  opts: { kind: InvoiceKind; today: string; ownerId: string; client?: ClientOption | null; lead?: LeadOption | null },
): EditorDoc {
  const { client, lead } = opts;
  return {
    kind: opts.kind,
    client_id: client?.id ?? "",
    lead_id: lead?.id ?? "",
    owner_id: opts.ownerId,
    bill_to_name: client?.name ?? lead?.name ?? "",
    bill_to_company: client?.company ?? lead?.company ?? "",
    bill_to_email: client?.email ?? lead?.email ?? "",
    bill_to_phone: client?.phone ?? lead?.phone ?? "",
    bill_to_address: client ? clientAddress(client) : "",
    subject: "",
    issue_date: opts.today,
    due_date: addDays(opts.today, settings.default_due_days),
    valid_until: addDays(opts.today, 30),
    currency: settings.default_currency,
    discount_type: "amount",
    discount_value: "",
    tax_label: settings.tax_label,
    tax_rate: settings.default_tax_rate ? String(settings.default_tax_rate) : "",
    notes: s(settings.default_notes),
    terms: s(settings.default_terms),
    payment_details: s(settings.payment_details),
    items: [blankItem()],
  };
}

export function editorDocFromRow(row: Invoice, items: InvoiceItem[], settings: InvoiceSettings): EditorDoc {
  return {
    kind: row.kind,
    client_id: s(row.client_id),
    lead_id: s(row.lead_id),
    owner_id: s(row.owner_id),
    bill_to_name: s(row.bill_to_name),
    bill_to_company: s(row.bill_to_company),
    bill_to_email: s(row.bill_to_email),
    bill_to_phone: s(row.bill_to_phone),
    bill_to_address: s(row.bill_to_address),
    subject: s(row.subject),
    issue_date: row.issue_date,
    due_date: s(row.due_date),
    valid_until: s(row.valid_until) || addDays(row.issue_date, 30),
    currency: row.currency || settings.default_currency,
    discount_type: row.discount_type === "percent" ? "percent" : "amount",
    discount_value: num(row.discount_value) ? String(num(row.discount_value)) : "",
    tax_label: row.tax_label || settings.tax_label,
    tax_rate: num(row.tax_rate) ? String(num(row.tax_rate)) : "",
    notes: s(row.notes),
    terms: s(row.terms),
    payment_details: s(row.payment_details),
    items: items.length
      ? [...items]
          .sort((a, b) => a.position - b.position)
          .map((i) => ({
            description: i.description,
            details: s(i.details),
            quantity: String(num(i.quantity, 1)),
            unit_price: String(num(i.unit_price)),
          }))
      : [blankItem()],
  };
}

/** A schedule's template, opened in the editor. Dates are the next run's. */
export function editorDocFromSchedule(schedule: InvoiceSchedule, settings: InvoiceSettings): EditorDoc {
  const t = (schedule.template ?? {}) as ScheduleTemplate;
  const items = Array.isArray(t.items) ? t.items : [];
  return {
    kind: "invoice",
    client_id: s(t.client_id ?? schedule.client_id),
    lead_id: s(t.lead_id),
    owner_id: s(t.owner_id ?? schedule.owner_id),
    bill_to_name: s(t.bill_to_name),
    bill_to_company: s(t.bill_to_company),
    bill_to_email: s(t.bill_to_email),
    bill_to_phone: s(t.bill_to_phone),
    bill_to_address: s(t.bill_to_address),
    subject: s(t.subject),
    issue_date: schedule.next_run_on,
    due_date: addDays(schedule.next_run_on, settings.default_due_days),
    valid_until: "",
    currency: s(t.currency) || schedule.currency || settings.default_currency,
    discount_type: t.discount_type === "percent" ? "percent" : "amount",
    discount_value: num(t.discount_value) ? String(num(t.discount_value)) : "",
    tax_label: s(t.tax_label) || settings.tax_label,
    tax_rate: num(t.tax_rate) ? String(num(t.tax_rate)) : "",
    notes: s(t.notes),
    terms: s(t.terms),
    payment_details: s(t.payment_details),
    items: items.length
      ? items.map((i) => ({
          description: s(i.description),
          details: s(i.details),
          quantity: String(num(i.quantity, 1)),
          unit_price: String(num(i.unit_price)),
        }))
      : [blankItem()],
  };
}

export function scheduleDraftFrom(schedule: InvoiceSchedule): ScheduleDraft {
  return {
    name: schedule.name,
    is_retainer: !!schedule.is_retainer,
    frequency: schedule.frequency,
    interval_count: String(schedule.interval_count || 1),
    anchor_date: schedule.anchor_date,
    next_run_on: schedule.next_run_on,
    ends_on: s(schedule.ends_on),
    max_occurrences: schedule.max_occurrences ? String(schedule.max_occurrences) : "",
    auto_issue: !!schedule.auto_issue,
    active: schedule.active !== false,
  };
}
