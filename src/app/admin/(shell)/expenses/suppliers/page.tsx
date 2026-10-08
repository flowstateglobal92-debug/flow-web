import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import type { Supplier } from "@/lib/admin/bills";
import SuppliersScreen, { type SupplierTotals } from "./SuppliersScreen";

export const metadata: Metadata = { title: "Suppliers" };

/** Who the business buys from, and what's billed, paid and owed to each (0040). */
export default async function SuppliersPage() {
  const { supabase } = await requireModule("finance");
  const [{ data: suppliers, error }, { data: bills }] = await Promise.all([
    supabase.from("suppliers").select("*").order("name").returns<Supplier[]>(),
    supabase
      .from("bills")
      .select("supplier_id, currency, exchange_rate, total, balance_due, status")
      .neq("status", "void")
      .neq("status", "draft")
      .returns<{ supplier_id: string; currency: string; exchange_rate: number | null; total: number; balance_due: number; status: string }[]>(),
  ]);
  const totals: Record<string, SupplierTotals> = {};
  for (const b of bills ?? []) {
    const rate = b.currency === "LKR" ? 1 : b.exchange_rate ? Number(b.exchange_rate) : null;
    if (rate === null) continue;
    const t = (totals[b.supplier_id] ??= { billed: 0, owed: 0, bills: 0 });
    t.billed += Number(b.total) * rate;
    t.owed += Number(b.balance_due) * rate;
    t.bills += 1;
  }
  return <SuppliersScreen ready={!error} suppliers={suppliers ?? []} totals={totals} />;
}
