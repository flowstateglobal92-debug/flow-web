import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { todayISO } from "@/lib/admin/format";
import { displayName, loadTeam } from "@/lib/admin/team";
import type { InvoiceKpis, InvoiceWithPayments } from "@/lib/admin/invoice-types";
import IssuedList, { type IssuedFilter, type Period } from "./IssuedList";
import { periodBounds, runRecurring, searchTerm } from "./data";

export const metadata: Metadata = { title: "Invoices" };

const FILTERS: IssuedFilter[] = ["all", "unpaid", "part", "paid", "overdue", "pending", "void", "draft"];
const PERIODS: Period[] = ["month", "year", "all"];

export default async function IssuedInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; period?: string; mine?: string; q?: string }>;
}) {
  const { supabase, profile } = await requireModule("invoices");
  const sp = await searchParams;
  const status = (FILTERS.includes(sp.status as IssuedFilter) ? sp.status : "all") as IssuedFilter;
  const period = (PERIODS.includes(sp.period as Period) ? sp.period : "month") as Period;
  const mine = sp.mine === "1";
  const q = searchTerm(sp.q ?? "");
  const today = todayISO();

  // Catch up recurring runs first so a due invoice is already in the list.
  await runRecurring(supabase);

  let query = supabase
    .from("invoices")
    .select("*, invoice_payments(id, amount, amount_base, paid_on, method, reference)")
    .eq("kind", "invoice")
    .order("issue_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);

  if (status === "unpaid") query = query.eq("status", "issued");
  else if (status === "part") query = query.eq("status", "partially_paid");
  else if (status === "paid") query = query.eq("status", "paid");
  else if (status === "overdue") query = query.in("status", ["issued", "partially_paid"]).lt("due_date", today);
  else if (status === "pending") query = query.eq("status", "pending_approval");
  else if (status === "void") query = query.eq("status", "void");
  else if (status === "draft") query = query.eq("status", "draft");
  else query = query.neq("status", "draft");

  if (mine) query = query.eq("owner_id", profile.id);
  if (q) {
    const t = `%${q}%`;
    query = query.or(`number.ilike.${t},bill_to_name.ilike.${t},bill_to_company.ilike.${t},subject.ilike.${t}`);
  }

  const { from, to } = periodBounds(period, today);
  const [{ data: invoices }, { data: kpis }, team] = await Promise.all([
    query.returns<InvoiceWithPayments[]>(),
    supabase.rpc("invoice_kpis", { p_from: from, p_to: to }),
    loadTeam(supabase),
  ]);

  return (
    <IssuedList
      invoices={invoices ?? []}
      kpis={(kpis as InvoiceKpis | null) ?? null}
      people={Object.fromEntries(team.map((m) => [m.id, displayName(m)]))}
      status={status}
      period={period}
      mine={mine}
      query={sp.q ?? ""}
      today={today}
    />
  );
}
