import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { num, todayISO } from "@/lib/admin/format";
import {
  fillMonths,
  isDay,
  monthStart,
  periodLabel,
  periodRange,
  previousRange,
  type MonthRow,
  type Period,
} from "@/lib/admin/reports";
import ProfitLoss, { type PnlTotals } from "./ProfitLoss";

export const metadata: Metadata = { title: "Profit & loss" };

type RawPnl = {
  from?: string;
  to?: string;
  income_total?: number;
  expense_total?: number;
  net?: number;
  margin?: number | null;
  by_category?: { kind: string; category: string; amount: number }[];
  monthly?: MonthRow[];
  previous?: { from?: string; to?: string; income_total?: number; expense_total?: number; net?: number } | null;
};

const totalsOf = (r: { income_total?: number; expense_total?: number; net?: number } | null | undefined): PnlTotals => {
  const income = num(r?.income_total);
  const expense = num(r?.expense_total);
  return { income, expense, net: r?.net !== undefined && r?.net !== null ? num(r.net) : income - expense };
};

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; at?: string; from?: string; to?: string }>;
}) {
  const { supabase, profile } = await requireModule("reports");
  const sp = await searchParams;
  const today = todayISO();

  // The tax year's first month (April in Sri Lanka) — invoice settings are readable with Reports.
  const { data: cfg } = await supabase
    .from("invoice_settings")
    .select("fiscal_year_start_month")
    .eq("workspace", profile.workspace)
    .maybeSingle<{ fiscal_year_start_month: number | null }>();
  const fyStart = cfg?.fiscal_year_start_month ?? 4;

  const custom = sp.period === "custom" && isDay(sp.from) && isDay(sp.to) && sp.from <= sp.to;
  const period: Period = custom
    ? "custom"
    : sp.period === "quarter" || sp.period === "year" || sp.period === "tax_year"
      ? sp.period
      : "month";
  const at = isDay(sp.at) ? sp.at : today;
  const range = custom ? { from: sp.from!, to: sp.to! } : periodRange(period as Exclude<Period, "custom">, at, fyStart);
  const prev =
    period === "custom"
      ? previousRange(range.from, range.to)
      : periodRange(period, monthStart(range.from, period === "month" ? -1 : period === "quarter" ? -3 : -12), fyStart);

  // The trend always shows at least the 12 months ending with the period.
  const trendFrom = monthStart(range.to, -11) < range.from ? monthStart(range.to, -11) : range.from;

  const [main, trend] = await Promise.all([
    supabase.rpc("report_pnl", { p_from: range.from, p_to: range.to }),
    trendFrom < range.from ? supabase.rpc("report_pnl", { p_from: trendFrom, p_to: range.to }) : Promise.resolve(null),
  ]);

  const data = (main.error ? null : main.data) as RawPnl | null;
  const trendData = (trend && !trend.error ? trend.data : data) as RawPnl | null;

  // Name the comparison after the range the database actually used.
  const prevFrom = isDay(data?.previous?.from) ? data.previous.from : prev.from;
  const prevTo = isDay(data?.previous?.to) ? data.previous.to : prev.to;
  const previousLabel =
    prevFrom === prev.from && prevTo === prev.to ? periodLabel(period, prev.from, prev.to) : periodLabel("custom", prevFrom, prevTo);

  return (
    <ProfitLoss
      error={main.error ? main.error.message : null}
      period={period}
      at={at}
      from={range.from}
      to={range.to}
      label={periodLabel(period, range.from, range.to)}
      previousLabel={previousLabel}
      current={totalsOf(data)}
      previous={data?.previous ? totalsOf(data.previous) : null}
      categories={(data?.by_category ?? []).map((c) => ({ kind: c.kind === "income" ? "income" : "expense", category: c.category, amount: num(c.amount) }))}
      months={fillMonths(trendFrom, range.to, (trendData?.monthly ?? []).map((m) => ({ ...m, month: String(m.month) })))}
      isCurrent={range.from <= today && today <= range.to}
      fyStart={fyStart}
    />
  );
}
