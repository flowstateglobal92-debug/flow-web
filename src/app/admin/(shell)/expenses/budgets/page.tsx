import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { isApprover } from "@/lib/admin/modules";
import Budgets, { type BudgetRow } from "./Budgets";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const { supabase, profile } = await requireModule("finance");

  // budget_status (0017) already knows this period's approved spend per budget.
  const { data, error } = await supabase
    .from("budget_status")
    .select("id, category, period, amount, alert_percent, active, period_start, period_end, spent, percent")
    .order("active", { ascending: false })
    .order("category", { ascending: true })
    .returns<BudgetRow[]>();

  return (
    <Budgets
      budgets={(data ?? []).map((b) => ({
        ...b,
        amount: Number(b.amount ?? 0),
        spent: Number(b.spent ?? 0),
        percent: Number(b.percent ?? 0),
        alert_percent: Number(b.alert_percent ?? 80),
      }))}
      ready={!error}
      canEdit={isApprover(profile)}
    />
  );
}
