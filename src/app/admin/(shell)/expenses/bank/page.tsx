import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { canAccess } from "@/lib/admin/modules";
import BankScreen, { type BankAccount, type BankLine } from "./BankScreen";

export const metadata: Metadata = { title: "Bank" };

/** Bank statements, imported and matched to the books (0041). `?account=` picks the account. */
export default async function BankPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { supabase, profile } = await requireModule("finance");
  const { account } = await searchParams;
  const { data: accounts, error } = await supabase.from("bank_accounts").select("*").order("name").returns<BankAccount[]>();
  const current = accounts?.find((a) => a.id === account) ?? accounts?.find((a) => a.active) ?? accounts?.[0] ?? null;
  const { data: lines } = current
    ? await supabase
        .from("bank_lines")
        .select("id, account_id, posted_on, description, reference, amount, balance, status, matched_entry_id, note, entry:finance_entries(description, category)")
        .eq("account_id", current.id)
        .order("posted_on", { ascending: false })
        .limit(2000)
        .returns<BankLine[]>()
    : { data: [] as BankLine[] };

  return (
    <BankScreen
      ready={!error}
      accounts={accounts ?? []}
      account={current}
      lines={lines ?? []}
      canInvoices={canAccess(profile, "invoices")}
    />
  );
}
