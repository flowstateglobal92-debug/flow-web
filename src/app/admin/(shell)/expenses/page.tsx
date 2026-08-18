import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import type { FinanceEntry, FinanceTotals } from "@/lib/admin/types";
import { PageHead } from "@/components/admin/ui";
import Ledger from "./Ledger";

export const metadata: Metadata = { title: "Expenses" };

type Monthly = { month: string; income: number; expense: number; profit: number; entries: number };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; kind?: string; q?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { month = "all", kind = "all", q = "" } = await searchParams;

  let query = supabase
    .from("finance_entries")
    .select("id, kind, entry_date, description, category, amount, signed_amount, currency, method, reference, created_at")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (month !== "all" && /^\d{4}-\d{2}$/.test(month)) {
    const start = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString().slice(0, 10);
    query = query.gte("entry_date", start).lt("entry_date", end);
  }
  if (kind === "income" || kind === "expense") query = query.eq("kind", kind);
  if (q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`description.ilike.${term},category.ilike.${term},reference.ilike.${term}`);
  }

  const [{ data: entries }, { data: totals }, { data: monthly }] = await Promise.all([
    query.returns<FinanceEntry[]>(),
    supabase.from("finance_totals").select("income, expense, profit, entries").maybeSingle<FinanceTotals>(),
    supabase
      .from("finance_monthly")
      .select("month, income, expense, profit, entries")
      .order("month", { ascending: false })
      .limit(18)
      .returns<Monthly[]>(),
  ]);

  return (
    <>
      <PageHead
        eyebrow="Books"
        title="Expenses & income"
        hint="One permanent ledger for the business. Every expense subtracts, every payment adds — profit and loss follows automatically and goes negative when it should."
      />
      <Ledger
        entries={entries ?? []}
        totals={totals ?? { income: 0, expense: 0, profit: 0, entries: 0 }}
        monthly={(monthly ?? []).map((m) => ({
          ...m,
          income: Number(m.income ?? 0),
          expense: Number(m.expense ?? 0),
          profit: Number(m.profit ?? 0),
        }))}
        month={month}
        kind={kind}
        query={q}
      />
    </>
  );
}
