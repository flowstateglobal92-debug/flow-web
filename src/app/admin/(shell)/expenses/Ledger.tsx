"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, Select, Stat, fieldClass } from "@/components/admin/ui";
import { formatDate, money, moneyShort, todayISO } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type FinanceKind, type FinanceTotals } from "@/lib/admin/types";
import { createEntry, deleteEntry, deleteReceipt, updateEntry } from "@/app/admin/actions/finance";
import ReceiptDrop from "./ReceiptDrop";
import ReceiptViewer from "./ReceiptViewer";
import { formatBytes, type LedgerEntry, type Receipt } from "./types";
import { describeUploads, useReceiptUploads } from "./uploads";

type Monthly = { month: string; income: number; expense: number; profit: number; entries: number };

type ModalState = { mode: "create" | "edit" | "view"; entry?: LedgerEntry; kind: FinanceKind };

const monthLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso.slice(0, 7)}-01T00:00:00Z`),
  );

const stateOf = (e: LedgerEntry) => e.approval_status ?? "approved";
/** Pending and rejected entries sit in the ledger but never in a total. */
const counts = (e: LedgerEntry) => stateOf(e) === "approved";
const isLinked = (e: LedgerEntry) => !!e.invoice_payment_id;

/** What a deep link (?open= / ?new=) asks for on load. */
function fromLink(entry: LedgerEntry | null, create: FinanceKind | null): ModalState | null {
  if (entry) return { mode: isLinked(entry) ? "view" : "edit", entry, kind: entry.kind };
  if (create) return { mode: "create", kind: create };
  return null;
}

export default function Ledger({
  entries,
  totals,
  monthly,
  month,
  kind,
  status,
  query,
  approvals,
  pendingCount,
  openEntry,
  create,
  canInvoices,
  approver,
  workspace,
}: {
  entries: LedgerEntry[];
  totals: FinanceTotals;
  monthly: Monthly[];
  month: string;
  kind: string;
  status: string;
  query: string;
  /** False until 0016 has run — hides the status filter. */
  approvals: boolean;
  pendingCount: number;
  openEntry: LedgerEntry | null;
  create: FinanceKind | null;
  canInvoices: boolean;
  approver: boolean;
  /** The receipts folder's first segment — the bucket's policies check it (0017). */
  workspace: string;
}) {
  const router = useRouter();
  const { run, pending, toast } = useAction();
  const [modal, setModal] = useState<ModalState | null>(() => fromLink(openEntry, create));
  const [formKind, setFormKind] = useState<FinanceKind>(openEntry?.kind ?? create ?? "expense");
  const formUploads = useReceiptUploads();
  const viewerUploads = useReceiptUploads();
  // Set once a new entry is saved but a receipt didn't upload: the dialog
  // stays open on it, and saving again updates it (retrying the files)
  // instead of recording a twin.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ entryId: string; index: number } | null>(null);
  const [search, setSearch] = useState(query);

  // A notification or ⌘K result can land here again with a different ?open= —
  // reopen on the new link (render-time sync, as in crm/Board.tsx).
  const linkKey = `${openEntry?.id ?? ""}|${create ?? ""}`;
  const [seenLink, setSeenLink] = useState(linkKey);
  if (seenLink !== linkKey) {
    setSeenLink(linkKey);
    const next = fromLink(openEntry, create);
    if (next) {
      setModal(next);
      setFormKind(next.kind);
      setSavedId(null);
      formUploads.clear();
    }
  }

  /** The freshest copy of an entry after a refresh (receipts change under an open modal). */
  const latest = (id: string | undefined) =>
    id ? (entries.find((e) => e.id === id) ?? (openEntry?.id === id ? openEntry : undefined)) : undefined;
  const current = modal?.entry ? (latest(modal.entry.id) ?? modal.entry) : undefined;
  const viewerEntry = viewer ? latest(viewer.entryId) : undefined;
  /** The entry the form saves to: the one opened, or the one just recorded (savedId). */
  const entryId = modal?.mode === "edit" ? modal.entry?.id : (savedId ?? undefined);
  const editing = modal?.mode === "edit" ? current : savedId ? latest(savedId) : undefined;
  const uploading = formUploads.items.some((i) => i.status === "uploading");

  const profit = Number(totals.profit ?? 0);
  const income = Number(totals.income ?? 0);
  const expense = Number(totals.expense ?? 0);

  // What the current filter is showing, so the header numbers match the table — approved only.
  const shown = useMemo(() => {
    const counted = entries.filter(counts);
    const inc = counted.filter((e) => e.kind === "income").reduce((a, e) => a + Number(e.amount), 0);
    const exp = counted.filter((e) => e.kind === "expense").reduce((a, e) => a + Number(e.amount), 0);
    return { income: inc, expense: exp, profit: inc - exp, waiting: entries.length - counted.length };
  }, [entries]);

  const peak = useMemo(() => Math.max(...monthly.map((x) => Math.max(x.income, x.expense)), 1), [monthly]);

  const filterHref = (next: { month?: string; kind?: string; status?: string; q?: string }) => {
    const params = new URLSearchParams();
    const m = next.month ?? month;
    const k = next.kind ?? kind;
    const s = next.status ?? status;
    const q = next.q ?? search;
    if (m && m !== "all") params.set("month", m);
    if (k && k !== "all") params.set("kind", k);
    if (s && s !== "all") params.set("status", s);
    if (q.trim()) params.set("q", q.trim());
    return `/admin/expenses${params.size ? `?${params}` : ""}`;
  };
  const goTo = (next: Parameters<typeof filterHref>[0]) => router.push(filterHref(next));

  const open = (mode: ModalState["mode"], entry?: LedgerEntry, k: FinanceKind = "expense") => {
    const m = entry && isLinked(entry) ? "view" : mode;
    setFormKind(entry?.kind ?? k);
    setSavedId(null);
    formUploads.clear();
    setModal({ mode: m, entry, kind: entry?.kind ?? k });
  };

  const closeModal = () => {
    setModal(null);
    setSavedId(null);
    formUploads.clear();
    // Drop ?open= / ?new= so a reload doesn't pop the dialog again.
    if (openEntry || create) router.replace(filterHref({}), { scroll: false });
  };

  /**
   * Save the entry first — that's what must not be lost — then upload the
   * queued receipts to it from the browser. A file that fails keeps the
   * dialog open with its reason; the entry is already in the ledger.
   */
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const queue = formUploads.items;
    run(
      async () => {
        const saved = entryId ? await updateEntry(entryId, fd) : await createEntry(fd);
        if (!saved.ok || !saved.id || queue.length === 0) return saved;
        setSavedId(saved.id);
        const outcome = await formUploads.send(saved.id, workspace, queue);
        const text = `${saved.message ?? "Saved."} ${describeUploads(outcome)}`;
        return outcome.failed.length ? { ok: false, id: saved.id, error: text } : { ...saved, message: text };
      },
      { onDone: (r) => r.ok && closeModal() },
    );
  };

  const remove = (e: LedgerEntry, after?: () => void) => {
    const n = e.finance_attachments?.length ?? 0;
    const extra = n ? ` Its ${n === 1 ? "receipt" : `${n} receipts`} will be deleted too.` : "";
    if (confirm(`Delete "${e.description}"?${extra}`)) run(() => deleteEntry(e.id), { onDone: (r) => r.ok && after?.() });
  };

  const showReceipts = (e: LedgerEntry, index = 0) => setViewer({ entryId: e.id, index });

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
          <Button variant="primary" className="min-h-9 sm:min-h-0" onClick={() => open("create", undefined, "expense")}>
            <Icon.plus size={13} /> Add expense
          </Button>
          <Button className="min-h-9 sm:min-h-0" onClick={() => open("create", undefined, "income")}>
            <Icon.plus size={13} /> Add income
          </Button>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {[
            { key: "all", label: "All" },
            { key: "income", label: "Income" },
            { key: "expense", label: "Expenses" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => goTo({ kind: t.key })}
              className={`min-h-9 border px-3 py-1.5 text-[12px] font-medium transition-all duration-300 sm:min-h-0 ${kind === t.key
                  ? "border-terra/50 bg-terra/15 text-terra-bright"
                  : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"
                }`}
            >
              {t.label}
            </button>
          ))}

          <select
            value={month}
            aria-label="Month"
            onChange={(e) => goTo({ month: e.target.value })}
            className="min-h-9 border border-cream/12 bg-ink/60 px-2.5 py-1.5 text-[12px] text-cream-2 focus:border-terra/60 focus:outline-none sm:min-h-0"
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

          {approvals && (
            <select
              value={status}
              aria-label="Approval status"
              onChange={(e) => goTo({ status: e.target.value })}
              className="min-h-9 border border-cream/12 bg-ink/60 px-2.5 py-1.5 text-[12px] text-cream-2 focus:border-terra/60 focus:outline-none sm:min-h-0"
            >
              <option value="all" className="bg-ink text-cream">
                Any status
              </option>
              <option value="approved" className="bg-ink text-cream">
                Approved
              </option>
              <option value="pending" className="bg-ink text-cream">
                Pending{pendingCount ? ` (${pendingCount})` : ""}
              </option>
              <option value="rejected" className="bg-ink text-cream">
                Rejected
              </option>
            </select>
          )}

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
              aria-label="Search entries"
              className={`${fieldClass} pl-9`}
            />
          </form>
        </div>
      </div>

      {pendingCount > 0 && status !== "pending" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-warn-300/20 bg-warn-400/[0.06] px-3.5 py-2.5 text-[12px] text-warn-100">
          <span className="min-w-0">
            {pendingCount === 1 ? "1 entry is" : `${pendingCount} entries are`} waiting for approval — not counted in any total yet.
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={() => goTo({ status: "pending" })} className="min-h-9 text-warn-200 underline-offset-4 hover:underline sm:min-h-0">
              Show them
            </button>
            {approver && (
              <Link href="/admin/approvals" className="inline-flex min-h-9 items-center text-warn-200 underline-offset-4 hover:underline sm:min-h-0">
                Review
              </Link>
            )}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel bodyClass="p-0" className="min-w-0">
          {entries.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={query || month !== "all" || kind !== "all" || status !== "all" ? "Nothing matches" : "No entries yet"}
                hint="Record what the business earns and what it spends — the profit line below updates itself."
                action={
                  <Button variant="primary" onClick={() => open("create", undefined, "expense")}>
                    <Icon.plus size={13} /> Add an entry
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              {/* md+ : table */}
              <div className="hidden overflow-x-auto scroll-thin md:block" data-lenis-prevent>
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                      <th className="px-3 py-2.5 font-normal">Date</th>
                      <th className="px-3 py-2.5 font-normal">Description</th>
                      <th className="px-3 py-2.5 font-normal">Category</th>
                      <th className="px-3 py-2.5 font-normal">Method</th>
                      <th className="px-3 py-2.5 text-right font-normal">Amount</th>
                      <th className="w-24 px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="group border-b border-cream/[0.05] transition-colors last:border-0 hover:bg-cream/[0.03]">
                        <td className="whitespace-nowrap px-3 py-3 align-top text-[11.5px] text-sand">{formatDate(e.entry_date)}</td>
                        <td className="max-w-[300px] px-3 py-3 align-top">
                          <button
                            type="button"
                            onClick={() => open("edit", e)}
                            className="block max-w-full truncate text-left text-[13px] text-cream hover:text-terra-bright"
                          >
                            {e.description}
                          </button>
                          <EntryMeta entry={e} canInvoices={canInvoices} />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <Badge tone={e.kind === "income" ? "success" : "muted"}>{e.category}</Badge>
                        </td>
                        <td className="px-3 py-3 align-top text-[11.5px] text-sand">{e.method ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right align-top">
                          <Amount entry={e} />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <RowActions
                            entry={e}
                            pending={pending}
                            onReceipts={() => showReceipts(e)}
                            onEdit={() => open("edit", e)}
                            onDelete={() => remove(e)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-cream/[0.10] bg-cream/[0.02]">
                      <td colSpan={4} className="px-3 py-3 text-[11px] uppercase tracking-[0.16em] text-sand">
                        {month === "all" ? "All time" : monthLabel(month)} · net
                        {shown.waiting > 0 && <span className="ml-2 normal-case tracking-normal text-sand/70">· {shown.waiting} awaiting approval not counted</span>}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-mono text-[13px] font-medium tabular-nums ${shown.profit < 0 ? "text-bad-300" : "text-ok-300"}`}
                      >
                        {money(shown.profit)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* below md : cards */}
              <ul className="md:hidden">
                {entries.map((e) => (
                  <li key={e.id} className="border-b border-cream/[0.05] px-4 py-3 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => open("edit", e)}
                          className="block max-w-full truncate text-left text-[13.5px] text-cream"
                        >
                          {e.description}
                        </button>
                        <p className="mt-0.5 truncate text-[11px] text-sand">
                          {formatDate(e.entry_date)} · {e.category}
                          {e.method ? ` · ${e.method}` : ""}
                        </p>
                      </div>
                      <Amount entry={e} />
                    </div>
                    <EntryMeta entry={e} canInvoices={canInvoices} />
                    <div className="mt-1.5 flex justify-end">
                      <RowActions
                        entry={e}
                        pending={pending}
                        touch
                        onReceipts={() => showReceipts(e)}
                        onEdit={() => open("edit", e)}
                        onDelete={() => remove(e)}
                      />
                    </div>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 bg-cream/[0.02] px-4 py-3">
                  <span className="text-[10.5px] uppercase tracking-[0.16em] text-sand">
                    {month === "all" ? "All time" : monthLabel(month)} · net
                  </span>
                  <span className={`font-mono text-[13px] font-medium tabular-nums ${shown.profit < 0 ? "text-bad-300" : "text-ok-300"}`}>
                    {money(shown.profit)}
                  </span>
                </li>
              </ul>
            </>
          )}
        </Panel>

        <Panel title="By month" hint="Income, spend and the profit line · approved only" bodyClass="p-0" className="min-w-0">
          {monthly.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-sand">Nothing recorded yet.</p>
          ) : (
            <ul>
              {monthly.map((m) => (
                <li key={m.month} className="border-b border-cream/[0.05] px-4 py-3 last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => goTo({ month: m.month.slice(0, 7) })}
                      className="text-[12.5px] text-cream transition-colors hover:text-terra-bright"
                    >
                      {monthLabel(m.month)}
                    </button>
                    <span className={`font-mono text-[12px] tabular-nums ${m.profit < 0 ? "text-bad-300" : "text-ok-300"}`}>
                      {moneyShort(m.profit)}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="h-1 w-full bg-cream/[0.06]">
                      <div className="h-full bg-ok-400/70" style={{ width: `${(m.income / peak) * 100}%` }} />
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
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Linked payment — read only */}
      <Modal open={modal?.mode === "view" && !!current} onClose={closeModal} title={current?.description ?? "Payment"} hint="Posted automatically from Invoices.">
        {current && (
          <div className="space-y-4">
            <Notice tone="info" title={`This income belongs to ${current.reference ?? "an invoice"}`}>
              Payments post here by themselves. Change or remove it from the invoice and the ledger follows.
            </Notice>
            <dl className="grid grid-cols-1 gap-3 text-[12.5px] sm:grid-cols-2">
              <Fact label="Amount" value={money(Number(current.amount), { decimals: true })} />
              <Fact label="Received" value={formatDate(current.entry_date)} />
              <Fact label="Category" value={current.category} />
              <Fact label="Method" value={current.method ?? "—"} />
            </dl>
            <ReceiptList
              receipts={current.finance_attachments ?? []}
              pending={pending}
              onOpen={(i) => showReceipts(current, i)}
              onRemove={(r) => run(() => deleteReceipt(r.id))}
            />
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
              <Button type="button" onClick={() => showReceipts(current)}>
                <Icon.paperclip size={13} /> Receipts
              </Button>
              {canInvoices && current.invoice_id && (
                <Link
                  href={hrefFor("invoice", current.invoice_id) ?? "/admin/invoices"}
                  className="btn btn--primary inline-flex items-center gap-1.5 rounded-none px-3 py-1.5 text-[12px] font-medium"
                >
                  <Icon.receipt size={13} /> Open {current.reference ?? "invoice"}
                </Link>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Entry form */}
      <Modal
        open={!!modal && modal.mode !== "view"}
        onClose={closeModal}
        title={entryId ? "Edit entry" : formKind === "income" ? "Add income" : "Add expense"}
        hint="Amounts are always positive here — expenses are subtracted for you."
      >
        <form key={`${modal?.mode}-${modal?.entry?.id ?? "new"}`} onSubmit={submit} className="space-y-4">
          {editing && stateOf(editing) === "pending" && (
            <Notice tone="warn" title="Waiting for approval">
              It stays out of every total until an admin approves it.
            </Notice>
          )}
          {editing && stateOf(editing) === "rejected" && (
            <Notice tone="danger" title="Rejected">
              {editing.approval_note ? `“${editing.approval_note}” — ` : ""}Saving your changes sends it back for approval.
            </Notice>
          )}

          <div className="grid grid-cols-2 gap-2">
            {(["expense", "income"] as FinanceKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFormKind(k)}
                className={`min-h-9 border px-3 py-2 text-[12.5px] font-medium capitalize transition-all duration-300 ${formKind === k
                    ? k === "income"
                      ? "border-ok-300/50 bg-ok-400/10 text-ok-200"
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
              defaultValue={editing?.description ?? ""}
              placeholder={formKind === "income" ? "Deposit — Kite Interiors" : "Supabase Pro — August"}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Amount (Rs)">
              <Input name="amount" type="number" min="0" step="0.01" required inputMode="decimal" defaultValue={editing?.amount ?? ""} />
            </Field>
            <Field label="Date">
              <Input name="entry_date" type="date" required defaultValue={editing?.entry_date ?? todayISO()} />
            </Field>
            <Field label="Category">
              <Select name="category" defaultValue={editing?.category ?? categories[0]}>
                {categories.map((c) => (
                  <option key={c} value={c} className="bg-ink text-cream">
                    {c}
                  </option>
                ))}
                {editing?.category && !categories.includes(editing.category as never) && (
                  <option value={editing.category} className="bg-ink text-cream">
                    {editing.category}
                  </option>
                )}
              </Select>
            </Field>
            <Field label="Method">
              <Input name="method" defaultValue={editing?.method ?? ""} placeholder="Bank transfer, card, cash" />
            </Field>
          </div>

          <Field label="Reference" hint="Invoice or receipt number — optional.">
            <Input name="reference" defaultValue={editing?.reference ?? ""} placeholder="INV-0042" />
          </Field>

          <div>
            <span className="mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-sand">Receipts</span>
            {editing && (editing.finance_attachments?.length ?? 0) > 0 && (
              <div className="mb-2">
                <ReceiptList
                  receipts={editing.finance_attachments ?? []}
                  pending={pending}
                  onOpen={(i) => showReceipts(editing, i)}
                  onRemove={(r) => run(() => deleteReceipt(r.id))}
                />
              </div>
            )}
            <ReceiptDrop items={formUploads.items} onAdd={formUploads.add} onRemove={formUploads.remove} disabled={pending} />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
            {editing && (
              <Button type="button" variant="danger" className="mr-auto min-h-9 sm:min-h-0" disabled={pending} onClick={() => remove(editing, closeModal)}>
                <Icon.trash size={13} /> Delete
              </Button>
            )}
            <Button type="button" className="min-h-9 sm:min-h-0" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="min-h-9 sm:min-h-0" disabled={pending}>
              {uploading ? "Uploading…" : pending ? "Saving…" : entryId ? "Save entry" : formKind === "income" ? "Record income" : "Record expense"}
            </Button>
          </div>
        </form>
      </Modal>

      {viewerEntry && viewer && (
        <ReceiptViewer
          key={viewerEntry.id}
          title={viewerEntry.description}
          receipts={viewerEntry.finance_attachments ?? []}
          start={viewer.index}
          canEdit
          pending={pending}
          uploads={viewerUploads.items}
          onClose={() => {
            setViewer(null);
            viewerUploads.clear();
          }}
          onDelete={(r) => run(() => deleteReceipt(r.id))}
          onAdd={(list) => {
            const queue = viewerUploads.add(list);
            run(async () => {
              const outcome = await viewerUploads.send(viewerEntry.id, workspace, queue);
              const text = describeUploads(outcome);
              return outcome.failed.length ? { ok: false, error: text } : { ok: true, message: text };
            });
          }}
          onDismissUpload={viewerUploads.remove}
          onError={(error) => run(async () => ({ ok: false, error }))}
        />
      )}

      {toast}
    </>
  );
}

/* ─────────────────────────────── pieces ─────────────────────────────── */

function Amount({ entry: e }: { entry: LedgerEntry }) {
  const isIncome = e.kind === "income";
  const signed = Number(e.signed_amount ?? (isIncome ? e.amount : -e.amount));
  const counted = counts(e);
  // A refund (0033) is income going back out: negative, and shown as money out.
  const tone = !counted ? "text-sand" : signed >= 0 ? "text-ok-300" : "text-bad-300";
  return (
    <span
      title={counted ? (isIncome && signed < 0 ? "Refund — comes off Income" : undefined) : "Not counted until approved"}
      className={`shrink-0 whitespace-nowrap font-mono text-[12.5px] tabular-nums ${tone} ${stateOf(e) === "rejected" ? "line-through decoration-sand/60" : ""}`}
    >
      {signed >= 0 ? "+" : "−"}
      {money(Math.abs(signed)).replace("−", "")}
    </span>
  );
}

/** Ref / invoice link and the approval state, under the description. */
function EntryMeta({ entry: e, canInvoices }: { entry: LedgerEntry; canInvoices: boolean }) {
  const invoiceHref = isLinked(e) || e.invoice_id ? hrefFor("invoice", e.invoice_id) : null;
  const state = stateOf(e);
  return (
    <>
      {invoiceHref && canInvoices ? (
        <Link
          href={invoiceHref}
          className="mt-0.5 inline-flex min-h-7 items-center gap-1 font-mono text-[10.5px] text-terra-bright hover:underline md:min-h-0"
        >
          <Icon.receipt size={11} /> {e.reference ?? "Invoice"}
        </Link>
      ) : (
        e.reference && <span className="block truncate text-[10.5px] text-sand">Ref {e.reference}</span>
      )}
      {state === "pending" && (
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          <Badge tone="warn">
            <Icon.clock size={10} /> Pending
          </Badge>
          <span className="truncate text-[10.5px] text-sand">Not counted until approved</span>
        </span>
      )}
      {state === "rejected" && (
        <span className="mt-1 flex min-w-0 items-start gap-1.5">
          <Badge tone="danger">Rejected</Badge>
          <span className="min-w-0 text-[10.5px] leading-snug text-bad-200/80">{e.approval_note || "No reason given."}</span>
        </span>
      )}
    </>
  );
}

function RowActions({
  entry: e,
  pending,
  touch = false,
  onReceipts,
  onEdit,
  onDelete,
}: {
  entry: LedgerEntry;
  pending: boolean;
  /** Card layout: always visible, 36px targets. */
  touch?: boolean;
  onReceipts: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const receipts = e.finance_attachments?.length ?? 0;
  const btn = touch
    ? "flex h-9 w-9 items-center justify-center text-sand transition-colors"
    : "flex h-7 w-7 items-center justify-center text-sand transition-colors pointer-coarse:h-9 pointer-coarse:w-9";
  // Mouse users get the quiet hover reveal; touch screens always see the buttons.
  const reveal = touch
    ? ""
    : "pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:focus-within:opacity-100";

  return (
    <div className="flex items-center justify-end gap-1">
      {receipts > 0 && (
        <button
          type="button"
          onClick={onReceipts}
          aria-label={`${receipts} receipt${receipts === 1 ? "" : "s"}`}
          title="View receipts"
          className={`${btn} gap-0.5 hover:text-cream ${touch ? "w-auto px-2" : "w-auto px-1"}`}
        >
          <Icon.paperclip size={14} />
          <span className="font-mono text-[10px] tabular-nums">{receipts}</span>
        </button>
      )}
      {isLinked(e) ? (
        <span className={`${btn} text-sand/60`} title="Managed from Invoices" aria-label="Managed from Invoices">
          <Icon.lock size={13} />
        </span>
      ) : (
        <div className={`flex items-center gap-1 ${reveal}`}>
          <button type="button" onClick={onEdit} aria-label="Edit entry" className={`${btn} hover:text-cream`}>
            <Icon.edit size={14} />
          </button>
          <button type="button" disabled={pending} onClick={onDelete} aria-label="Delete entry" className={`${btn} hover:text-bad-300`}>
            <Icon.trash size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function ReceiptList({
  receipts,
  pending,
  onOpen,
  onRemove,
}: {
  receipts: Receipt[];
  pending: boolean;
  onOpen: (index: number) => void;
  onRemove: (receipt: Receipt) => void;
}) {
  if (receipts.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {receipts.map((r, i) => (
        <li key={r.id} className="flex items-center gap-2 border border-cream/[0.08] bg-ink/50 px-3 py-1 text-[12px] text-cream-2">
          <Icon.paperclip size={12} />
          <button
            type="button"
            onClick={() => onOpen(i)}
            className="min-h-8 min-w-0 flex-1 truncate text-left hover:text-cream pointer-coarse:min-h-9"
          >
            {r.file_name ?? "Receipt"}
          </button>
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-sand">{formatBytes(r.size_bytes)}</span>
          <button
            type="button"
            disabled={pending}
            aria-label={`Remove ${r.file_name ?? "receipt"}`}
            onClick={() => {
              if (confirm(`Remove ${r.file_name ?? "this receipt"}? The file is deleted for good.`)) onRemove(r);
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center text-sand transition-colors hover:text-bad-200 pointer-coarse:h-9 pointer-coarse:w-9"
          >
            <Icon.trash size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-sand">{label}</dt>
      <dd className="mt-1 truncate text-cream">{value}</dd>
    </div>
  );
}
