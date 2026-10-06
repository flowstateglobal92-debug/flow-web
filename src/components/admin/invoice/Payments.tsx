"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import Modal from "@/components/admin/Modal";
import { Button, Field, Input } from "@/components/admin/ui";
import { formatDate, num } from "@/lib/admin/format";
import { round2 } from "@/lib/admin/invoice-math";
import {
  PAYMENT_METHODS,
  docLabel,
  docMoney,
  paymentState,
  billedTo,
  type Invoice,
  type InvoicePayment,
  type PaymentState,
} from "@/lib/admin/invoice-types";
import { clearPayments, recordPayment } from "@/app/admin/actions/invoices";

/**
 * Unpaid · Part paid · Paid, and what each move does:
 *   unpaid/part → part   add a payment
 *   any → paid           add a payment for what's left
 *   paid → part          remove specific payments (the invoice's Payments tab —
 *                        `onShowPayments` when that page is already open)
 *   part/paid → unpaid   remove every payment, after listing the income entries that go
 */

export type PayableInvoice = Pick<
  Invoice,
  "id" | "kind" | "number" | "status" | "currency" | "total" | "amount_paid" | "bill_to_name" | "bill_to_company"
>;
export type PaymentLine = Pick<InvoicePayment, "id" | "amount" | "amount_base" | "paid_on" | "method">;

type Run = (
  fn: () => Promise<{ ok: boolean; error?: string; message?: string; id?: string }>,
  opts?: { onDone?: (r: { ok: boolean }) => void },
) => void;

const STATES: { value: PaymentState; label: string; on: string }[] = [
  { value: "unpaid", label: "Unpaid", on: "bg-cream/[0.10] text-cream" },
  { value: "part", label: "Part paid", on: "bg-terra/20 text-terra-bright" },
  { value: "paid", label: "Paid", on: "bg-emerald-400/15 text-emerald-200" },
];

