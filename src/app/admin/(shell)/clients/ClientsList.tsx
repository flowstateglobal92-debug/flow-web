"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { Avatar, Badge, Button, EmptyState, Panel, fieldClass } from "@/components/admin/ui";
import { displayName, formatDateShort } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import type { TeamMember } from "@/lib/admin/types";
import ClientForm from "./ClientForm";
import { pillClass } from "./kit";
import {
  CLIENT_STATUS,
  clientSubtitle,
  clientTitle,
  formatTotals,
  type Client,
  type ClientStatus,
  type CurrencyTotals,
} from "./model";

export type ListTab = "all" | ClientStatus;

/** Per-client money, worked out on the server for people with Invoices access. */
export type ClientSummary = {
  balance: CurrencyTotals;
  last: { number: string | null; issue_date: string } | null;
};

// The add modal portals into document.body, so it waits for hydration.
const noop = () => () => {};

export default function ClientsList({
  clients,
  summary,
  team,
  managers,
  me,
  tabs,
  activeTab,
  query,
  mine,
  can,
  startNew,
}: {
  clients: Client[];
  summary: Record<string, ClientSummary>;
  team: TeamMember[];
  managers: TeamMember[];
  me: string;
  tabs: { key: ListTab; label: string; count: number }[];
  activeTab: ListTab;
  query: string;
  mine: boolean;
  /** `ownership` = the account-manager column (0012) is in place. */
  can: { invoices: boolean; ownership: boolean };
  /** `?new=1` (NEW.client(), ⌘K) opens the add form. */
  startNew: boolean;
}) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [search, setSearch] = useState(query);
  const [adding, setAdding] = useState(startNew);

  // Following the quick action again while already here reopens the form.
  const [seenNew, setSeenNew] = useState(startNew);
  if (seenNew !== startNew) {
    setSeenNew(startNew);
    if (startNew) setAdding(true);
  }

  const names = useMemo(() => new Map(team.map((m) => [m.id, displayName(m)])), [team]);

  const listHref = useCallback(
    (next: { status?: string; q?: string; mine?: boolean } = {}) => {
      const params = new URLSearchParams();
      const status = next.status ?? activeTab;
      const q = next.q ?? query;
      if (status !== "all") params.set("status", status);
      if (q.trim()) params.set("q", q.trim());
      if (next.mine ?? mine) params.set("scope", "mine");
      return `/admin/clients${params.size ? `?${params}` : ""}`;
    },
    [activeTab, query, mine],
  );

  const closeAdd = useCallback(() => {
    setAdding(false);
    // Drop ?new=1 so a refresh doesn't reopen the form.
    if (startNew) router.replace(listHref(), { scroll: false });
  }, [startNew, router, listHref]);

  const managerOf = (c: Client) => (c.account_manager_id ? names.get(c.account_manager_id) : undefined);
  const balanceOf = (c: Client) => formatTotals(summary[c.id]?.balance ?? []);

  return (
    <>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Icon.plus size={13} /> Add client
          </Button>
          {can.ownership && (
            <div className="ml-1 flex items-center gap-1" role="group" aria-label="Whose clients">
              {[
                { key: false, label: "Everyone" },
                { key: true, label: "Mine" },
              ].map((s) => (
                <button
                  key={s.label}
                  type="button"
                  aria-pressed={mine === s.key}
                  onClick={() => router.push(listHref({ mine: s.key }))}
                  className={pillClass(mine === s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(listHref({ q: search }));
          }}
          className="relative w-full sm:w-64"
        >
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sand">
            <Icon.search size={14} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, business, email…"
            aria-label="Search clients"
            className={`${fieldClass} pl-9`}
          />
        </form>
      </div>

      <Tabs
        value={activeTab}
        onChange={(status) => router.push(listHref({ status }))}
        options={tabs.map((t) => ({ value: t.key, label: t.label, count: t.count }))}
        className="mb-4 [&>button]:pointer-coarse:min-h-9"
      />

      {clients.length === 0 ? (
        <EmptyState
          title={query || mine || activeTab !== "all" ? "No clients match" : "No clients yet"}
          hint={
            query || mine || activeTab !== "all"
              ? "Try another tab or search, or switch to Everyone."
              : "Add the businesses you work with, or convert a lead from its card in the CRM."
          }
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Icon.plus size={13} /> Add a client
            </Button>
          }
        />
      ) : (
        <>
          {/* Table from md up */}
          <Panel bodyClass="p-0" className="hidden md:block">
            <div className="overflow-x-auto scroll-thin" data-lenis-prevent>
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                    <th className="px-3 py-2.5 font-normal">Client</th>
                    <th className="px-3 py-2.5 font-normal">Contact</th>
                    {can.ownership && <th className="px-3 py-2.5 font-normal">Account manager</th>}
                    {can.invoices && <th className="px-3 py-2.5 text-right font-normal">Open balance</th>}
                    {can.invoices && <th className="px-3 py-2.5 font-normal">Last invoice</th>}
                    <th className="px-3 py-2.5 font-normal">Status</th>
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => {
                    const href = hrefFor("client", c.id) ?? "/admin/clients";
                    const manager = managerOf(c);
                    const balance = balanceOf(c);
                    const last = summary[c.id]?.last;
                    return (
                      <tr key={c.id} className="border-b border-cream/[0.05] transition-colors last:border-0 hover:bg-cream/[0.03]">
                        <td className="max-w-[260px] px-3 py-3">
                          <Link href={href} className="flex min-w-0 items-center gap-2.5">
                            <Avatar name={clientTitle(c)} size={30} />
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium text-cream hover:text-terra-bright">
                                {clientTitle(c)}
                              </span>
                              <span className="block truncate text-[11px] text-sand">
                                {c.company ? c.name : c.city || "—"}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="max-w-[220px] px-3 py-3 text-[12px] text-cream-2">
                          <span className="block truncate">{c.email ?? "—"}</span>
                          {c.phone && <span className="block truncate text-[10.5px] text-sand">{c.phone}</span>}
                        </td>
                        {can.ownership && (
                          <td className="px-3 py-3">
                            {manager ? (
                              <span className="flex min-w-0 items-center gap-2 text-[12px] text-cream-2">
                                <Avatar name={manager} size={22} />
                                <span className="truncate">{manager}</span>
                              </span>
                            ) : (
                              <span className="text-[12px] text-sand">Unassigned</span>
                            )}
                          </td>
                        )}
                        {can.invoices && (
                          <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-[12.5px] tabular-nums">
                            <span className={summary[c.id]?.balance.some((b) => b.amount > 0) ? "text-terra-bright" : "text-sand"}>
                              {balance.main}
                            </span>
                            {balance.rest && <span className="block text-[10.5px] text-sand">{balance.rest}</span>}
                          </td>
                        )}
                        {can.invoices && (
                          <td className="whitespace-nowrap px-3 py-3 text-[12px] text-cream-2">
                            {last ? (
                              <>
                                <span className="block font-mono">{last.number ?? "—"}</span>
                                <span className="block text-[10.5px] text-sand">{formatDateShort(last.issue_date)}</span>
                              </>
                            ) : (
                              <span className="text-sand">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-3">
                          <Badge tone={CLIENT_STATUS[c.status]?.tone ?? "neutral"}>{CLIENT_STATUS[c.status]?.label ?? c.status}</Badge>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Link href={href} aria-label={`Open ${clientTitle(c)}`} className="text-sand transition-colors hover:text-cream">
                            <Icon.arrow size={15} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Cards below md */}
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {clients.map((c) => {
              const manager = managerOf(c);
              const balance = balanceOf(c);
              const owing = summary[c.id]?.balance.some((b) => b.amount > 0);
              return (
                <li key={c.id} className="min-w-0">
                  <Link
                    href={hrefFor("client", c.id) ?? "/admin/clients"}
                    className="block border border-cream/10 bg-cream/[0.035] p-3 transition-colors hover:border-cream/25 hover:bg-cream/[0.06]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <Avatar name={clientTitle(c)} size={30} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-cream">{clientTitle(c)}</p>
                          <p className="truncate text-[11.5px] text-sand">{clientSubtitle(c)}</p>
                        </div>
                      </div>
                      <Badge tone={CLIENT_STATUS[c.status]?.tone ?? "neutral"}>{CLIENT_STATUS[c.status]?.label ?? c.status}</Badge>
                    </div>
                    {(can.invoices || manager) && (
                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-cream/[0.06] pt-2">
                        <span className={`truncate font-mono text-[11.5px] tabular-nums ${owing ? "text-terra-bright" : "text-sand"}`}>
                          {can.invoices ? (owing ? `${balance.main} open` : "No open balance") : ""}
                        </span>
                        {manager && (
                          <span title={`Account manager · ${manager}`} className="shrink-0">
                            <Avatar name={manager} size={20} />
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ClientForm
        open={hydrated && adding}
        onClose={closeAdd}
        managers={managers}
        me={me}
        ownership={can.ownership}
      />
    </>
  );
}
