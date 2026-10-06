import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { canAccess, isApprover } from "@/lib/admin/modules";
import type { FinanceTotals } from "@/lib/admin/types";
import Ledger from "./Ledger";
import type { LedgerEntry } from "./types";

export const metadata: Metadata = { title: "Expenses" };

type Monthly = { month: string; income: number; expense: number; profit: number; entries: number };

const BASE = "id, kind, entry_date, description, category, amount, signed_amount, currency, method, reference, created_at";
const LINKED = `${BASE}, lead_id, created_by, invoice_id, invoice_payment_id, approval_status, approval_note`;
const FULL = `${LINKED}, finance_attachments(id, file_name, mime_type, size_bytes, created_at)`;
/** Newest shape first; a migration that hasn't run yet steps down a shape instead of blanking the ledger. */
const SHAPES = [FULL, LINKED, BASE];

const STATUSES = ["approved", "pending", "rejected"];

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; kind?: string; q?: string; status?: string; open?: string; new?: string }>;
}) {
  const { supabase, profile } = await requireModule("finance");
  const { month = "all", kind = "all", q = "", status = "all", open, new: create } = await searchParams;

  const select = (columns: string) => {
    let query = supabase
      .from("finance_entries")
      .select(columns)
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
    if (columns !== BASE && STATUSES.includes(status)) query = query.eq("approval_status", status);
    if (q.trim()) {
      const term = `%${q.trim().replace(/[,()]/g, " ")}%`;
      query = query.or(`description.ilike.${term},category.ilike.${term},reference.ilike.${term}`);
    }
    return query;
  };

  const loadEntries = async () => {
    for (const columns of SHAPES) {
      const { data, error } = await select(columns).returns<LedgerEntry[]>();
      if (!error) return { rows: data ?? [], approvals: columns !== BASE };
    }
    return { rows: [] as LedgerEntry[], approvals: false };
  };

  // ?open= may point at an entry outside the current filter — fetch it on its own.
  const loadOne = async (id: string) => {
    for (const columns of SHAPES) {
      const { data, error } = await supabase.from("finance_entries").select(columns).eq("id", id).maybeSingle<LedgerEntry>();
      if (!error) return data;
    }
    return null;
  };

  const [entries, { data: totals }, { data: monthly }, pending] = await Promise.all([
    loadEntries(),
    supabase.from("finance_totals").select("income, expense, profit, entries").maybeSingle<FinanceTotals>(),
    supabase
      .from("finance_monthly")
      .select("month, income, expense, profit, entries")
      .order("month", { ascending: false })
      .limit(18)
      .returns<Monthly[]>(),
    supabase.from("finance_entries").select("id", { count: "exact", head: true }).eq("approval_status", "pending"),
  ]);

  const openId = open && /^[0-9a-f-]{36}$/i.test(open) ? open : null;
  const openEntry = openId ? (entries.rows.find((e) => e.id === openId) ?? (await loadOne(openId))) : null;

  return (
    <Ledger
      entries={entries.rows}
      totals={totals ?? { income: 0, expense: 0, profit: 0, entries: 0 }}
      monthly={(monthly ?? []).map((m) => ({
        ...m,
        income: Number(m.income ?? 0),
        expense: Number(m.expense ?? 0),
        profit: Number(m.profit ?? 0),
      }))}
      month={month}
      kind={kind}
      status={STATUSES.includes(status) ? status : "all"}
      query={q}
      approvals={entries.approvals}
      pendingCount={pending.count ?? 0}
      openEntry={openEntry}
      create={create === "expense" || create === "income" ? create : null}
      canInvoices={canAccess(profile, "invoices")}
      approver={isApprover(profile)}
      workspace={profile.workspace}
    />
  );
}
