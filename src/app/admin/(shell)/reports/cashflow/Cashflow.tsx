"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import ColumnChart from "@/components/admin/charts/ColumnChart";
import { CHART } from "@/components/admin/charts/palette";
import Modal from "@/components/admin/Modal";
import { Tabs } from "@/components/admin/Tabs";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Button, Checkbox, Field, Input, Notice, Panel, Stat } from "@/components/admin/ui";
import { formatDate, money, moneyShort, todayISO } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import { dayShort, forecastCashflow, plusDays, type CashflowInputs, type CsvCell, type ForecastBasis } from "@/lib/admin/reports";
import { saveOpeningBalance } from "@/app/admin/actions/reports";
import ReportActions, { PrintTitle } from "../ReportActions";

const BASIS: { value: ForecastBasis; label: string }[] = [
  { value: "average", label: "Average spend" },
  { value: "budgets", label: "Budgets" },
];

export default function Cashflow({
  inputs,
  error,
  weeks,
  lagDays,
  canEditOpening,
  canInvoices,
}: {
  inputs: CashflowInputs | null;
  error: string | null;
  weeks: number;
  lagDays: number;
  canEditOpening: boolean;
  canInvoices: boolean;
}) {
  const { run, pending, toast } = useAction();
  const [basis, setBasis] = useState<ForecastBasis>("average");
  const [includeOverdue, setIncludeOverdue] = useState(false);
  const [editing, setEditing] = useState(false);

  // The maths is the pure, fixture-tested function — flipping a toggle just reruns it here.
  const forecast = useMemo(
    () => (inputs ? forecastCashflow(inputs, { basis, weeks, includeOverdue, recurringLagDays: lagDays }) : null),
    [inputs, basis, weeks, includeOverdue, lagDays],
  );

  if (!inputs || !forecast) {
    return (
      <Notice tone="warn" title="This forecast couldn't load">
        It needs the reports migration (0022).{error ? ` The database said: ${error}` : ""}
      </Notice>
    );
  }

  const overdue = inputs.receivables.filter((r) => r.due_date && r.due_date < inputs.as_of).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  // Only what lands inside the window counts towards "expected in".
  const lastDay = forecast.weeks[forecast.weeks.length - 1]?.end ?? inputs.as_of;
  const dueSoon = inputs.receivables.filter((r) => !r.due_date || (r.due_date >= inputs.as_of && r.due_date <= lastDay));
  const recurringInRange = inputs.recurring.filter((r) => plusDays(r.run_on, lagDays) <= lastDay).length;
  const billsTotal = forecast.weeks.reduce((a, w) => a + w.bills, 0);
  const monthly = basis === "budgets" ? inputs.budgets_monthly_total : inputs.expense_monthly_avg;
  const titles = forecast.weeks.map((w) => `Week ${w.week} · ${dayShort(w.start)} – ${dayShort(w.end)}`);

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveOpeningBalance(fd), { onDone: (r) => r.ok && setEditing(false) });
  };

  const rows: CsvCell[][] = [
    ["Week", "Starts", "Ends", "Invoices due (LKR)", "Recurring (LKR)", "Cash in (LKR)", "Cash out (LKR)", "Net (LKR)", "Balance (LKR)"],
    ["Opening", inputs.opening_balance_on ?? "", "", null, null, null, null, null, forecast.opening],
    ...forecast.weeks.map((w) => [w.week, w.start, w.end, w.receivables, w.recurring, w.inflow, w.outflow, w.net, w.balance] as CsvCell[]),
  ];

  return (
    <>
      <PrintTitle
        title="Cash-flow forecast"
        sub={`${weeks} weeks from ${formatDate(inputs.as_of)} · spending basis: ${basis === "budgets" ? "budgets" : "3-month average"} · overdue ${includeOverdue ? "counted" : "left out"} · LKR`}
      />

      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Tabs value={basis} onChange={setBasis} options={BASIS} />
          <Checkbox
            label="Count overdue invoices in week 1"
            checked={includeOverdue}
            onChange={(e) => setIncludeOverdue(e.target.checked)}
          />
        </div>
        <ReportActions rows={rows} filename={`cash-flow-forecast-${inputs.as_of}.csv`} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative min-w-0">
          <Stat
            label="Opening balance"
            value={moneyShort(forecast.opening)}
            sub={inputs.opening_balance_on ? `Cash on ${formatDate(inputs.opening_balance_on)}` : "Not set yet — starts at zero"}
            icon={<Icon.ledger size={15} />}
          />
          {canEditOpening && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="no-print absolute bottom-2.5 right-3 inline-flex min-h-9 items-center gap-1 text-[11px] text-terra-bright hover:underline sm:min-h-0"
            >
              <Icon.edit size={12} /> Update
            </button>
          )}
        </div>
        <Stat label={`Expected in · ${weeks} wks`} value={moneyShort(forecast.totals.inflow)} sub={`${dueSoon.length} invoices · ${recurringInRange} recurring runs`} tone="success" icon={<Icon.up size={15} />} />
        <Stat label={`Expected out · ${weeks} wks`} value={moneyShort(forecast.totals.outflow)} sub={`${money(forecast.weeklyOutflow)} a week${billsTotal > 0 ? ` + ${moneyShort(billsTotal)} in supplier bills` : ""}`} tone="terra" icon={<Icon.down size={15} />} />
        <Stat
          label={`Balance in ${weeks} weeks`}
          value={money(forecast.closing)}
          sub={forecast.lowest.week ? `Lowest ${money(forecast.lowest.balance)} in week ${forecast.lowest.week}` : "Never dips below today"}
          tone={forecast.closing < 0 ? "danger" : "neutral"}
          icon={<Icon.chart size={15} />}
        />
      </div>

      {overdue.length > 0 && (
        <div className="mb-4">
          <Notice tone={includeOverdue ? "info" : "warn"} title={`${money(forecast.atRisk.total)} at risk — ${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}`}>
            {includeOverdue
              ? "Counted as collected in week 1. Untick the box above to see the forecast without them."
              : "Left out of the forecast until they're paid. Tick the box above to assume they're collected this week."}
          </Notice>
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Cash in and out, by week" hint="Invoices due and recurring runs in · steady spending out" className="min-w-0">
          <ColumnChart
            label={`Weekly cash in and out over ${weeks} weeks`}
            labels={forecast.weeks.map((w) => `W${w.week}`)}
            titles={titles}
            overlap
            series={[
              { key: "in", label: "Cash in", color: CHART.income, type: "column", values: forecast.weeks.map((w) => w.inflow) },
              { key: "out", label: "Cash out", color: CHART.expense, type: "column", values: forecast.weeks.map((w) => -w.outflow) },
            ]}
            format={(v) => money(Math.abs(v))}
          />
        </Panel>
        <Panel title="Running balance" hint={`From ${money(forecast.opening)} — where the cash lands each week`} className="min-w-0">
          <ColumnChart
            label={`Forecast balance over ${weeks} weeks, ending at ${money(forecast.closing)}`}
            labels={forecast.weeks.map((w) => `W${w.week}`)}
            titles={titles}
            series={[{ key: "balance", label: "Balance", color: CHART.line, type: "line", area: true, values: forecast.weeks.map((w) => w.balance) }]}
            endLabel="balance"
            format={(v) => money(v)}
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Week by week" bodyClass="p-0" className="min-w-0">
          <div className="overflow-x-auto scroll-thin" data-lenis-prevent>
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                  <th className="px-3 py-2.5 font-normal">Week</th>
                  <th className="px-3 py-2.5 text-right font-normal">Invoices due</th>
                  <th className="px-3 py-2.5 text-right font-normal">Recurring</th>
                  <th className="px-3 py-2.5 text-right font-normal">Out</th>
                  <th className="px-3 py-2.5 text-right font-normal">Net</th>
                  <th className="px-3 py-2.5 text-right font-normal">Balance</th>
                </tr>
              </thead>
              <tbody>
                {forecast.weeks.map((w) => (
                  <tr key={w.week} className="border-b border-cream/[0.05] last:border-0">
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="block text-[12.5px] text-cream">Week {w.week}</span>
                      <span className="block text-[10.5px] text-sand">
                        {dayShort(w.start)} – {dayShort(w.end)}
                      </span>
                    </td>
                    <Num value={w.receivables} />
                    <Num value={w.recurring} />
                    <Num value={-w.outflow} />
                    <Num value={w.net} strong />
                    <Num value={w.balance} strong />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Assumptions" hint="What this forecast takes for granted">
            <ul className="space-y-2.5 text-[12px] leading-relaxed text-cream-2">
              <Assumption>
                {inputs.opening_balance_on
                  ? `Starts from the ${money(inputs.opening_balance)} in the bank on ${formatDate(inputs.opening_balance_on)}. Update it when your balance moves${canEditOpening ? "" : " (an admin sets it)"}.`
                  : `No opening balance has been entered, so the line starts at Rs 0${canEditOpening ? " — set it with Update above" : ""}.`}
              </Assumption>
              <Assumption>
                Open invoices are paid in full on their due date — {dueSoon.length} invoice{dueSoon.length === 1 ? "" : "s"}. Ones without a due date count as due this week.
              </Assumption>
              <Assumption>
                {overdue.length
                  ? `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"} (${money(forecast.atRisk.total)}) ${includeOverdue ? "are assumed collected in week 1" : "are treated as at risk and left out"}.`
                  : "Nothing is overdue right now."}
              </Assumption>
              <Assumption>
                Recurring invoices are paid {lagDays} day{lagDays === 1 ? "" : "s"} after they&apos;re generated (your default payment terms) — {recurringInRange}{" "}
                {recurringInRange === 1 ? "run falls" : "runs fall"} in this window.
              </Assumption>
              <Assumption>
                {basis === "budgets"
                  ? `Spending follows your active budgets: ${money(monthly)} a month (quarterly and yearly ones spread per month), paid evenly at ${money(forecast.weeklyOutflow)} a week.`
                  : `Spending matches the last 3 full months of approved expenses: ${money(monthly)} a month on average, paid evenly at ${money(forecast.weeklyOutflow)} a week.`}
              </Assumption>
              {forecast.beyond.count > 0 && (
                <Assumption>
                  {money(forecast.beyond.total)} due after week {weeks} ({forecast.beyond.count} item{forecast.beyond.count === 1 ? "" : "s"}) isn&apos;t shown.
                </Assumption>
              )}
              <Assumption>Rupee amounts only; new invoices, one-off costs and taxes aren&apos;t predicted.</Assumption>
            </ul>
          </Panel>

          {overdue.length > 0 && (
            <Panel title="At risk" hint="Overdue — chase these first" bodyClass="p-0">
              <ul>
                {overdue.slice(0, 12).map((r) => {
                  const href = canInvoices ? hrefFor("invoice", r.id) : null;
                  return (
                    <li key={r.id} className="flex items-center gap-3 border-b border-cream/[0.05] px-4 py-2.5 last:border-0">
                      <div className="min-w-0 flex-1">
                        {href ? (
                          <Link href={href} className="block truncate font-mono text-[11.5px] text-terra-bright hover:underline">
                            {r.number ?? "Invoice"}
                          </Link>
                        ) : (
                          <span className="block truncate font-mono text-[11.5px] text-cream-2">{r.number ?? "Invoice"}</span>
                        )}
                        <span className="block truncate text-[11px] text-sand">
                          {r.client ?? "No client"} · due {r.due_date ? formatDate(r.due_date) : "—"}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-[12px] tabular-nums text-cream">{money(r.balance)}</span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Opening balance" hint="Cash in the bank on a given day — the forecast starts here.">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Balance (Rs)">
              <Input name="opening_balance" type="number" step="0.01" inputMode="decimal" required defaultValue={inputs.opening_balance || ""} />
            </Field>
            <Field label="As of">
              <Input name="opening_balance_on" type="date" required defaultValue={todayISO()} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-cream/[0.08] pt-3">
            <Button type="button" className="min-h-9 sm:min-h-0" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="min-h-9 sm:min-h-0" disabled={pending}>
              {pending ? "Saving…" : "Save balance"}
            </Button>
          </div>
        </form>
      </Modal>

      {toast}
    </>
  );
}

function Num({ value, strong = false }: { value: number; strong?: boolean }) {
  const tone = value < 0 ? "text-bad-300" : strong ? "text-cream" : value === 0 ? "text-sand/50" : "text-cream-2";
  return (
    <td className={`whitespace-nowrap px-3 py-2.5 text-right font-mono text-[12px] tabular-nums ${tone} ${strong ? "font-medium" : ""}`}>
      {value === 0 && !strong ? "—" : money(value)}
    </td>
  );
}

function Assumption({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon.check size={13} className="mt-1 shrink-0 text-sand" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}
