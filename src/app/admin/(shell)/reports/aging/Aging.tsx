"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import StackBar from "@/components/admin/charts/StackBar";
import { AGING_RAMP } from "@/components/admin/charts/palette";
import { Icon } from "@/components/admin/icons";
import { Button, EmptyState, Notice, Panel, Stat } from "@/components/admin/ui";
import { CURRENCY_SYMBOL, formatDate, money } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import { AGING_BUCKETS, agingBucket, type AgingBucket, type CsvCell } from "@/lib/admin/reports";
import ReportActions, { PrintTitle } from "../ReportActions";

type Buckets = Record<AgingBucket, number> & { total: number };

export type AgingInvoice = { id: string; number: string | null; due_date: string | null; balance: number; days_overdue: number };
export type AgingClient = Buckets & { client_id: string | null; name: string; invoices: AgingInvoice[] };
export type AgingReport = { asOf: string; totals: Buckets; clients: AgingClient[] };

const keyOf = (c: AgingClient) => c.client_id ?? `name:${c.name}`;

function dueText(days: number) {
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${-days} day${days === -1 ? "" : "s"}`;
}

export default function Aging({
  report,
  error,
  currency,
  canInvoices,
  canClients,
}: {
  report: AgingReport | null;
  error: string | null;
  currency: string;
  canInvoices: boolean;
  canClients: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const fmt = (v: number) => money(v, { code: currency });

  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const clients = report?.clients ?? [];
  const totals = report?.totals;
  const overdue = totals ? totals.total - totals.current : 0;
  const allOpen = clients.length > 0 && clients.every((c) => open.has(keyOf(c)));

  const rows: CsvCell[][] = [
    ["Client", "Invoice", "Due date", "Days overdue", "Bucket", `Balance (${currency})`],
    ...clients.flatMap((c) =>
      c.invoices.map((i) => [
        c.name,
        i.number ?? "",
        i.due_date ?? "",
        i.days_overdue,
        AGING_BUCKETS.find((b) => b.key === agingBucket(i.days_overdue))?.label ?? "",
        i.balance,
      ]),
    ),
  ];

  return (
    <>
      <PrintTitle title="Receivables aging" sub={`As of ${report?.asOf ? formatDate(report.asOf) : "today"} · issued and part-paid invoices · ${currency}`} />

      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={currency}
            aria-label="Currency"
            onChange={(e) => router.push(`/admin/reports/aging${e.target.value === "LKR" ? "" : `?currency=${e.target.value}`}`)}
            className="min-h-9 border border-cream/12 bg-ink/60 px-2.5 py-1.5 text-[12px] text-cream-2 focus:border-terra/60 focus:outline-none sm:min-h-0"
          >
            {Object.keys(CURRENCY_SYMBOL).map((c) => (
              <option key={c} value={c} className="bg-ink text-cream">
                {c}
              </option>
            ))}
          </select>
          <span className="text-[11.5px] text-sand">
            As of {report?.asOf ? formatDate(report.asOf) : "today"} · balance left on issued and part-paid invoices
          </span>
        </div>
        <ReportActions rows={rows} filename={`receivables-aging-${currency.toLowerCase()}-${report?.asOf || "today"}.csv`} />
      </div>

      {error || !report || !totals ? (
        <Notice tone="warn" title="This report couldn't load">
          It needs the reports migration (0022).{error ? ` The database said: ${error}` : ""}
        </Notice>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Outstanding" value={fmt(totals.total)} sub={`${clients.length} client${clients.length === 1 ? "" : "s"} owe money`} icon={<Icon.receipt size={15} />} />
            <Stat label="Not yet due" value={fmt(totals.current)} sub="Inside its payment terms" icon={<Icon.clock size={15} />} />
            <Stat
              label="Overdue"
              value={fmt(overdue)}
              sub={totals.total > 0 ? `${((overdue / totals.total) * 100).toFixed(0)}% of what's owed` : "Nothing owed"}
              tone={overdue > 0 ? "terra" : "neutral"}
              icon={<Icon.flag size={15} />}
            />
            <Stat
              label="Over 90 days"
              value={fmt(totals.d90_plus)}
              sub="The hardest to collect"
              tone={totals.d90_plus > 0 ? "danger" : "neutral"}
              icon={<Icon.bolt size={15} />}
            />
          </div>

          <Panel title="By age" hint="How long the money has been owed" className="mb-4 min-w-0">
            <StackBar
              label={`Receivables by age, ${fmt(totals.total)} in total`}
              format={fmt}
              segments={AGING_BUCKETS.map((b, i) => ({ key: b.key, label: b.label, value: totals[b.key], color: AGING_RAMP[i] }))}
            />
          </Panel>

          <Panel
            title="By client"
            hint="Open a client to see the invoices behind the numbers"
            bodyClass="p-0"
            className="min-w-0"
            right={
              clients.length > 0 ? (
                <Button
                  variant="quiet"
                  className="no-print min-h-9 sm:min-h-0"
                  onClick={() => setOpen(allOpen ? new Set() : new Set(clients.map(keyOf)))}
                >
                  {allOpen ? "Collapse all" : "Expand all"}
                </Button>
              ) : undefined
            }
          >
            {clients.length === 0 ? (
              <div className="p-4">
                <EmptyState title="Nobody owes you anything" hint="Issued invoices with a balance left show up here, grouped by client." />
              </div>
            ) : (
              <>
                {/* md+ : table */}
                <div className="hidden overflow-x-auto scroll-thin md:block print:block" data-lenis-prevent>
                  <table className="w-full min-w-[820px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                        <th className="px-3 py-2.5 font-normal">Client</th>
                        {AGING_BUCKETS.map((b) => (
                          <th key={b.key} className="px-3 py-2.5 text-right font-normal">
                            {b.label}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-right font-normal">Total</th>
                        <th className="no-print w-10 px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((c) => {
                        const k = keyOf(c);
                        const expanded = open.has(k);
                        return (
                          <Fragment key={k}>
                            <tr className="border-b border-cream/[0.05] transition-colors hover:bg-cream/[0.03]">
                              <td className="max-w-[240px] px-3 py-3">
                                <ClientName client={c} canClients={canClients} />
                                <span className="block text-[10.5px] text-sand">
                                  {c.invoices.length} invoice{c.invoices.length === 1 ? "" : "s"}
                                </span>
                              </td>
                              {AGING_BUCKETS.map((b) => (
                                <td
                                  key={b.key}
                                  className={`whitespace-nowrap px-3 py-3 text-right font-mono text-[12px] tabular-nums ${c[b.key] > 0 ? "text-cream-2" : "text-sand/50"}`}
                                >
                                  {c[b.key] > 0 ? fmt(c[b.key]) : "—"}
                                </td>
                              ))}
                              <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-[12.5px] font-medium tabular-nums text-cream">{fmt(c.total)}</td>
                              <td className="no-print px-3 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => toggle(k)}
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? "Hide" : "Show"} ${c.name}'s invoices`}
                                  className="flex h-7 w-7 items-center justify-center text-sand transition-colors hover:text-cream pointer-coarse:h-9 pointer-coarse:w-9"
                                >
                                  <Icon.chevron size={14} className={`transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
                                </button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="border-b border-cream/[0.05] bg-ink/40">
                                <td colSpan={AGING_BUCKETS.length + 3} className="px-3 py-2">
                                  <InvoiceList invoices={c.invoices} fmt={fmt} canInvoices={canInvoices} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-cream/[0.10] bg-cream/[0.02]">
                        <td className="px-3 py-3 text-[11px] uppercase tracking-[0.16em] text-sand">Total</td>
                        {AGING_BUCKETS.map((b) => (
                          <td key={b.key} className="whitespace-nowrap px-3 py-3 text-right font-mono text-[12px] tabular-nums text-cream-2">
                            {fmt(totals[b.key])}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-[13px] font-medium tabular-nums text-cream">{fmt(totals.total)}</td>
                        <td className="no-print" />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* below md : cards */}
                <ul className="md:hidden print:hidden">
                  {clients.map((c) => {
                    const k = keyOf(c);
                    const expanded = open.has(k);
                    const late = c.total - c.current;
                    return (
                      <li key={k} className="border-b border-cream/[0.05] px-4 py-3 last:border-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <ClientName client={c} canClients={canClients} />
                            <p className="mt-0.5 truncate text-[11px] text-sand">
                              {late > 0 ? `${fmt(late)} overdue` : "Nothing overdue"} · {c.invoices.length} invoice{c.invoices.length === 1 ? "" : "s"}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-[13px] tabular-nums text-cream">{fmt(c.total)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggle(k)}
                          aria-expanded={expanded}
                          className="mt-1 inline-flex min-h-9 items-center gap-1 text-[11.5px] text-sand transition-colors hover:text-cream"
                        >
                          {expanded ? "Hide invoices" : "Show invoices"}
                          <Icon.chevron size={13} className={`transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
                        </button>
                        {expanded && <InvoiceList invoices={c.invoices} fmt={fmt} canInvoices={canInvoices} />}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function ClientName({ client: c, canClients }: { client: AgingClient; canClients: boolean }) {
  const href = canClients ? hrefFor("client", c.client_id) : null;
  return href ? (
    <Link href={href} className="block truncate text-[13px] text-cream hover:text-terra-bright">
      {c.name}
    </Link>
  ) : (
    <span className="block truncate text-[13px] text-cream">{c.name}</span>
  );
}

function InvoiceList({ invoices, fmt, canInvoices }: { invoices: AgingInvoice[]; fmt: (v: number) => string; canInvoices: boolean }) {
  if (invoices.length === 0) return <p className="py-2 text-[11.5px] text-sand">No invoice detail.</p>;
  return (
    <ul className="mt-1 divide-y divide-cream/[0.05]">
      {[...invoices]
        .sort((a, b) => b.days_overdue - a.days_overdue)
        .map((i) => {
          const href = canInvoices ? hrefFor("invoice", i.id) : null;
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-[12px]">
              {href ? (
                <Link href={href} className="inline-flex min-h-8 items-center font-mono text-[11.5px] text-terra-bright hover:underline md:min-h-0">
                  {i.number ?? "Draft"}
                </Link>
              ) : (
                <span className="font-mono text-[11.5px] text-cream-2">{i.number ?? "Draft"}</span>
              )}
              <span className="text-sand">{i.due_date ? `due ${formatDate(i.due_date)}` : "no due date"}</span>
              <span className={i.days_overdue > 0 ? "text-rose-200" : "text-sand"}>{dueText(i.days_overdue)}</span>
              <span className="ml-auto font-mono tabular-nums text-cream">{fmt(i.balance)}</span>
            </li>
          );
        })}
    </ul>
  );
}
