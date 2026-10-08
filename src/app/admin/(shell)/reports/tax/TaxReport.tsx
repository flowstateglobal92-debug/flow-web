"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { Button, EmptyState, Input, Notice, Panel, Stat } from "@/components/admin/ui";
import { formatDate, money } from "@/lib/admin/format";
import { shiftPeriod, type Period } from "@/lib/admin/reports";
import ReportActions, { PrintTitle } from "../ReportActions";

export type TaxLineRow = { name: string; rate: number; compound?: boolean; base: number; amount: number; documents: number };

export type TaxReportData = {
  output: TaxLineRow[];
  outputTotal: number;
  input: TaxLineRow[];
  inputTotal: number;
  salesNet: number;
  salesTotal: number;
  untaxed: number;
  unconverted: { id: string; number: string | null; currency: string }[];
  documents: {
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
};

const PERIOD_TABS: { value: Period; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "tax_year", label: "Tax year" },
  { value: "custom", label: "Custom" },
];

const lkr = (v: number) => money(v, { decimals: true, code: "LKR" });

export default function TaxReport({
  report,
  error,
  period,
  at,
  from,
  to,
  label,
  fyStart,
}: {
  report: TaxReportData | null;
  error: string | null;
  period: Period;
  at: string;
  from: string;
  to: string;
  label: string;
  fyStart: number;
}) {
  const router = useRouter();
  const [range, setRange] = useState({ from, to });
  const go = (params: Record<string, string>) => router.push(`/admin/reports/tax?${new URLSearchParams(params)}`);
  const step = (n: number) => period !== "custom" && go({ period, at: shiftPeriod(period, at, n, fyStart) });

  const rows = [
    ["Tax report", label],
    [],
    ["Tax", "Rate %", "Taxable value (LKR)", "Tax (LKR)", "Documents"],
    ...(report?.output ?? []).map((o) => [o.name, o.rate, o.base, o.amount, o.documents]),
    ["Output tax", "", "", report?.outputTotal ?? 0, ""],
    ...(report && report.input.length
      ? [[], ["Input tax (bills)"], ...report.input.map((o) => [o.name, o.rate, o.base, o.amount, o.documents]), ["Input tax", "", "", report.inputTotal, ""]]
      : []),
    [],
    ["Document", "Date", "Client", "TIN", "Value excl. tax (LKR)", "Tax (LKR)", "Total (LKR)"],
    ...(report?.documents ?? []).map((d) => [d.number ?? "", d.issue_date, d.client ?? "", d.tax_id ?? "", d.net, d.tax, d.total]),
  ];

  return (
    <>
      <PrintTitle title="Tax report" sub={`${label} · output tax on issued documents, in LKR`} />
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={period}
            size="xs"
            onChange={(p) => (p === "custom" ? go({ period: "custom", from: range.from, to: range.to }) : go({ period: p, at }))}
            options={PERIOD_TABS}
          />
          {period === "custom" ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
              <Input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
              <Button onClick={() => go({ period: "custom", ...range })} className="min-h-9">
                Show
              </Button>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Button variant="quiet" onClick={() => step(-1)} aria-label="Previous period" className="min-h-9">
                <Icon.chevronLeft size={14} />
              </Button>
              <span className="min-w-[110px] text-center font-display text-[14px] text-cream">{label}</span>
              <Button variant="quiet" onClick={() => step(1)} aria-label="Next period" className="min-h-9">
                <Icon.chevronRight size={14} />
              </Button>
            </span>
          )}
        </div>
        <ReportActions rows={rows} filename={`tax-report-${from}-to-${to}.csv`} />
      </div>

      {error ? (
        <Notice tone="warn" title="The tax report isn't available yet">
          It needs the taxes migration (0032). {error}
        </Notice>
      ) : !report ? null : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Output tax" value={lkr(report.outputTotal)} sub={`${label} · on issued documents`} tone="terra" />
            {report.input.length > 0 ? (
              <Stat
                label={report.outputTotal - report.inputTotal < 0 ? "Net to reclaim" : "Net payable"}
                value={lkr(Math.abs(report.outputTotal - report.inputTotal))}
                sub={`Input tax on bills ${lkr(report.inputTotal)}`}
                tone={report.outputTotal - report.inputTotal > 0 ? "danger" : "success"}
              />
            ) : (
              <Stat label="Sales before tax" value={lkr(report.salesNet)} sub="Issued, less credit notes" />
            )}
            <Stat label="Sales with tax" value={lkr(report.salesTotal)} sub="What the documents add up to" />
            <Stat label="Untaxed sales" value={lkr(report.untaxed)} sub="Documents with no tax on them" />
          </div>

          {report.unconverted.length > 0 && (
            <Notice tone="warn" title={`${report.unconverted.length} foreign-currency document${report.unconverted.length === 1 ? " has" : "s have"} no exchange rate`}>
              They&apos;re left out of these figures: {report.unconverted.map((u) => `${u.number ?? "draft"} (${u.currency})`).join(", ")}. Add the rate on
              each to count it in rupees.
            </Notice>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <TaxTable title="Output tax" hint="Charged on invoices, less tax credit notes." rows={report.output} total={report.outputTotal} />
            {report.input.length > 0 && (
              <TaxTable title="Input tax" hint="Charged to you on bills." rows={report.input} total={report.inputTotal} />
            )}
          </div>

          <Panel title="Documents" hint={`${report.documents.length} in ${label}`} bodyClass="p-0">
            {report.documents.length === 0 ? (
              <div className="p-4">
                <EmptyState title="Nothing issued in this period" hint="Pick another period, or issue invoices with tax on them." />
              </div>
            ) : (
              <div className="overflow-x-auto scroll-thin" data-lenis-prevent>
                <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                      <th className="px-3 py-2.5 font-normal">Document</th>
                      <th className="px-3 py-2.5 font-normal">Date</th>
                      <th className="px-3 py-2.5 font-normal">Client</th>
                      <th className="px-3 py-2.5 font-normal">TIN</th>
                      <th className="px-3 py-2.5 text-right font-normal">Before tax</th>
                      <th className="px-3 py-2.5 text-right font-normal">Tax</th>
                      <th className="px-3 py-2.5 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.documents.map((d) => (
                      <tr key={d.id} className="border-b border-cream/[0.05] last:border-0">
                        <td className="px-3 py-2">
                          <Link href={`/admin/invoices/${d.id}`} className="font-mono text-cream-2 hover:text-terra-bright">
                            {d.number ?? "—"}
                          </Link>
                          {d.kind === "credit_note" && <span className="ml-1.5 text-[10.5px] text-sand">credit note</span>}
                          {d.currency !== "LKR" && <span className="ml-1.5 text-[10.5px] text-sand">{d.currency}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-sand">{formatDate(d.issue_date)}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-cream-2">{d.client ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-sand">{d.tax_id ?? ""}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-cream-2">{lkr(d.net)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-cream">{lkr(d.tax)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-cream-2">{lkr(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

function TaxTable({ title, hint, rows, total }: { title: string; hint: string; rows: TaxLineRow[]; total: number }) {
  return (
    <Panel title={title} hint={hint} bodyClass="p-0">
      {rows.length === 0 ? (
        <p className="p-4 text-[12px] text-sand">None in this period.</p>
      ) : (
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
              <th className="px-4 py-2.5 font-normal">Tax</th>
              <th className="px-4 py-2.5 text-right font-normal">Taxable value</th>
              <th className="px-4 py-2.5 text-right font-normal">Tax</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.name}${r.rate}${r.compound}`} className="border-b border-cream/[0.05]">
                <td className="px-4 py-2 text-cream-2">
                  {r.name} {r.rate}%{r.compound ? " on tax" : ""}
                  <span className="ml-1.5 text-[10.5px] text-sand">{r.documents} doc{r.documents === 1 ? "" : "s"}</span>
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-cream-2">{lkr(r.base)}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-cream">{lkr(r.amount)}</td>
              </tr>
            ))}
            <tr>
              <td className="px-4 py-2.5 font-display text-[13px] text-cream">Total</td>
              <td />
              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-terra-bright">{lkr(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </Panel>
  );
}
