/**
 * Suppliers and bills (0040) — row shapes and the small pure helpers the
 * Bills and Suppliers screens share.
 */
import { num } from "./format";

export type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  default_category: string | null;
  notes: string | null;
  active: boolean;
};

export type BillStatus = "draft" | "open" | "partially_paid" | "paid" | "void";

export type BillTaxLine = { name: string; rate: number | null; amount: number };

export type Bill = {
  id: string;
  supplier_id: string;
  reference: string | null;
  bill_date: string;
  due_date: string | null;
  currency: string;
  exchange_rate: number | null;
  description: string | null;
  category: string;
  subtotal: number;
  tax_breakdown: BillTaxLine[];
  tax_total: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  status: BillStatus;
  notes: string | null;
  schedule_id: string | null;
  paid_at: string | null;
  created_at: string;
  supplier?: { name: string } | null;
  bill_payments?: BillPayment[];
};

export type BillPayment = {
  id: string;
  bill_id: string;
  amount: number;
  amount_base: number | null;
  paid_on: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  created_at: string;
};

export type BillSchedule = {
  id: string;
  supplier_id: string;
  name: string;
  description: string | null;
  category: string;
  amount: number;
  tax_breakdown: BillTaxLine[];
  currency: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  interval_count: number;
  next_run_on: string;
  due_days: number;
  ends_on: string | null;
  active: boolean;
  supplier?: { name: string } | null;
};

export const BILL_STATUS: Record<BillStatus | "overdue", { label: string; tone: "muted" | "cream" | "terra" | "success" | "danger" }> = {
  draft: { label: "Draft", tone: "muted" },
  open: { label: "Unpaid", tone: "cream" },
  partially_paid: { label: "Part paid", tone: "terra" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "muted" },
  overdue: { label: "Overdue", tone: "danger" },
};

export const billStatus = (b: Pick<Bill, "status" | "due_date" | "balance_due">, today: string) =>
  (b.status === "open" || b.status === "partially_paid") && b.due_date && b.due_date < today && num(b.balance_due) > 0 ? "overdue" : b.status;

/** A bill's taxes from rates: each one's amount on the amount before tax. */
export const taxAmount = (subtotal: number, rate: number) => Math.round(subtotal * rate) / 100;