export function PaymentSwitch({
  state,
  onPick,
  disabled,
  full = false,
}: {
  state: PaymentState;
  onPick: (next: PaymentState) => void;
  disabled?: boolean;
  /** Stretch to the row (mobile cards). */
  full?: boolean;
}) {
  return (
    <div role="group" aria-label="Payment status" className={`${full ? "flex w-full" : "inline-flex"} border border-cream/12 bg-ink/40`}>
      {STATES.map((s, i) => {
        const active = s.value === state;
        return (
          <button
            key={s.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onPick(s.value)}
            className={`min-h-9 flex-1 whitespace-nowrap px-2.5 text-[11.5px] font-medium transition-colors duration-300 disabled:opacity-50 ${i ? "border-l border-cream/10" : ""} ${active ? s.on : "text-sand hover:bg-cream/[0.05] hover:text-cream"}`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Owns the dialogs; rows call `pick(invoice, payments, next)`. Returned like
 * useAction's toast: render `node` once near the list.
 */
export function usePaymentFlow({
  run,
  pending,
  today,
  onShowPayments,
}: {
  run: Run;
  pending: boolean;
  today: string;
  /** On the invoice's own page: show its Payments tab instead of navigating to the same route. */
  onShowPayments?: () => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    | { kind: "pay"; invoice: PayableInvoice; full: boolean }
    | { kind: "unpaid"; invoice: PayableInvoice; payments: PaymentLine[] }
    | null
  >(null);
  const close = useCallback(() => setDialog(null), []);

  const pick = useCallback(
    (invoice: PayableInvoice, payments: PaymentLine[], next: PaymentState) => {
      const current = paymentState(invoice);
      if (next === "paid") {
        if (current !== "paid") setDialog({ kind: "pay", invoice, full: true });
        return;
      }
      if (next === "part") {
        // Paid → part means taking a payment back: that's done one payment at a time.
        if (current !== "paid") setDialog({ kind: "pay", invoice, full: false });
        else if (onShowPayments) onShowPayments();
        else router.push(`/admin/invoices/${invoice.id}?tab=payments`);
        return;
      }
      if (current !== "unpaid") setDialog({ kind: "unpaid", invoice, payments });
    },
    [router, onShowPayments],
  );

  let node: ReactNode = null;
  if (dialog?.kind === "pay") {
    node = (
      <PaymentDialog
        key={`${dialog.invoice.id}:${dialog.full}`}
        invoice={dialog.invoice}
        full={dialog.full}
        today={today}
        pending={pending}
        onClose={close}
        onSubmit={(fd) => run(() => recordPayment(dialog.invoice.id, fd), { onDone: (r) => r.ok && close() })}
      />
    );
  } else if (dialog?.kind === "unpaid") {
    const { invoice, payments } = dialog;
    const n = payments.length;
    node = (
      <Modal
        open
        onClose={close}
        title={`Mark ${docLabel(invoice)} unpaid?`}
        hint={`${n} payment${n === 1 ? "" : "s"} will be removed — and with ${n === 1 ? "it" : "them"} these income entries leave Expenses.`}
      >
        <ul className="border border-cream/[0.08]">
          {payments.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-3 border-b border-cream/[0.06] px-3 py-2.5 last:border-0">
              <span className="min-w-0">
                <span className="block text-[12.5px] text-cream">{formatDate(p.paid_on)}</span>
                <span className="block truncate text-[11px] text-sand">{p.method || "Payment"}</span>
              </span>
              <span className="shrink-0 text-right font-mono text-[12px] tabular-nums text-emerald-300">
                +{docMoney(num(p.amount_base), "LKR")}
                {invoice.currency.toUpperCase() !== "LKR" && (
                  <span className="block text-[10.5px] text-sand">{docMoney(num(p.amount), invoice.currency)}</span>
                )}
              </span>
            </li>
          ))}
          {n === 0 && <li className="px-3 py-3 text-[12px] text-sand">No payments are recorded on this invoice.</li>}
        </ul>
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
          <Button type="button" onClick={close}>
            Keep them
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={pending || n === 0}
            onClick={() => run(() => clearPayments(invoice.id), { onDone: (r) => r.ok && close() })}
          >
            Remove {n} payment{n === 1 ? "" : "s"}
          </Button>
        </div>
      </Modal>
    );
  }

  return { pick, node };
}

/** "Record a payment" — header figures, the amount received now and the live "after this" line. */
export function PaymentDialog({
  invoice,
  full,
  today,
  pending,
  onClose,
  onSubmit,
}: {
  invoice: PayableInvoice;
  full: boolean;
  today: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  const total = num(invoice.total);
  const paid = num(invoice.amount_paid);
  const left = round2(total - paid);
  const [value, setValue] = useState(full ? left.toFixed(2) : "");
  const entered = round2(num(value));
  const foreign = invoice.currency.toUpperCase() !== "LKR";
  const money = (v: number) => docMoney(v, invoice.currency);

  let after: { text: string; tone: string };
  if (!(entered > 0)) after = { text: "Enter what arrived — the balance updates as you type.", tone: "text-sand" };
  else if (entered > left) after = { text: `That's more than the ${money(left)} left to pay.`, tone: "text-rose-300" };
  else if (round2(left - entered) === 0) after = { text: `After this: paid ${money(total)} · fully paid`, tone: "text-emerald-300" };
  else after = { text: `After this: paid ${money(round2(paid + entered))} · left ${money(round2(left - entered))}`, tone: "text-cream-2" };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={full ? `Mark ${docLabel(invoice)} paid` : `Record a payment · ${docLabel(invoice)}`}
      hint={`${billedTo(invoice)} · it posts to Income in Expenses.`}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 border border-cream/[0.08] bg-cream/[0.02]">
          {[
            { label: "Total", value: money(total), tone: "text-cream" },
            { label: "Paid so far", value: money(paid), tone: "text-emerald-300" },
            { label: "Left to pay", value: money(left), tone: "text-terra-bright" },
          ].map((f, i) => (
            <div key={f.label} className={`min-w-0 px-3 py-2.5 ${i ? "border-l border-cream/[0.08]" : ""}`}>
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-sand">{f.label}</p>
              <p className={`mt-1 truncate font-mono text-[12.5px] tabular-nums ${f.tone}`}>{f.value}</p>
            </div>
          ))}
        </div>

        <Field label={`Amount received now (${invoice.currency.toUpperCase()})`}>
          <Input
            name="amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            max={left}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={left.toFixed(2)}
          />
        </Field>
        <p className={`-mt-2 font-mono text-[11.5px] tabular-nums ${after.tone}`} aria-live="polite">
          {after.text}
        </p>

        {foreign && (
          <Field label="Received in LKR" hint="What landed in the bank, in rupees. Income is kept in LKR.">
            <Input name="amount_base" type="number" inputMode="decimal" min="0.01" step="0.01" required placeholder="0.00" />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date received">
            <Input name="paid_on" type="date" required defaultValue={today} max={today} />
          </Field>
          <Field label="Method">
            <Input name="method" list="invoice-payment-methods" defaultValue="Bank transfer" placeholder="Bank transfer" />
            <datalist id="invoice-payment-methods">
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Reference" hint="Bank reference, cheque number — optional.">
          <Input name="reference" placeholder="e.g. TRX-882140" />
        </Field>
        <Field label="Note">
          <Input name="note" placeholder="Optional" />
        </Field>

        <div className="flex items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending || !(entered > 0) || entered > left}>
            {full ? "Mark paid" : "Record payment"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
