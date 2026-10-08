import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { todayISO } from "@/lib/admin/format";
import type { Bill, BillSchedule, Supplier } from "@/lib/admin/bills";
import { loadTaxRates } from "../../invoices/data";
import BillsScreen from "./BillsScreen";

export const metadata: Metadata = { title: "Bills" };

/** Supplier bills: what's owed, what's overdue, paying them, and the recurring ones (0040). */
export default async function BillsPage() {
  const { supabase } = await requireModule("finance");
  // Recurring bills due by today are raised before the list is read.
  const caughtUp = await supabase.rpc("run_bill_schedules");
  const [bills, suppliers, schedules, taxRates] = await Promise.all([
    supabase
      .from("bills")
      .select("*, supplier:suppliers(name), bill_payments(*)")
      .order("bill_date", { ascending: false })
      .limit(500)
      .returns<Bill[]>(),
    supabase.from("suppliers").select("*").order("name").returns<Supplier[]>(),
    supabase.from("bill_schedules").select("*, supplier:suppliers(name)").order("next_run_on").returns<BillSchedule[]>(),
    loadTaxRates(supabase),
  ]);

  return (
    <BillsScreen
      ready={!bills.error && !caughtUp.error}
      bills={bills.data ?? []}
      suppliers={suppliers.data ?? []}
      schedules={schedules.data ?? []}
      taxRates={taxRates.filter((r) => r.active)}
      today={todayISO()}
    />
  );
}
