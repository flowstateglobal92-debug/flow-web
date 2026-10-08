import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { num, todayISO } from "@/lib/admin/format";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { isDay, type CashflowInputs } from "@/lib/admin/reports";
import Cashflow from "./Cashflow";

export const metadata: Metadata = { title: "Cash-flow forecast" };

const WEEKS = 12;

export default async function CashflowPage() {
  const { supabase, profile } = await requireModule("reports");

  const [inputs, terms] = await Promise.all([
    supabase.rpc("report_cashflow_inputs", { p_weeks: WEEKS }),
    // Recurring invoices are paid on their terms, not the day they're generated.
    supabase
      .from("invoice_settings")
      .select("default_due_days")
      .eq("workspace", profile.workspace)
      .maybeSingle<{ default_due_days: number | null }>(),
  ]);

  const raw = (inputs.error ? null : inputs.data) as Partial<CashflowInputs> | null;
  const data: CashflowInputs | null = raw
    ? {
        as_of: isDay(raw.as_of) ? raw.as_of : todayISO(),
        opening_balance: num(raw.opening_balance),
        opening_balance_on: isDay(raw.opening_balance_on) ? raw.opening_balance_on : null,
        receivables: (raw.receivables ?? []).map((r) => ({
          id: r.id,
          number: r.number ?? null,
          client: r.client ?? null,
          due_date: isDay(r.due_date) ? r.due_date : null,
          balance: num(r.balance),
        })),
        recurring: (raw.recurring ?? []).map((r) => ({
          schedule_id: r.schedule_id,
          name: r.name,
          run_on: r.run_on,
          amount: num(r.amount),
        })),
        payables: (raw.payables ?? []).map((b) => ({
          id: b.id,
          reference: b.reference ?? null,
          supplier: b.supplier ?? null,
          due_date: isDay(b.due_date) ? b.due_date : null,
          balance: num(b.balance),
        })),
        recurring_bills: (raw.recurring_bills ?? []).map((b) => ({
          schedule_id: b.schedule_id,
          name: b.name,
          due_on: b.due_on,
          amount: num(b.amount),
        })),
        expense_monthly_avg: num(raw.expense_monthly_avg),
        budgets_monthly_total: num(raw.budgets_monthly_total),
      }
    : null;

  const lag = terms.error || terms.data?.default_due_days == null ? 14 : Math.max(0, num(terms.data.default_due_days, 14));

  return (
    <Cashflow
      inputs={data}
      error={inputs.error ? inputs.error.message : null}
      weeks={WEEKS}
      lagDays={lag}
      canEditOpening={isApprover(profile)}
      canInvoices={canAccess(profile, "invoices")}
    />
  );
}
