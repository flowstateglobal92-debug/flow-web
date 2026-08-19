"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Badge, Button, EmptyState, Field, Input, Panel, Select, Stat, fieldClass } from "@/components/admin/ui";
import { formatDate, money, moneyShort, toDateInput } from "@/lib/admin/format";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type FinanceEntry, type FinanceKind, type FinanceTotals } from "@/lib/admin/types";
import { createEntry, deleteEntry, updateEntry } from "@/app/admin/actions/finance";

type Monthly = { month: string; income: number; expense: number; profit: number; entries: number };

const monthLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${iso.slice(0, 7)}-01`));

export default function Ledger({
  entries,
  totals,
  monthly,
  month,
  kind,
  query,
}: {
  entries: FinanceEntry[];
  totals: FinanceTotals;
  monthly: Monthly[];
  month: string;
  kind: string;
  query: string;
}) {
  const router = useRouter();
  const { run, pending, toast } = useAction();
  const [modal, setModal] = useState<{ mode: "create" | "edit"; entry?: FinanceEntry; kind: FinanceKind } | null>(null);
  const [formKind, setFormKind] = useState<FinanceKind>("expense");
  const [search, setSearch] = useState(query);

  const profit = Number(totals.profit ?? 0);
  const income = Number(totals.income ?? 0);
  const expense = Number(totals.expense ?? 0);

  // What the current filter is showing, so the header numbers match the table.
  const shown = useMemo(() => {
    const inc = entries.filter((e) => e.kind === "income").reduce((a, e) => a + Number(e.amount), 0);
    const exp = entries.filter((e) => e.kind === "expense").reduce((a, e) => a + Number(e.amount), 0);
    return { income: inc, expense: exp, profit: inc - exp };
  }, [entries]);

  const goTo = (next: { month?: string; kind?: string; q?: string }) => {
    const params = new URLSearchParams();
    const m = next.month ?? month;
    const k = next.kind ?? kind;
    const q = next.q ?? search;
    if (m && m !== "all") params.set("month", m);
    if (k && k !== "all") params.set("kind", k);
    if (q.trim()) params.set("q", q.trim());
    router.push(`/admin/expenses${params.size ? `?${params}` : ""}`);
  };

  const open = (mode: "create" | "edit", entry?: FinanceEntry, k: FinanceKind = "expense") => {
    setFormKind(entry?.kind ?? k);
    setModal({ mode, entry, kind: entry?.kind ?? k });
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const editing = modal?.mode === "edit" ? modal.entry?.id : null;
    run(editing ? () => updateEntry(editing, fd) : () => createEntry(fd), {
      onDone: (r) => r.ok && setModal(null),
    });
  };

  const categories = formKind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <>
      {/* Position */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Income to date" value={moneyShort(income)} sub={`${totals.entries ?? 0} entries in the ledger`} tone="success" icon={<Icon.up size={15} />} />
        <Stat label="Expenses to date" value={moneyShort(expense)} sub="Everything the business has spent" tone="terra" icon={<Icon.down size={15} />} />
        <Stat
          label={profit < 0 ? "Net loss" : "Net profit"}
          value={money(profit)}
          sub={profit < 0 ? "Expenses are ahead of income" : "Income is ahead of expenses"}
          tone={profit < 0 ? "danger" : "success"}
          icon={<Icon.ledger size={15} />}
        />
        <Stat
          label="Showing"
          value={money(shown.profit)}
          sub={`${money(shown.income)} in · ${money(shown.expense)} out`}
          tone={shown.profit < 0 ? "danger" : "neutral"}
        />
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => open("create", undefined, "expense")}>
            <Icon.plus size={13} /> Add expense
          </Button>
          <Button onClick={() => open("create", undefined, "income")}>
            <Icon.plus size={13} /> Add income
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: "all", label: "All" },
            { key: "income", label: "Income" },
            { key: "expense", label: "Expenses" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => goTo({ kind: t.key })}
              className={`border px-3 py-1.5 text-[12px] font-medium transition-all duration-300 ${kind === t.key
                  ? "border-terra/50 bg-terra/15 text-terra-bright"
                  : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"
                }`}
            >
              {t.label}
            </button>
          ))}

          <select
            value={month}
            onChange={(e) => goTo({ month: e.target.value })}
            className="border border-cream/12 bg-ink/60 px-2.5 py-1.5 text-[12px] text-cream-2 focus:border-terra/60 focus:outline-none"
          >
            <option value="all" className="bg-ink text-cream">
              All time
            </option>
            {monthly.map((m) => (
              <option key={m.month} value={m.month.slice(0, 7)} className="bg-ink text-cream">
                {monthLabel(m.month)}
              </option>
            ))}
          </select>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              goTo({ q: search });
            }}
            className="relative w-full sm:w-52"
          >
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sand">
              <Icon.search size={14} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entries…"
              className={`${fieldClass} pl-9`}
            />
          </form>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
        <Panel bodyClass="p-0">
          {entries.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No entries yet"
                hint="Record what the business earns and what it spends — the profit line below updates itself."
                action={
                  <Button variant="primary" onClick={() => open("create", undefined, "expense")}>
                    <Icon.plus size={13} /> Add the first entry
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto scroll-thin" data-lenis-prevent>
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                    <th className="px-3 py-2.5 font-normal">Date</th>
                    <th className="px-3 py-2.5 font-normal">Description</th>
                    <th className="px-3 py-2.5 font-normal">Category</th>
                    <th className="px-3 py-2.5 font-normal">Method</th>
                    <th className="px-3 py-2.5 text-right font-normal">Amount</th>
                    <th className="w-16 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const isIncome = e.kind === "income";
                    const signed = Number(e.signed_amount ?? (isIncome ? e.amount : -e.amount));
                    return (
                      <tr key={e.id} className="group border-b border-cream/[0.05] transition-colors last:border-0 hover:bg-cream/[0.03]">
                        <td className="whitespace-nowrap px-3 py-3 text-[11.5px] text-sand">{formatDate(e.entry_date)}</td>
                        <td className="max-w-[280px] px-3 py-3">
                          <button type="button" onClick={() => open("edit", e)} className="block max-w-full truncate text-left text-[13px] text-cream hover:text-terra-bright">
                            {e.description}
                          </button>
                          {e.reference && <span className="block truncate text-[10.5px] text-sand">Ref {e.reference}</span>}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={isIncome ? "success" : "muted"}>{e.category}</Badge>
                        </td>
                        <td className="px-3 py-3 text-[11.5px] text-sand">{e.method ?? "—"}</td>
                        <td
                          className={`whitespace-nowrap px-3 py-3 text-right font-mono text-[12.5px] tabular-nums ${isIncome ? "text-emerald-300" : "text-rose-300"
                            }`}
                        >
                          {isIncome ? "+" : "−"}
                          {money(Math.abs(signed)).replace("−", "")}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => open("edit", e)}
                              aria-label="Edit entry"
                              className="text-sand transition-colors hover:text-cream"
                            >
                              <Icon.edit size={14} />
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                if (confirm(`Delete "${e.description}"?`)) run(() => deleteEntry(e.id));
                              }}
                              aria-label="Delete entry"
                              className="text-sand transition-colors hover:text-rose-300"
                            >
                              <Icon.trash size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-cream/[0.10] bg-cream/[0.02]">
                    <td colSpan={4} className="px-3 py-3 text-[11px] uppercase tracking-[0.16em] text-sand">
                      {month === "all" ? "All time" : monthLabel(month)} · net
                    </td>
                    <td
                      className={`px-3 py-3 text-right font-mono text-[13px] font-medium tabular-nums ${shown.profit < 0 ? "text-rose-300" : "text-emerald-300"
                        }`}
                    >
                      {money(shown.profit)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="By month" hint="Income, spend and the profit line" bodyClass="p-0">
          {monthly.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-sand">Nothing recorded yet.</p>
          ) : (
            <ul>
              {monthly.map((m) => {
                const peak = Math.max(...monthly.map((x) => Math.max(x.income, x.expense)), 1);
                return (
                  <li key={m.month} className="border-b border-cream/[0.05] px-4 py-3 last:border-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => goTo({ month: m.month.slice(0, 7) })}
                        className="text-[12.5px] text-cream transition-colors hover:text-terra-bright"
                      >
                        {monthLabel(m.month)}
                      </button>
                      <span
                        className={`font-mono text-[12px] tabular-nums ${m.profit < 0 ? "text-rose-300" : "text-emerald-300"}`}
                      >
                        {moneyShort(m.profit)}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1">
                      <div className="h-1 w-full bg-cream/[0.06]">
                        <div className="h-full bg-emerald-400/70" style={{ width: `${(m.income / peak) * 100}%` }} />
                      </div>
                      <div className="h-1 w-full bg-cream/[0.06]">
                        <div className="h-full bg-terra" style={{ width: `${(m.expense / peak) * 100}%` }} />
                      </div>
                    </div>
                    <div className="mt-1.5 flex justify-between font-mono text-[10px] text-sand tabular-nums">
                      <span>+{moneyShort(m.income)}</span>
                      <span>−{moneyShort(m.expense)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* Entry form */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? "Edit entry" : formKind === "income" ? "Add income" : "Add expense"}
        hint="Amounts are always positive here — expenses are subtracted for you."
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(["expense", "income"] as FinanceKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFormKind(k)}
                className={`border px-3 py-2 text-[12.5px] font-medium capitalize transition-all duration-300 ${formKind === k
                    ? k === "income"
                      ? "border-emerald-300/50 bg-emerald-400/10 text-emerald-200"
                      : "border-terra/50 bg-terra/15 text-terra-bright"
                    : "border-cream/12 bg-cream/[0.03] text-sand hover:text-cream"
                  }`}
              >
                {k}
              </button>
            ))}
          </div>
          <input type="hidden" name="kind" value={formKind} />

          <Field label="Description">
            <Input
              name="description"
              required
              defaultValue={modal?.entry?.description ?? ""}
              placeholder={formKind === "income" ? "Deposit — Kite Interiors" : "Supabase Pro — August"}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Amount (Rs)">
              <Input name="amount" type="number" min="0" step="0.01" required defaultValue={modal?.entry?.amount ?? ""} />
            </Field>
            <Field label="Date">
              <Input
                name="entry_date"
                type="date"
                required
                defaultValue={modal?.entry?.entry_date ?? toDateInput(new Date())}
              />
            </Field>
            <Field label="Category">
              <Select name="category" defaultValue={modal?.entry?.category ?? categories[0]}>
                {categories.map((c) => (
                  <option key={c} value={c} className="bg-ink text-cream">
                    {c}
                  </option>
                ))}
                {modal?.entry?.category && !categories.includes(modal.entry.category as never) && (
                  <option value={modal.entry.category} className="bg-ink text-cream">
                    {modal.entry.category}
                  </option>
                )}
              </Select>
            </Field>
            <Field label="Method">
              <Input name="method" defaultValue={modal?.entry?.method ?? ""} placeholder="Bank transfer, card, cash" />
            </Field>
          </div>

          <Field label="Reference" hint="Invoice or receipt number — optional.">
            <Input name="reference" defaultValue={modal?.entry?.reference ?? ""} placeholder="INV-0042" />
          </Field>

          <div className="flex items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
            {modal?.mode === "edit" && modal.entry && (
              <Button
                type="button"
                variant="danger"
                className="mr-auto"
                disabled={pending}
                onClick={() => {
                  if (confirm("Delete this entry?")) run(() => deleteEntry(modal.entry!.id), { onDone: (r) => r.ok && setModal(null) });
                }}
              >
                <Icon.trash size={13} /> Delete
              </Button>
            )}
            <Button type="button" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {modal?.mode === "edit" ? "Save entry" : formKind === "income" ? "Record income" : "Record expense"}
            </Button>
          </div>
        </form>
      </Modal>

      {toast}
    </>
  );
}
