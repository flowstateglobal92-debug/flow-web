import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { todayISO } from "@/lib/admin/format";
import { displayName, loadTeam } from "@/lib/admin/team";
import type { InvoiceKpis, InvoiceWithPayments } from "@/lib/admin/invoice-types";
import IssuedList, { type IssuedFilter, type Period } from "./IssuedList";
import { periodBounds, runRecurring, searchTerm } from "./data";

export const metadata: Metadata = { title: "Invoices" };

const FILTERS: IssuedFilter[] = ["all", "unpaid", "part", "paid", "overdue", "credited", "credit_notes", "pending", "void", "draft"];
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
    .select("*, invoice_payments(id, kind, amount, amount_base, paid_on, method, reference)")
    .order("issue_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);

  // Credit notes list with the invoices (as negatives); their own tab shows only them.
  if (status === "credit_notes") query = query.eq("kind", "credit_note").neq("status", "draft");
  else if (status === "all") query = query.in("kind", ["invoice", "credit_note"]).neq("status", "draft");
  else if (status === "void") query = query.in("kind", ["invoice", "credit_note"]).eq("status", "void");
  else if (status === "draft") query = query.in("kind", ["invoice", "credit_note"]).eq("status", "draft");
  else {
    query = query.eq("kind", "invoice");
    if (status === "unpaid") query = query.eq("status", "issued");
    else if (status === "part") query = query.eq("status", "partially_paid");
    else if (status === "paid") query = query.eq("status", "paid");
    else if (status === "credited") query = query.in("status", ["credited", "written_off"]);
    else if (status === "overdue") query = query.in("status", ["issued", "partially_paid"]).lt("due_date", today);
    else if (status === "pending") query = query.eq("status", "pending_approval");
  }

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
