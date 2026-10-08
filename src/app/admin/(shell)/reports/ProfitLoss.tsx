"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ColumnChart from "@/components/admin/charts/ColumnChart";
import { CHART } from "@/components/admin/charts/palette";
import { Tabs } from "@/components/admin/Tabs";
import { Icon } from "@/components/admin/icons";
import { Button, EmptyState, Field, Input, Notice, Panel, Stat } from "@/components/admin/ui";
import { money, moneyShort } from "@/lib/admin/format";
import {
  PERIODS,
  monthShort,
  pctChange,
  periodLabel,
  shiftPeriod,
  type CsvCell,
  type MonthRow,
  type Period,
} from "@/lib/admin/reports";
import ReportActions, { PrintTitle } from "./ReportActions";

export type PnlTotals = { income: number; expense: number; net: number };
type Category = { kind: "income" | "expense"; category: string; amount: number };

export default function ProfitLoss({
  error,
  period,
  at,
  from,
  to,
  label,
  previousLabel,
  current,
  previous,
  categories,
  months,
  isCurrent,
  fyStart = 4,
}: {
  fyStart?: number;
  error: string | null;
  period: Period;
  at: string;
  from: string;
  to: string;
  label: string;
  previousLabel: string;
  current: PnlTotals;
  previous: PnlTotals | null;
  categories: Category[];
  months: MonthRow[];
  isCurrent: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Period>(period);
  const [range, setRange] = useState({ from, to });
  const [table, setTable] = useState(false);

  // Follow the URL when it moves (arrows, back button) — render-time sync.
  const shownKey = `${period}|${from}|${to}`;
  const [seen, setSeen] = useState(shownKey);
  if (seen !== shownKey) {
    setSeen(shownKey);
    setMode(period);
    setRange({ from, to });
  }

  const go = (params: Record<string, string>) => router.push(`/admin/reports?${new URLSearchParams(params)}`);
  const step = (n: number) => {
    if (period !== "custom") go({ period, at: shiftPeriod(period, at, n, fyStart) });
  };

  const margin = current.income > 0 ? (current.net / current.income) * 100 : null;
  const prevMargin = previous && previous.income > 0 ? (previous.net / previous.income) * 100 : null;

  const change = (cur: number, prev: number | undefined) => {
    if (prev === undefined) return "No earlier period to compare";
    const p = pctChange(cur, prev);
    if (p === null) return `Nothing in ${previousLabel}`;
    return `${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(0)}% vs ${previousLabel}`;
  };

  const income = categories.filter((c) => c.kind === "income").sort((a, b) => b.amount - a.amount);
  const expense = categories.filter((c) => c.kind === "expense").sort((a, b) => b.amount - a.amount);

  const rows: CsvCell[][] = [
    ["Section", "Item", "Income (LKR)", "Expenses (LKR)", "Net (LKR)"],
    ["Period", `${from} to ${to}`, current.income, current.expense, current.net],
    ...(previous ? [["Previous period", previousLabel, previous.income, previous.expense, previous.net] as CsvCell[]] : []),
    ...months.map((m) => ["Month", m.month.slice(0, 7), m.income, m.expense, m.net] as CsvCell[]),
    ...income.map((c) => ["Income by category", c.category, c.amount, null, null] as CsvCell[]),
    ...expense.map((c) => ["Expenses by category", c.category, null, c.amount, null] as CsvCell[]),
  ];

  return (
    <>
      <PrintTitle title="Profit & loss" sub={`${label} · compared with ${previousLabel} · approved entries, LKR`} />

      {/* Period controls */}
      <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Tabs
            value={mode}
            onChange={(p) => {
              setMode(p);
              if (p !== "custom") go({ period: p, at: period === "custom" ? from : at });
            }}
            options={PERIODS}
          />
          {mode === "custom" ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (range.from && range.to && range.from <= range.to) go({ period: "custom", from: range.from, to: range.to });
              }}
            >
              <Field label="From" className="w-[150px]">
                <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
              </Field>
              <Field label="To" className="w-[150px]">
                <Input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
              </Field>
              <Button type="submit" variant="primary" className="min-h-9">
                Apply
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous period"
                onClick={() => step(-1)}
                className="flex h-9 w-9 items-center justify-center border border-cream/12 text-sand transition-colors hover:border-cream/30 hover:text-cream sm:h-8 sm:w-8"
              >
                <Icon.chevronLeft size={14} />
              </button>
              <span className="min-w-[120px] px-2 text-center font-display text-[14px] text-cream">{label}</span>
              <button
                type="button"
                aria-label="Next period"
                onClick={() => step(1)}
                className="flex h-9 w-9 items-center justify-center border border-cream/12 text-sand transition-colors hover:border-cream/30 hover:text-cream sm:h-8 sm:w-8"
              >
                <Icon.chevronRight size={14} />
              </button>
              {!isCurrent && (
                <Button variant="quiet" className="min-h-9 sm:min-h-0" onClick={() => go({ period })}>
                  Back to now
                </Button>
              )}
            </div>
          )}
        </div>
        <ReportActions rows={rows} filename={`profit-and-loss-${from}-to-${to}.csv`} />
      </div>

      {error ? (
        <Notice tone="warn" title="This report couldn't load">
          It needs the reports migration (0022). The database said: {error}
        </Notice>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Income" value={moneyShort(current.income)} sub={change(current.income, previous?.income)} tone="success" icon={<Icon.up size={15} />} />
            <Stat label="Expenses" value={moneyShort(current.expense)} sub={change(current.expense, previous?.expense)} tone="terra" icon={<Icon.down size={15} />} />
            <Stat
              label={current.net < 0 ? "Net loss" : "Net profit"}
              value={money(current.net)}
              sub={change(current.net, previous?.net)}
              tone={current.net < 0 ? "danger" : "success"}
              icon={<Icon.ledger size={15} />}
            />
            <Stat
              label="Margin"
              value={margin === null ? "—" : `${margin.toFixed(1)}%`}
              sub={prevMargin === null ? "Net profit as a share of income" : `${prevMargin.toFixed(1)}% in ${previousLabel}`}
              tone={margin !== null && margin < 0 ? "danger" : "neutral"}
              icon={<Icon.chart size={15} />}
            />
          </div>

          <Panel
            title="Monthly trend"
            hint={`${periodLabel("month", months[0]?.month ?? from, months[0]?.month ?? from)} – ${periodLabel("month", to, to)} · approved entries`}
            right={
              <Button variant="quiet" className="no-print min-h-9 sm:min-h-0" onClick={() => setTable((t) => !t)}>
                {table ? "Hide table" : "Show table"}
              </Button>
            }
            className="mb-4 min-w-0"
          >
            {months.every((m) => m.income === 0 && m.expense === 0) ? (
              <EmptyState title="No entries in this stretch" hint="Approved income and expenses appear here month by month." />
            ) : (
              <ColumnChart
                label={`Monthly income, expenses and net, ${months.length} months`}
                labels={months.map((m, i) => monthShort(m.month, i === 0 || m.month.slice(5, 7) === "01"))}
                titles={months.map((m) => periodLabel("month", m.month, m.month))}
                series={[
                  { key: "income", label: "Income", color: CHART.income, type: "column", values: months.map((m) => m.income) },
                  { key: "expense", label: "Expenses", color: CHART.expense, type: "column", values: months.map((m) => m.expense) },
                  { key: "net", label: "Net", color: CHART.line, type: "line", values: months.map((m) => m.net) },
                ]}
                endLabel="net"
                format={(v) => money(v)}
              />
            )}

            <div className={`${table ? "" : "hidden"} mt-4 overflow-x-auto scroll-thin print:block`} data-lenis-prevent>
              <table className="w-full min-w-[420px] border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                    <th className="px-2 py-2 font-normal">Month</th>
                    <th className="px-2 py-2 text-right font-normal">Income</th>
                    <th className="px-2 py-2 text-right font-normal">Expenses</th>
                    <th className="px-2 py-2 text-right font-normal">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month} className="border-b border-cream/[0.05] last:border-0">
                      <td className="px-2 py-1.5 text-cream-2">{periodLabel("month", m.month, m.month)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-cream-2">{money(m.income)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-cream-2">{money(m.expense)}</td>
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${m.net < 0 ? "text-bad-300" : "text-cream"}`}>{money(m.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CategoryPanel title="Income by category" total={current.income} rows={income} color={CHART.income} />
            <CategoryPanel title="Expenses by category" total={current.expense} rows={expense} color={CHART.expense} />
          </div>
        </>
      )}
    </>
  );
}

function CategoryPanel({ title, total, rows, color }: { title: string; total: number; rows: Category[]; color: string }) {
  return (
    <Panel title={title} hint={`${money(total)} in the period`} bodyClass="p-0" className="min-w-0">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-sand">Nothing in this period.</p>
      ) : (
        <ul>
          {rows.map((c) => {
            const share = total > 0 ? (c.amount / total) * 100 : 0;
            return (
              <li key={c.category} className="border-b border-cream/[0.05] px-4 py-2.5 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[12.5px] text-cream">{c.category}</span>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-cream-2">
                    {money(c.amount)}
                    <span className="ml-2 inline-block w-9 text-right text-[10.5px] text-sand">{share.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-full bg-cream/[0.06] print:bg-neutral-200">
                  <div className="h-full" style={{ width: `${Math.min(share, 100)}%`, background: color }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
