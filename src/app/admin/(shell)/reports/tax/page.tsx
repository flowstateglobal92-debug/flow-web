import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { num, todayISO } from "@/lib/admin/format";
import { isDay, periodLabel, periodRange, type Period } from "@/lib/admin/reports";
import TaxReport, { type TaxReportData } from "./TaxReport";

export const metadata: Metadata = { title: "Tax report" };

type Raw = {
  output?: { name: string; rate: number; compound: boolean; base: number; amount: number; documents: number }[];
  output_total?: number;
  sales_net?: number;
  sales_total?: number;
  untaxed_total?: number;
  unconverted?: { id: string; number: string | null; currency: string }[];
  documents?: {
    id: string;
    number: string | null;
    kind: string;
    issue_date: string;
    client: string | null;
    tax_id: string | null;
    currency: string;
    net: number;
    tax: number;
    total: number;
  }[];
  input?: { name: string; rate: number; base: number; amount: number; documents: number }[];
  input_total?: number;
};

/**
 * Output tax on documents issued in a period, in rupees (report_tax, 0032 →
 * 0033; bills add input tax in 0040). Tax year, quarter or month — the
 * periods a Sri Lankan VAT return is filed for.
 */
export default async function TaxReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; at?: string; from?: string; to?: string }>;
}) {
  const { supabase, profile } = await requireModule("reports");
  const sp = await searchParams;
  const today = todayISO();
  const { data: cfg } = await supabase
    .from("invoice_settings")
    .select("fiscal_year_start_month")
    .eq("workspace", profile.workspace)
    .maybeSingle<{ fiscal_year_start_month: number | null }>();
  const fyStart = cfg?.fiscal_year_start_month ?? 4;

  const custom = sp.period === "custom" && isDay(sp.from) && isDay(sp.to) && sp.from <= sp.to;
  const period: Period = custom
    ? "custom"
    : sp.period === "month" || sp.period === "quarter" || sp.period === "year"
      ? sp.period
      : "tax_year";
  const at = isDay(sp.at) ? sp.at : today;
  const range = custom ? { from: sp.from!, to: sp.to! } : periodRange(period as Exclude<Period, "custom">, at, fyStart);

  const { data, error } = await supabase.rpc("report_tax", { p_from: range.from, p_to: range.to });
  const raw = (error ? null : data) as Raw | null;

  const report: TaxReportData | null = raw
    ? {
        output: (raw.output ?? []).map((o) => ({ ...o, rate: num(o.rate), base: num(o.base), amount: num(o.amount) })),
        outputTotal: num(raw.output_total),
        input: (raw.input ?? []).map((o) => ({ ...o, rate: num(o.rate), base: num(o.base), amount: num(o.amount) })),
        inputTotal: num(raw.input_total),
        salesNet: num(raw.sales_net),
        salesTotal: num(raw.sales_total),
        untaxed: num(raw.untaxed_total),
        unconverted: raw.unconverted ?? [],
        documents: (raw.documents ?? []).map((d) => ({ ...d, net: num(d.net), tax: num(d.tax), total: num(d.total) })),
      }
    : null;

  return (
    <TaxReport
      report={report}
      error={error ? error.message : null}
      period={period}
      at={at}
      from={range.from}
      to={range.to}
      label={periodLabel(period, range.from, range.to)}
      fyStart={fyStart}
    />
  );
}
