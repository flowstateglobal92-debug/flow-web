"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { useAction } from "@/components/admin/useAction";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, Select, Stat, Textarea } from "@/components/admin/ui";
import { addDays, formatDate, formatDateShort, moneyShort, num } from "@/lib/admin/format";
import { BILL_STATUS, billStatus, taxAmount, type Bill, type BillSchedule, type BillTaxLine, type Supplier } from "@/lib/admin/bills";
import { CURRENCIES, FREQUENCIES, cadenceLabel, docMoney, type TaxRate } from "@/lib/admin/invoice-types";
import { EXPENSE_CATEGORIES } from "@/lib/admin/types";
import {
  deleteBill,
  deleteBillPayment,
  deleteBillSchedule,
  openBill,
  recordBillPayment,
  saveBill,
  saveBillSchedule,
  saveSupplier,
  voidBill,
  type BillInput,
  type BillScheduleInput,
} from "@/app/admin/actions/bills";

type Filter = "open" | "overdue" | "paid" | "draft" | "all";
type Run = ReturnType<typeof useAction>["run"];

const blankBill = (today: string): BillInput => ({
  supplier_id: "",
  reference: "",
  bill_date: today,
  due_date: addDays(today, 14),
  currency: "LKR",
  exchange_rate: "",
  description: "",
  category: "",
  subtotal: "",
  taxes: [],
  notes: "",
});

