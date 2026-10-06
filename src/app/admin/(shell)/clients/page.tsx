import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { canAccess } from "@/lib/admin/modules";
import { loadTeam } from "@/lib/admin/team";
import { Notice, PageHead } from "@/components/admin/ui";
import { rowsOrEmpty, selectTolerant } from "./data";
import {
  BILLED_STATUSES,
  CLIENT_COLUMNS,
  OPEN_STATUSES,
  clientTitle,
  sumByCurrency,
  type Client,
} from "./model";
import ClientsList, { type ClientSummary, type ListTab } from "./ClientsList";

export const metadata: Metadata = { title: "Clients" };

/** "All" is everyone you still work with — archived clients wait in their own tab. */
const TABS: { key: ListTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "prospect", label: "Prospects" },
  { key: "archived", label: "Archived" },
];

type BilledRow = {
  client_id: string;
  number: string | null;
  issue_date: string;
  status: string;
  currency: string;
  balance_due: number;
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; scope?: string; new?: string }>;
}) {
  const { supabase, profile } = await requireModule("clients");
  const { status = "all", q = "", scope = "all", new: startNew } = await searchParams;
  const tab = TABS.find((t) => t.key === status)?.key ?? "all";
  const mine = scope === "mine";
  const canInvoices = canAccess(profile, "invoices");
  // Commas and brackets would break PostgREST's or() syntax.
  const term = q.trim().replace(/[,()]/g, " ");

  const [list, counts, team, billed] = await Promise.all([
    selectTolerant<Client>(
      (columns) => {
        let query = supabase.from("clients").select(columns);
        query = tab === "all" ? query.neq("status", "archived") : query.eq("status", tab);
        if (mine) query = query.eq("account_manager_id", profile.id);
        if (term) {
          const like = `%${term}%`;
          query = query.or(
            `name.ilike.${like},company.ilike.${like},email.ilike.${like},phone.ilike.${like},city.ilike.${like}`,
          );
        }
        return query.order("name", { ascending: true }).limit(300).returns<Client[]>();
      },
      CLIENT_COLUMNS,
      "account_manager_id",
    ),
    Promise.all(
      TABS.map(async (t) => {
        let query = supabase.from("clients").select("id", { count: "exact", head: true });
        query = t.key === "all" ? query.neq("status", "archived") : query.eq("status", t.key);
        if (mine) query = query.eq("account_manager_id", profile.id);
        const { count } = await query;
        return [t.key, count ?? 0] as const;
      }),
    ),
    loadTeam(supabase),
    // Balances and last invoice — only for people who can see money.
    canInvoices
      ? rowsOrEmpty(
          supabase
            .from("invoices")
            .select("client_id, number, issue_date, status, currency, balance_due")
            .eq("kind", "invoice")
            .in("status", BILLED_STATUSES)
            .not("client_id", "is", null)
            .order("issue_date", { ascending: false })
            .limit(2000)
            .returns<BilledRow[]>(),
        )
      : Promise.resolve([] as BilledRow[]),
  ]);

  const clients = [...list.rows].sort((a, b) => clientTitle(a).localeCompare(clientTitle(b)));

  // Rows arrive newest first, so the first one per client is its latest invoice.
  const grouped = new Map<string, BilledRow[]>();
  for (const row of billed) {
    const rows = grouped.get(row.client_id);
    if (rows) rows.push(row);
    else grouped.set(row.client_id, [row]);
  }
  const summary: Record<string, ClientSummary> = {};
  for (const c of clients) {
    const rows = grouped.get(c.id);
    if (!rows) continue;
    summary[c.id] = {
      balance: sumByCurrency(
        rows.filter((r) => OPEN_STATUSES.includes(r.status)),
        (r) => r.currency,
        (r) => Number(r.balance_due),
      ),
      last: { number: rows[0].number, issue_date: rows[0].issue_date },
    };
  }

  const countBy = Object.fromEntries(counts) as Record<ListTab, number>;
  const managers = team.filter((m) => canAccess({ ...m, workspace: profile.workspace }, "clients"));

  return (
    <>
      <PageHead
        eyebrow="Accounts"
        title="Clients"
        hint="Everyone you bill, or are about to. Open a client for their invoices, deals, upcoming work and the team's notes."
      />
      {!list.ready && (
        <div className="mb-4">
          <Notice title="Clients isn't set up yet">
            Run <code className="font-mono">supabase/migrations/0011_clients.sql</code> and reload.
          </Notice>
        </div>
      )}
      <ClientsList
        clients={clients}
        summary={summary}
        team={team}
        managers={managers}
        me={profile.id}
        tabs={TABS.map((t) => ({ ...t, count: countBy[t.key] ?? 0 }))}
        activeTab={tab}
        query={q}
        mine={mine}
        can={{ invoices: canInvoices, ownership: list.full }}
        startNew={startNew === "1"}
      />
    </>
  );
}
