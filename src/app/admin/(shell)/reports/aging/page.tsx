import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { CURRENCY_SYMBOL, num } from "@/lib/admin/format";
import { canAccess } from "@/lib/admin/modules";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/admin/reports";
import Aging, { type AgingClient, type AgingReport } from "./Aging";

export const metadata: Metadata = { title: "Receivables aging" };

type Raw = {
  as_of?: string;
  currency?: string;
  totals?: Partial<Record<AgingBucket | "total", number>>;
  clients?: (Partial<Record<AgingBucket | "total", number>> & {
    client_id?: string | null;
    name?: string | null;
    invoices?: { id: string; number: string | null; due_date: string | null; balance: number; days_overdue: number }[];
  })[];
};

const buckets = (r: Partial<Record<AgingBucket | "total", number>> | undefined) => {
  const out = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, num(r?.[b.key])])) as Record<AgingBucket, number>;
  return { ...out, total: r?.total !== undefined ? num(r.total) : Object.values(out).reduce((a, v) => a + v, 0) };
};

export default async function AgingPage({ searchParams }: { searchParams: Promise<{ currency?: string }> }) {
  const { supabase, profile } = await requireModule("reports");
  const { currency: asked = "LKR" } = await searchParams;
  // ALL: every currency in rupees, at each invoice's rate (0031).
  const all = asked.toUpperCase() === "ALL";
  const currency = all ? "LKR" : Object.hasOwn(CURRENCY_SYMBOL, asked.toUpperCase()) ? asked.toUpperCase() : "LKR";

  const { data, error } = await supabase.rpc("report_receivables_aging", { p_currency: all ? "ALL" : currency });
  const raw = (error ? null : data) as Raw | null;

  const report: AgingReport | null = raw
    ? {
        asOf: raw.as_of ?? "",
        totals: buckets(raw.totals),
        clients: (raw.clients ?? [])
          .map(
            (c): AgingClient => ({
              ...buckets(c),
              client_id: c.client_id ?? null,
              name: c.name || "No client",
              invoices: (c.invoices ?? []).map((i) => ({
                id: i.id,
                number: i.number,
                due_date: i.due_date,
                balance: num(i.balance),
                days_overdue: num(i.days_overdue),
              })),
            }),
          )
          .sort((a, b) => b.total - a.total),
      }
    : null;

  return (
    <Aging
      report={report}
      error={error ? error.message : null}
      currency={currency}
      allCurrencies={all}
      unconverted={((raw as { unconverted?: { currency: string; count: number }[] } | null)?.unconverted ?? []).map((u) => `${u.count} ${u.currency}`)}
      canInvoices={canAccess(profile, "invoices")}
      canClients={canAccess(profile, "clients")}
    />
  );
}
