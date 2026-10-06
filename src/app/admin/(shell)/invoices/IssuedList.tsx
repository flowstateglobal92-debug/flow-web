"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { useAction } from "@/components/admin/useAction";
import { Avatar, Button, EmptyState, Panel, Stat, fieldClass } from "@/components/admin/ui";
import { PaymentSwitch, usePaymentFlow } from "@/components/admin/invoice/Payments";
import { StatusBadge, linkButton } from "@/components/admin/invoice/parts";
import { formatDate, formatDateShort, money, moneyShort, num } from "@/lib/admin/format";
import { NEW } from "@/lib/admin/links";
import {
  billedTo,
  displayStatus,
  docMoney,
  hasPaymentSwitch,
  paymentState,
  type InvoiceKpis,
  type InvoiceWithPayments,
} from "@/lib/admin/invoice-types";
import { issueDocument } from "@/app/admin/actions/invoices";

export type IssuedFilter = "all" | "unpaid" | "part" | "paid" | "overdue" | "pending" | "void" | "draft";
export type Period = "month" | "year" | "all";

const FILTER_TABS: { value: IssuedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unpaid", label: "Unpaid" },
  { value: "part", label: "Part paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "pending", label: "Awaiting approval" },
  { value: "void", label: "Void" },
  { value: "draft", label: "Drafts" },
];

const PERIOD_LABEL: Record<Period, string> = { month: "This month", year: "This year", all: "All time" };

/** One muted line per card: what's owed and when, or why nothing is. */
function cardLine(inv: InvoiceWithPayments, left: number) {
  const total = docMoney(num(inv.total), inv.currency);
  if (inv.status === "paid") return `Paid · ${total}`;
  if (inv.status === "void") return `Void · ${total}`;
  if (inv.status === "draft") return `Not issued · ${total}`;
  if (inv.status === "pending_approval") return `Waiting for sign-off · ${total}`;
  const due = inv.due_date ? `Due ${formatDateShort(inv.due_date)}` : "Due on receipt";
  return `${due} · ${docMoney(left, inv.currency)} left`;
}

export default function IssuedList({
  invoices,
  kpis,
  people,
  status,
  period,
  mine,
  query,
  today,
}: {
  invoices: InvoiceWithPayments[];
  kpis: InvoiceKpis | null;
  people: Record<string, string>;
  status: IssuedFilter;
  period: Period;
  mine: boolean;
  query: string;
  today: string;
}) {
  const router = useRouter();
  const { run, pending, toast } = useAction();
  const flow = usePaymentFlow({ run, pending, today });
  const [search, setSearch] = useState(query);

  const goTo = (next: { status?: IssuedFilter; period?: Period; mine?: boolean; q?: string }) => {
    const params = new URLSearchParams();
    const s = next.status ?? status;
    const p = next.period ?? period;
    const m = next.mine ?? mine;
    const q = next.q ?? search;
    if (s !== "all") params.set("status", s);
    if (p !== "month") params.set("period", p);
    if (m) params.set("mine", "1");
    if (q.trim()) params.set("q", q.trim());
    router.push(`/admin/invoices${params.size ? `?${params}` : ""}`);
  };

  // Issued, outstanding and overdue are in the default invoice currency;
  // Received is always rupees — it's what reached Income (payments' amount_base).
  const code = kpis?.currency ?? "LKR";
  const short = (v: number) => (code === "LKR" ? moneyShort(v) : money(v, { code }));
  const k = (key: keyof InvoiceKpis) => num(kpis?.[key]);

  /** The control in a row: Issue for drafts, the switch for issued ones, nothing otherwise. */
  const control = (inv: InvoiceWithPayments, full = false) => {
    if (inv.status === "draft") {
      return (
        <Button variant="primary" disabled={pending} onClick={() => run(() => issueDocument(inv.id))} className={`min-h-9 ${full ? "w-full" : ""}`}>
          <Icon.send size={13} /> Issue
        </Button>
      );
    }
    if (!hasPaymentSwitch(inv)) return null;
    return (
      <PaymentSwitch
        state={paymentState(inv)}
        disabled={pending}
        onPick={(next) => flow.pick(inv, inv.invoice_payments ?? [], next)}
        full={full}
      />
    );
  };

  return (
    <>
      {/* Position */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow eyebrow--muted text-[9.5px]">Position</p>
        <label className="flex items-center gap-2 text-[11.5px] text-sand">
          <span className="hidden sm:inline">Issued &amp; received</span>
          <select
            value={period}
            onChange={(e) => goTo({ period: e.target.value as Period })}
            className="min-h-9 border border-cream/12 bg-ink/60 px-2.5 py-1.5 text-[12px] text-cream-2 focus:border-terra/60 focus:outline-none"
          >
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
              <option key={p} value={p} className="bg-ink text-cream">
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Issued"
          value={kpis ? short(k("issued_total")) : "—"}
          sub={kpis ? `${k("issued_count")} invoice${k("issued_count") === 1 ? "" : "s"} · ${PERIOD_LABEL[period].toLowerCase()}` : "Totals appear once invoicing is set up"}
          icon={<Icon.receipt size={15} />}
        />
        <Stat
          label="Received"
          value={kpis ? moneyShort(k("received_total")) : "—"}
          sub={code === "LKR" ? "Payments posted to Income" : "Payments posted to Income, in LKR"}
          tone="success"
          icon={<Icon.down size={15} />}
        />
        <Stat
          label="Outstanding"
          value={kpis ? short(k("outstanding_total")) : "—"}
          sub={`${k("outstanding_count")} unpaid or part paid · now`}
          tone="terra"
          icon={<Icon.clock size={15} />}
        />
        <Stat
          label="Overdue"
          value={kpis ? short(k("overdue_total")) : "—"}
          sub={k("overdue_count") ? `${k("overdue_count")} past their due date` : "Nothing past due"}
          tone={k("overdue_total") > 0 ? "danger" : "neutral"}
          icon={<Icon.flag size={15} />}
        />
      </div>
      {!!kpis?.other_currencies?.length && (
        <p className="mb-2 text-[11.5px] text-sand">
          {kpis.other_currencies.join(", ")} invoices aren&apos;t in these totals — they stay in their own currency.
        </p>
      )}

      {/* Toolbar */}
      <div className="mb-4 mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="scroll-x -mx-1 min-w-0 max-w-full overflow-x-auto px-1 pb-1">
          <Tabs className="w-max" value={status} onChange={(v) => goTo({ status: v })} options={FILTER_TABS} />
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button
            type="button"
            aria-pressed={mine}
            onClick={() => goTo({ mine: !mine })}
            className={`inline-flex min-h-9 items-center gap-1.5 border px-3 text-[12px] font-medium transition-colors duration-300 ${mine ? "border-terra/50 bg-terra/15 text-terra-bright" : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"}`}
          >
            <Icon.user size={13} /> Mine
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              goTo({ q: search });
            }}
            className="relative min-w-0 flex-1 sm:w-56 sm:flex-none"
          >
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sand">
              <Icon.search size={14} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Number, client, subject…"
              aria-label="Search invoices"
              className={`${fieldClass} pl-9`}
            />
          </form>
        </div>
      </div>

      <Panel bodyClass="p-0">
        {invoices.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={status === "all" && !query && !mine ? "No invoices issued yet" : "Nothing matches"}
              hint={
                status === "all" && !query && !mine
                  ? "Create one, issue it, and it lands here with its balance and payments."
                  : "Try another filter, or clear the search."
              }
              action={
                <Link href={NEW.invoice()} className={`${linkButton.primary} min-h-9`}>
                  <Icon.plus size={13} /> New invoice
                </Link>
              }
            />
          </div>
        ) : (
          <>
            {/* md+: table */}
            <div className="hidden overflow-x-auto scroll-thin md:block" data-lenis-prevent>
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                    <th className="px-3 py-2.5 font-normal">Invoice</th>
                    <th className="px-3 py-2.5 font-normal">Issued</th>
                    <th className="px-3 py-2.5 font-normal">Due</th>
                    <th className="px-3 py-2.5 text-right font-normal">Total</th>
                    <th className="px-3 py-2.5 text-right font-normal">Paid</th>
                    <th className="px-3 py-2.5 text-right font-normal">Left to pay</th>
                    <th className="px-3 py-2.5 font-normal">Status</th>
                    <th className="px-3 py-2.5 font-normal">
                      <span className="sr-only">Owner</span>
                    </th>
                    <th className="px-3 py-2.5 font-normal">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const overdue = displayStatus(inv, today) === "overdue";
                    const left = Math.max(0, num(inv.total) - num(inv.amount_paid));
                    const owner = inv.owner_id ? people[inv.owner_id] : null;
                    return (
                      <tr key={inv.id} className="border-b border-cream/[0.05] align-middle transition-colors last:border-0 hover:bg-cream/[0.03]">
                        <td className="max-w-[260px] px-3 py-3">
                          <Link href={`/admin/invoices/${inv.id}`} className="group block min-w-0">
                            <span className="block font-mono text-[11px] tracking-[0.06em] text-sand group-hover:text-terra-bright">
                              {inv.number ?? "Draft"}
                            </span>
                            <span className="block truncate text-[13px] text-cream group-hover:text-terra-bright">{billedTo(inv)}</span>
                            {inv.subject && <span className="block truncate text-[11px] text-sand">{inv.subject}</span>}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[11.5px] text-sand">{formatDate(inv.issue_date)}</td>
                        <td className={`whitespace-nowrap px-3 py-3 text-[11.5px] ${overdue ? "text-rose-300" : "text-sand"}`}>
                          {inv.due_date ? formatDate(inv.due_date) : "On receipt"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-[12px] text-cream tabular-nums">
                          {docMoney(num(inv.total), inv.currency)}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-3 text-right font-mono text-[12px] tabular-nums ${num(inv.amount_paid) > 0 ? "text-emerald-300" : "text-sand/60"}`}>
                          {docMoney(num(inv.amount_paid), inv.currency)}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-3 text-right font-mono text-[12px] tabular-nums ${left > 0 && (inv.status === "issued" || inv.status === "partially_paid") ? "text-terra-bright" : "text-sand/60"}`}>
                          {docMoney(inv.status === "void" ? 0 : left, inv.currency)}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge doc={inv} today={today} />
                        </td>
                        <td className="px-3 py-3">
                          {owner && (
                            <span title={owner}>
                              <Avatar name={owner} size={22} />
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">{control(inv)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Below md: cards */}
            <ul className="md:hidden">
              {invoices.map((inv) => {
                const overdue = displayStatus(inv, today) === "overdue";
                const left = Math.max(0, num(inv.total) - num(inv.amount_paid));
                const c = control(inv, true);
                return (
                  <li key={inv.id} className="border-b border-cream/[0.06] px-4 py-3.5 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/admin/invoices/${inv.id}`} className="min-w-0 flex-1">
                        <span className="block font-mono text-[10.5px] uppercase tracking-[0.1em] text-sand">
                          {inv.number ?? "Draft"} · {formatDateShort(inv.issue_date)}
                        </span>
                        <span className="mt-0.5 block truncate font-display text-[14px] text-cream">{billedTo(inv)}</span>
                        <span className={`mt-0.5 block truncate text-[11.5px] ${overdue ? "text-rose-300" : "text-sand"}`}>
                          {cardLine(inv, left)}
                        </span>
                      </Link>
                      <StatusBadge doc={inv} today={today} />
                    </div>
                    {c && <div className="mt-3">{c}</div>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      {flow.node}
      {toast}
    </>
  );
}
