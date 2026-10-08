"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { useAction } from "@/components/admin/useAction";
import { EmptyState, Panel, Stat, fieldClass } from "@/components/admin/ui";
import QuoteActions from "@/components/admin/invoice/QuoteActions";
import { StatusBadge, linkButton } from "@/components/admin/invoice/parts";
import { formatDate, formatDateShort, moneyShort, num } from "@/lib/admin/format";
import { NEW } from "@/lib/admin/links";
import { billedTo, displayStatus, docMoney, type Invoice } from "@/lib/admin/invoice-types";

export type QuoteFilter = "open" | "accepted" | "converted" | "closed" | "all";

const FILTER_TABS: { value: QuoteFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "accepted", label: "Accepted" },
  { value: "converted", label: "Invoiced" },
  { value: "closed", label: "Declined & expired" },
  { value: "all", label: "All" },
];

type Summary = {
  sent: { total: number; count: number };
  accepted: { total: number; count: number };
  winRate: number | null;
  decided: number;
};

export default function QuotesList({
  quotes,
  status,
  mine,
  query,
  today,
  canCrm,
  summary,
}: {
  quotes: Invoice[];
  status: QuoteFilter;
  mine: boolean;
  query: string;
  today: string;
  canCrm: boolean;
  summary: Summary;
}) {
  const router = useRouter();
  const { run, pending, toast } = useAction();
  const [search, setSearch] = useState(query);

  const goTo = (next: { status?: QuoteFilter; mine?: boolean; q?: string }) => {
    const params = new URLSearchParams();
    const s = next.status ?? status;
    const m = next.mine ?? mine;
    const q = next.q ?? search;
    if (s !== "open") params.set("status", s);
    if (m) params.set("mine", "1");
    if (q.trim()) params.set("q", q.trim());
    router.push(`/admin/invoices/quotes${params.size ? `?${params}` : ""}`);
  };

  return (
    <>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Out with clients"
          value={moneyShort(summary.sent.total)}
          sub={`${summary.sent.count} quote${summary.sent.count === 1 ? "" : "s"} waiting for an answer`}
          icon={<Icon.send size={15} />}
        />
        <Stat
          label="Accepted · to invoice"
          value={moneyShort(summary.accepted.total)}
          sub={summary.accepted.count ? `${summary.accepted.count} ready to convert` : "Nothing waiting to convert"}
          tone={summary.accepted.count ? "terra" : "neutral"}
          icon={<Icon.check size={15} />}
        />
        <Stat
          label="Win rate"
          value={summary.winRate == null ? "—" : `${summary.winRate}%`}
          sub={summary.decided ? `Of ${summary.decided} quotes with an answer` : "No answers recorded yet"}
          tone={summary.winRate != null && summary.winRate >= 50 ? "success" : "neutral"}
          icon={<Icon.chart size={15} />}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
              aria-label="Search quotes"
              className={`${fieldClass} pl-9`}
            />
          </form>
        </div>
      </div>

      <Panel bodyClass="p-0">
        {quotes.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={status === "open" && !query && !mine ? "No open quotes" : "Nothing matches"}
              hint="Send a quote, record the client's answer, then turn it into an invoice in one click."
              action={
                <Link href={NEW.quote()} className={`${linkButton.primary} min-h-9`}>
                  <Icon.plus size={13} /> New quote
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scroll-thin md:block" data-lenis-prevent>
              <table className="w-full min-w-[860px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                    <th className="px-3 py-2.5 font-normal">Quote</th>
                    <th className="px-3 py-2.5 font-normal">Date</th>
                    <th className="px-3 py-2.5 font-normal">Valid until</th>
                    <th className="px-3 py-2.5 text-right font-normal">Total</th>
                    <th className="px-3 py-2.5 font-normal">Status</th>
                    <th className="px-3 py-2.5 font-normal">Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((qt) => {
                    const expired = displayStatus(qt, today) === "expired";
                    return (
                      <tr key={qt.id} className="border-b border-cream/[0.05] align-middle transition-colors last:border-0 hover:bg-cream/[0.03]">
                        <td className="max-w-[280px] px-3 py-3">
                          <Link href={`/admin/invoices/${qt.id}`} className="group block min-w-0">
                            <span className="block font-mono text-[11px] tracking-[0.06em] text-sand group-hover:text-terra-bright">
                              {qt.number ?? "Draft"}
                            </span>
                            <span className="block truncate text-[13px] text-cream group-hover:text-terra-bright">{billedTo(qt)}</span>
                            {qt.subject && <span className="block truncate text-[11px] text-sand">{qt.subject}</span>}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[11.5px] text-sand">{formatDate(qt.issue_date)}</td>
                        <td className={`whitespace-nowrap px-3 py-3 text-[11.5px] ${expired ? "text-bad-300" : "text-sand"}`}>
                          {qt.valid_until ? formatDate(qt.valid_until) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-[12px] text-cream tabular-nums">
                          {docMoney(num(qt.total), qt.currency)}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge doc={qt} today={today} />
                        </td>
                        <td className="px-3 py-3">
                          <QuoteActions quote={qt} run={run} pending={pending} today={today} canCrm={canCrm} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="md:hidden">
              {quotes.map((qt) => {
                const expired = displayStatus(qt, today) === "expired";
                return (
                  <li key={qt.id} className="border-b border-cream/[0.06] px-4 py-3.5 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/admin/invoices/${qt.id}`} className="min-w-0 flex-1">
                        <span className="block font-mono text-[10.5px] uppercase tracking-[0.1em] text-sand">
                          {qt.number ?? "Draft"} · {formatDateShort(qt.issue_date)}
                        </span>
                        <span className="mt-0.5 block truncate font-display text-[14px] text-cream">{billedTo(qt)}</span>
                        <span className={`mt-0.5 block truncate text-[11.5px] ${expired ? "text-bad-300" : "text-sand"}`}>
                          {docMoney(num(qt.total), qt.currency)}
                          {qt.valid_until ? ` · valid until ${formatDateShort(qt.valid_until)}` : ""}
                        </span>
                      </Link>
                      <StatusBadge doc={qt} today={today} />
                    </div>
                    <div className="mt-3">
                      <QuoteActions quote={qt} run={run} pending={pending} today={today} canCrm={canCrm} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>
      {toast}
    </>
  );
}