export default function BillsScreen({
  ready,
  bills,
  suppliers,
  schedules,
  taxRates,
  today,
}: {
  ready: boolean;
  bills: Bill[];
  suppliers: Supplier[];
  schedules: BillSchedule[];
  taxRates: TaxRate[];
  today: string;
}) {
  const { run, pending, toast } = useAction();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ bill: Bill | null; value: BillInput } | null>(null);
  const [scheduling, setScheduling] = useState<{ schedule: BillSchedule | null } | null>(null);

  const open = bills.filter((b) => b.status === "open" || b.status === "partially_paid");
  const overdue = open.filter((b) => billStatus(b, today) === "overdue");
  const soon = open.filter((b) => b.due_date && b.due_date >= today && b.due_date <= addDays(today, 7));
  const monthStart = today.slice(0, 8) + "01";
  const paidThisMonth = bills
    .flatMap((b) => b.bill_payments ?? [])
    .filter((p) => p.paid_on >= monthStart)
    .reduce((a, p) => a + num(p.amount_base ?? p.amount), 0);
  const lkr = (list: Bill[]) =>
    list.reduce((a, b) => a + (b.currency === "LKR" ? num(b.balance_due) : b.exchange_rate ? num(b.balance_due) * num(b.exchange_rate) : 0), 0);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return bills
      .filter((b) => {
        const st = billStatus(b, today);
        if (filter === "open") return b.status === "open" || b.status === "partially_paid";
        if (filter === "overdue") return st === "overdue";
        if (filter === "paid") return b.status === "paid";
        if (filter === "draft") return b.status === "draft";
        return true;
      })
      .filter((b) => !term || [b.supplier?.name, b.reference, b.description, b.category].some((x) => x?.toLowerCase().includes(term)))
      .sort((a, b) =>
        filter === "open" || filter === "overdue"
          ? (a.due_date ?? a.bill_date).localeCompare(b.due_date ?? b.bill_date)
          : b.bill_date.localeCompare(a.bill_date),
      );
  }, [bills, filter, q, today]);

  const edit = (b: Bill | null) =>
    setEditing(
      b
        ? {
            bill: b,
            value: {
              supplier_id: b.supplier_id,
              reference: b.reference ?? "",
              bill_date: b.bill_date,
              due_date: b.due_date ?? "",
              currency: b.currency,
              exchange_rate: b.exchange_rate ?? "",
              description: b.description ?? "",
              category: b.category,
              subtotal: num(b.subtotal),
              taxes: (b.tax_breakdown ?? []).map((t) => ({ name: t.name, rate: t.rate ?? "", amount: num(t.amount) })),
              notes: b.notes ?? "",
            },
          }
        : { bill: null, value: blankBill(today) },
    );

  if (!ready) {
    return (
      <Notice tone="warn" title="Bills aren't set up yet">
        They arrive with the suppliers &amp; bills migration (0040).
      </Notice>
    );
  }

  return (
    <>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Owed" value={moneyShort(lkr(open))} sub={`${open.length} unpaid bill${open.length === 1 ? "" : "s"}`} tone="terra" icon={<Icon.ledger size={15} />} />
        <Stat
          label="Overdue"
          value={moneyShort(lkr(overdue))}
          sub={overdue.length ? `${overdue.length} past their due date` : "Nothing past due"}
          tone={overdue.length ? "danger" : "neutral"}
          icon={<Icon.flag size={15} />}
        />
        <Stat label="Due in 7 days" value={moneyShort(lkr(soon))} sub={`${soon.length} bill${soon.length === 1 ? "" : "s"}`} icon={<Icon.clock size={15} />} />
        <Stat label="Paid this month" value={moneyShort(paidThisMonth)} sub="Posted to the ledger" tone="success" icon={<Icon.check size={15} />} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: "Unpaid", count: open.length },
            { value: "overdue", label: "Overdue", count: overdue.length },
            { value: "paid", label: "Paid" },
            { value: "draft", label: "Drafts", count: bills.filter((b) => b.status === "draft").length },
            { value: "all", label: "All" },
          ]}
        />
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Supplier, reference…" aria-label="Search bills" className="sm:w-56" />
          <Button variant="primary" onClick={() => edit(null)} className="min-h-9" data-shortcut="new">
            <Icon.plus size={13} /> Add bill
          </Button>
        </div>
      </div>

      <Panel bodyClass="p-0">
        {shown.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={bills.length === 0 ? "No bills yet" : "Nothing here"}
              hint={bills.length === 0 ? "Add the bills you owe suppliers — paying them posts the expense to the ledger." : "Try another tab or search."}
            />
          </div>
        ) : (
          <ul>
            {shown.map((b) => {
              const st = billStatus(b, today);
              const meta = BILL_STATUS[st];
              return (
                <li key={b.id} className="border-b border-cream/[0.05] last:border-0">
                  <button type="button" onClick={() => edit(b)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-cream/[0.03]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-cream">{b.supplier?.name ?? "Supplier"}</span>
                      <span className="block truncate text-[11.5px] text-sand">
                        {[b.reference, b.description || b.category, `Billed ${formatDateShort(b.bill_date)}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className={`text-[11.5px] ${st === "overdue" ? "text-bad-300" : "text-sand"}`}>
                      {b.due_date ? `Due ${formatDate(b.due_date)}` : "No due date"}
                    </span>
                    <span className="text-right font-mono text-[12.5px] tabular-nums text-cream">
                      {docMoney(num(b.status === "paid" ? b.total : b.balance_due), b.currency)}
                      {b.status === "partially_paid" && <span className="block text-[10.5px] text-sand">of {docMoney(num(b.total), b.currency)}</span>}
                    </span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Recurring bills"
        hint="Rent, subscriptions — each period raises an unpaid bill on its own."
        className="mt-5"
        bodyClass="p-0"
        right={
          <Button onClick={() => setScheduling({ schedule: null })} className="min-h-9">
            <Icon.repeat size={13} /> Add recurring
          </Button>
        }
      >
        {schedules.length === 0 ? (
          <p className="p-4 text-[12px] text-sand">None yet.</p>
        ) : (
          <ul>
            {schedules.map((s) => (
              <li key={s.id} className="border-b border-cream/[0.05] last:border-0">
                <button type="button" onClick={() => setScheduling({ schedule: s })} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-cream/[0.03]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-cream">{s.name}</span>
                    <span className="block truncate text-[11.5px] text-sand">
                      {[s.supplier?.name, cadenceLabel(s.frequency, s.interval_count), s.active ? `next ${formatDate(s.next_run_on)}` : "paused"].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="font-mono text-[12.5px] tabular-nums text-cream">{docMoney(num(s.amount), s.currency)}</span>
                  {!s.active && <Badge tone="muted">Paused</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="mt-3 text-[11.5px] text-sand">
        Suppliers live under <Link href="/admin/expenses/suppliers" className="text-cream-2 hover:text-cream">Suppliers</Link>.
      </p>

      {editing && (
        <BillModal
          bill={editing.bill}
          value={editing.value}
          onChange={(value) => setEditing((e) => (e ? { ...e, value } : e))}
          onClose={() => setEditing(null)}
          suppliers={suppliers}
          taxRates={taxRates}
          today={today}
          run={run}
          pending={pending}
        />
      )}
      {scheduling && (
        <ScheduleModal
          schedule={scheduling.schedule}
          suppliers={suppliers}
          taxRates={taxRates}
          today={today}
          onClose={() => setScheduling(null)}
          run={run}
          pending={pending}
        />
      )}
      {toast}
    </>
  );
}

/* ─────────────────────────────── the pieces ─────────────────────────────── */

function SupplierSelect({
  value,
  onChange,
  suppliers,
  run,
  pending,
}: {
  value: string;
  onChange: (id: string, supplier?: Supplier) => void;
  suppliers: Supplier[];
  run: Run;
  pending: boolean;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  if (adding !== null) {
    return (
      <span className="flex gap-1.5">
        <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="New supplier's name" autoFocus />
        <Button
          disabled={pending || !adding.trim()}
          onClick={() =>
            run(() => saveSupplier(null, { name: adding }), {
              onDone: (r) => {
                if (r.ok && r.id) onChange(r.id);
                setAdding(null);
              },
            })
          }
          className="min-h-9 shrink-0"
        >
          Add
        </Button>
      </span>
    );
  }
  return (
    <Select
      value={value}
      onChange={(e) => (e.target.value === "__new" ? setAdding("") : onChange(e.target.value, suppliers.find((s) => s.id === e.target.value)))}
    >
      <option value="" className="bg-ink text-cream">
        — Pick a supplier —
      </option>
      {suppliers
        .filter((s) => s.active || s.id === value)
        .map((s) => (
          <option key={s.id} value={s.id} className="bg-ink text-cream">
            {s.name}
          </option>
        ))}
      <option value="__new" className="bg-ink text-cream">
        + New supplier…
      </option>
    </Select>
  );
}

function TaxLines({
  subtotal,
  taxes,
  onChange,
  taxRates,
}: {
  subtotal: number;
  taxes: { name: string; rate?: number | string | null; amount: number | string }[];
  onChange: (t: { name: string; rate?: number | string | null; amount: number | string }[]) => void;
  taxRates: TaxRate[];
}) {
  const addable = taxRates.filter((r) => !taxes.some((t) => t.name === r.name && Number(t.rate) === Number(r.rate)));
  return (
    <div className="space-y-1.5">
      {taxes.map((t, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input value={t.name} onChange={(e) => onChange(taxes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Tax name" className="w-28" />
          <Input
            value={String(t.rate ?? "")}
            onChange={(e) =>
              onChange(
                taxes.map((x, j) =>
                  j === i ? { ...x, rate: e.target.value, amount: e.target.value ? taxAmount(subtotal, Number(e.target.value)) : x.amount } : x,
                ),
              )
            }
            placeholder="%"
            aria-label="Rate %"
            className="w-20 font-mono"
          />
          <Input
            value={String(t.amount)}
            onChange={(e) => onChange(taxes.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
            aria-label="Tax amount"
            className="flex-1 font-mono"
          />
          <button type="button" aria-label="Remove tax" onClick={() => onChange(taxes.filter((_, j) => j !== i))} className="flex h-9 w-9 items-center justify-center text-sand hover:text-bad-300">
            <Icon.close size={12} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {addable.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onChange([...taxes, { name: r.name, rate: r.rate, amount: taxAmount(subtotal, r.rate) }])}
            className="min-h-8 border border-dashed border-cream/15 px-2 text-[11px] text-sand hover:text-cream"
          >
            + {r.name} {r.rate}%
          </button>
        ))}
        <button type="button" onClick={() => onChange([...taxes, { name: "", rate: "", amount: "" }])} className="min-h-8 border border-dashed border-cream/15 px-2 text-[11px] text-sand hover:text-cream">
          + Other tax
        </button>
      </div>
    </div>
  );
}

function BillModal({
  bill,
  value,
  onChange,
  onClose,
  suppliers,
  taxRates,
  today,
  run,
  pending,
}: {
  bill: Bill | null;
  value: BillInput;
  onChange: (v: BillInput) => void;
  onClose: () => void;
  suppliers: Supplier[];
  taxRates: TaxRate[];
  today: string;
  run: Run;
  pending: boolean;
}) {
  const set = <K extends keyof BillInput>(k: K, v: BillInput[K]) => onChange({ ...value, [k]: v });
  const subtotal = num(value.subtotal as number);
  const taxTotal = value.taxes.reduce((a, t) => a + num(t.amount as number), 0);
  const total = Math.round((subtotal + taxTotal) * 100) / 100;
  const foreign = value.currency !== "LKR";
  const locked = !!bill && num(bill.amount_paid) > 0;
  const [paying, setPaying] = useState(false);
  const [pay, setPay] = useState({ amount: "", amount_base: "", paid_on: today, method: "Bank transfer", reference: "" });
  const left = bill ? num(bill.balance_due) : 0;

  return (
    <Modal open onClose={onClose} title={bill ? `${bill.supplier?.name ?? "Bill"}${bill.reference ? ` · ${bill.reference}` : ""}` : "Add a bill"} width="max-w-2xl">
      <div className="space-y-3">
        {bill?.status === "void" && <Notice tone="danger" title="Void">This bill isn&apos;t owed.</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Supplier" hint={locked ? "Locked — a payment is recorded." : undefined}>
            {locked ? (
              <Input value={bill?.supplier?.name ?? ""} disabled readOnly />
            ) : (
              <SupplierSelect
                value={value.supplier_id}
                suppliers={suppliers}
                run={run}
                pending={pending}
                onChange={(id, s) => onChange({ ...value, supplier_id: id, category: value.category || s?.default_category || "" })}
              />
            )}
          </Field>
          <Field label="Their reference" hint="The number on the supplier's bill.">
            <Input value={value.reference ?? ""} onChange={(e) => set("reference", e.target.value)} maxLength={80} />
          </Field>
          <Field label="Bill date">
            <Input type="date" value={value.bill_date} onChange={(e) => set("bill_date", e.target.value)} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={value.due_date ?? ""} min={value.bill_date} onChange={(e) => set("due_date", e.target.value)} />
          </Field>
          <Field label="Category" hint="Payments land in the ledger under it.">
            <Input value={value.category} onChange={(e) => set("category", e.target.value)} list="bill-categories" placeholder="Office & utilities" />
            <datalist id="bill-categories">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2">
            <Field label="Currency">
              <Select value={value.currency} disabled={locked} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c} className="bg-ink text-cream">
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            {foreign && (
              <Field label="Rate (LKR)">
                <Input type="number" min="0" step="0.0001" value={String(value.exchange_rate ?? "")} onChange={(e) => set("exchange_rate", e.target.value)} className="font-mono" />
              </Field>
            )}
          </div>
        </div>
        <Field label="What it's for">
          <Input value={value.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="October rent" maxLength={500} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Field label={`Amount before tax (${value.currency})`}>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={String(value.subtotal)}
              onChange={(e) => {
                const sub = num(e.target.value);
                onChange({
                  ...value,
                  subtotal: e.target.value,
                  taxes: value.taxes.map((t) => (t.rate !== "" && t.rate != null ? { ...t, amount: taxAmount(sub, Number(t.rate)) } : t)),
                });
              }}
              className="font-mono"
            />
          </Field>
          <div>
            <span className="mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-sand">Tax on it (input tax)</span>
            <TaxLines subtotal={subtotal} taxes={value.taxes} onChange={(taxes) => set("taxes", taxes)} taxRates={taxRates} />
          </div>
        </div>
        <p className="flex items-baseline justify-between border-t border-cream/[0.08] pt-2 text-[13px]">
          <span className="text-sand">Total</span>
          <span className="font-mono tabular-nums text-terra-bright">{docMoney(total, value.currency)}</span>
        </p>
        <Field label="Notes">
          <Textarea rows={2} value={value.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        {bill && (bill.bill_payments?.length ?? 0) > 0 && (
          <div className="border-t border-cream/[0.08] pt-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Payments</p>
            <ul className="mt-1.5">
              {bill.bill_payments!.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                  <span className="text-cream-2">
                    {formatDate(p.paid_on)} <span className="text-sand">· {p.method ?? "Payment"}{p.reference ? ` · ${p.reference}` : ""}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="font-mono tabular-nums text-bad-300">−{docMoney(num(p.amount), bill.currency)}</span>
                    <button
                      type="button"
                      aria-label="Remove payment"
                      disabled={pending}
                      onClick={() => confirm("Remove this payment? Its expense leaves the ledger too.") && run(() => deleteBillPayment(p.id))}
                      className="flex h-8 w-8 items-center justify-center text-sand hover:text-bad-300"
                    >
                      <Icon.trash size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {bill && paying && (
          <div className="space-y-2.5 border border-cream/[0.08] p-3">
            <p className="text-[12.5px] text-cream">Record a payment · {docMoney(left, bill.currency)} left</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label={`Amount (${bill.currency})`}>
                <Input type="number" min="0.01" step="0.01" value={pay.amount} placeholder={left.toFixed(2)} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className="font-mono" />
              </Field>
              {bill.currency !== "LKR" && (
                <Field label="In LKR" hint={bill.exchange_rate ? "Empty = at the bill's rate." : undefined}>
                  <Input type="number" min="0.01" step="0.01" value={pay.amount_base} onChange={(e) => setPay({ ...pay, amount_base: e.target.value })} className="font-mono" />
                </Field>
              )}
              <Field label="Paid on">
                <Input type="date" value={pay.paid_on} max={today} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} />
              </Field>
              <Field label="Method">
                <Input value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} />
              </Field>
              <Field label="Reference">
                <Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setPaying(false)} className="min-h-9">
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  run(() => recordBillPayment(bill.id, { ...pay, amount: pay.amount || left }), {
                    onDone: (r) => {
                      if (r.ok) {
                        setPaying(false);
                        onClose();
                      }
                    },
                  })
                }
                className="min-h-9"
              >
                Record payment
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-cream/[0.08] pt-3">
        <span className="flex flex-wrap gap-1.5">
          {bill && num(bill.amount_paid) === 0 && (
            <Button variant="quiet" disabled={pending} onClick={() => confirm("Delete this bill?") && run(() => deleteBill(bill.id), { onDone: (r) => r.ok && onClose() })} className="min-h-9">
              <Icon.trash size={13} /> Delete
            </Button>
          )}
          {bill && num(bill.amount_paid) === 0 && bill.status !== "void" && bill.status !== "draft" && (
            <Button variant="quiet" disabled={pending} onClick={() => confirm("Void this bill? It won't be owed.") && run(() => voidBill(bill.id), { onDone: (r) => r.ok && onClose() })} className="min-h-9">
              Void
            </Button>
          )}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {bill?.status === "draft" && (
            <Button disabled={pending} onClick={() => run(() => openBill(bill.id), { onDone: (r) => r.ok && onClose() })} className="min-h-9">
              Mark as owed
            </Button>
          )}
          {bill && (bill.status === "open" || bill.status === "partially_paid") && !paying && (
            <Button onClick={() => setPaying(true)} className="min-h-9">
              Record payment
            </Button>
          )}
          {bill?.status !== "void" && (
            <Button
              variant="primary"
              disabled={pending || !value.supplier_id}
              onClick={() => run(() => saveBill(bill?.id ?? null, value), { onDone: (r) => r.ok && onClose() })}
              className="min-h-9"
            >
              {bill ? "Save" : "Add bill"}
            </Button>
          )}
        </span>
      </div>
    </Modal>
  );
}

function ScheduleModal({
  schedule,
  suppliers,
  taxRates,
  today,
  onClose,
  run,
  pending,
}: {
  schedule: BillSchedule | null;
  suppliers: Supplier[];
  taxRates: TaxRate[];
  today: string;
  onClose: () => void;
  run: Run;
  pending: boolean;
}) {
  const [v, setV] = useState<BillScheduleInput>(() =>
    schedule
      ? {
          supplier_id: schedule.supplier_id,
          name: schedule.name,
          description: schedule.description ?? "",
          category: schedule.category,
          amount: num(schedule.amount),
          taxes: (schedule.tax_breakdown ?? []).map((t: BillTaxLine) => ({ name: t.name, rate: t.rate ?? "", amount: num(t.amount) })),
          currency: schedule.currency,
          frequency: schedule.frequency,
          interval_count: schedule.interval_count,
          next_run_on: schedule.next_run_on,
          due_days: schedule.due_days,
          ends_on: schedule.ends_on ?? "",
          active: schedule.active,
        }
      : {
          supplier_id: "",
          name: "",
          description: "",
          category: "",
          amount: "",
          taxes: [],
          currency: "LKR",
          frequency: "monthly",
          interval_count: 1,
          next_run_on: today,
          due_days: 7,
          ends_on: "",
          active: true,
        },
  );
  const set = <K extends keyof BillScheduleInput>(k: K, val: BillScheduleInput[K]) => setV((x) => ({ ...x, [k]: val }));
  return (
    <Modal open onClose={onClose} title={schedule ? schedule.name : "Add a recurring bill"} hint="Each period raises an unpaid bill on its own." width="max-w-xl">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Office rent" />
          </Field>
          <Field label="Supplier">
            <SupplierSelect value={v.supplier_id} suppliers={suppliers} run={run} pending={pending} onChange={(id, s) => setV((x) => ({ ...x, supplier_id: id, category: x.category || s?.default_category || "" }))} />
          </Field>
          <Field label="Category">
            <Input value={v.category} onChange={(e) => set("category", e.target.value)} list="bill-categories-s" placeholder="Office & utilities" />
            <datalist id="bill-categories-s">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label={`Amount before tax (${v.currency})`}>
            <Input type="number" min="0" step="0.01" value={String(v.amount)} onChange={(e) => set("amount", e.target.value)} className="font-mono" />
          </Field>
          <Field label="Repeats">
            <Select value={v.frequency} onChange={(e) => set("frequency", e.target.value as BillScheduleInput["frequency"])}>
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value} className="bg-ink text-cream">
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next bill on">
            <Input type="date" value={v.next_run_on} onChange={(e) => set("next_run_on", e.target.value)} />
          </Field>
          <Field label="Due (days after)">
            <Input type="number" min="0" max="120" value={String(v.due_days)} onChange={(e) => set("due_days", e.target.value)} />
          </Field>
          <Field label="Ends on" hint="Optional.">
            <Input type="date" value={v.ends_on ?? ""} onChange={(e) => set("ends_on", e.target.value)} />
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-sand">Tax on it</span>
          <TaxLines subtotal={num(v.amount as number)} taxes={v.taxes} onChange={(taxes) => set("taxes", taxes)} taxRates={taxRates} />
        </div>
        <label className="flex min-h-9 items-center gap-2 text-[12.5px] text-cream-2">
          <input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 accent-terra" /> Active
        </label>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-cream/[0.08] pt-3">
        {schedule ? (
          <Button variant="quiet" disabled={pending} onClick={() => confirm("Remove this recurring bill? Bills it raised stay.") && run(() => deleteBillSchedule(schedule.id), { onDone: (r) => r.ok && onClose() })} className="min-h-9">
            <Icon.trash size={13} /> Remove
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" disabled={pending} onClick={() => run(() => saveBillSchedule(schedule?.id ?? null, v), { onDone: (r) => r.ok && onClose() })} className="min-h-9">
          Save
        </Button>
      </div>
    </Modal>
  );
}

