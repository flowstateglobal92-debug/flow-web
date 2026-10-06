"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import CommentThread from "@/components/admin/comments/CommentThread";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { useAction } from "@/components/admin/useAction";
import { Avatar, Button, EmptyState, Panel, Stat } from "@/components/admin/ui";
import InvoiceDocument from "@/components/admin/invoice/InvoiceDocument";
import { PaymentDialog, PaymentSwitch, usePaymentFlow } from "@/components/admin/invoice/Payments";
import QuoteActions from "@/components/admin/invoice/QuoteActions";
import ScaledSheet from "@/components/admin/invoice/ScaledSheet";
import { StatusBadge, linkButton } from "@/components/admin/invoice/parts";
import { formatDate, formatDateTime, num } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import type { ActivityEntry, TeamMember } from "@/lib/admin/types";
import {
  billedTo,
  displayStatus,
  docLabel,
  docMoney,
  documentFromRow,
  hasPaymentSwitch,
  paymentState,
  type Business,
  type Invoice,
  type InvoiceItem,
  type InvoicePayment,
} from "@/lib/admin/invoice-types";
import {
  deleteDocument,
  deletePayment,
  duplicateDocument,
  issueDocument,
  recordPayment,
  voidInvoice,
} from "@/app/admin/actions/invoices";

export type DetailTab = "preview" | "payments" | "comments" | "activity";

type Ref = { id: string; label: string } | null;
export type RelatedLinks = { sourceQuote: Ref; converted: Ref; schedule: Ref; client: Ref; lead: Ref };

export default function InvoiceDetail({
  invoice,
  items,
  payments,
  business,
  people,
  names,
  activity,
  related,
  initialTab,
  today,
  canCrm,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  payments: InvoicePayment[];
  business: Business;
  people: TeamMember[];
  names: Record<string, string>;
  activity: ActivityEntry[];
  related: RelatedLinks;
  initialTab: DetailTab;
  today: string;
  canCrm: boolean;
}) {
  const router = useRouter();
  const { run, pending, toast } = useAction();
  const [tab, setTab] = useState<DetailTab>(initialTab);
  // A ?tab= link to this same page (a notification, say) keeps this component
  // mounted — follow the new value when it changes.
  const [seenTab, setSeenTab] = useState(initialTab);
  if (seenTab !== initialTab) {
    setSeenTab(initialTab);
    setTab(initialTab);
  }
  // Paid → part is done on the Payments tab; here that's a tab switch, not a navigation.
  const showPayments = useCallback(() => setTab("payments"), []);
  const flow = usePaymentFlow({ run, pending, today, onShowPayments: showPayments });
  const [paying, setPaying] = useState(false);

  const quote = invoice.kind === "quote";
  const status = displayStatus(invoice, today);
  const total = num(invoice.total);
  const paid = num(invoice.amount_paid);
  const left = invoice.status === "void" ? 0 : Math.max(0, total - paid);
  const money = (v: number) => docMoney(v, invoice.currency);
  const canPay = !quote && (invoice.status === "issued" || invoice.status === "partially_paid");
  const editable = !["void", "pending_approval", "converted"].includes(invoice.status);
  const back = quote ? "/admin/invoices/quotes" : "/admin/invoices";

  const duplicate = () =>
    run(() => duplicateDocument(invoice.id), {
      onDone: (r) => {
        if (r.ok && r.id) router.push(`/admin/invoices/${r.id}/edit`);
      },
    });

  const remove = () => {
    if (!confirm(`Delete this draft ${quote ? "quote" : "invoice"}? This can't be undone.`)) return;
    run(() => deleteDocument(invoice.id), {
      onDone: (r) => {
        if (r.ok) router.push(back);
      },
    });
  };

  const tabs: { value: DetailTab; label: string; count?: number }[] = [
    { value: "preview", label: "Preview" },
    ...(quote ? [] : [{ value: "payments" as const, label: "Payments", count: payments.length }]),
    { value: "comments", label: "Comments" },
    { value: "activity", label: "Activity" },
  ];

  return (
    <>
      {/* Header — screen only: ⌘P prints just the paper (the Print / PDF page is the proper copy) */}
      <div className="no-print mb-4">
        <Link href={back} className="inline-flex min-h-9 items-center gap-1.5 text-[12px] text-sand transition-colors hover:text-cream">
          <Icon.chevronLeft size={14} /> {quote ? "Quotes" : "Issued invoices"}
        </Link>
      </div>
      <div className="no-print mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-terra-bright">
              {quote ? "Quote" : "Invoice"} · {invoice.number ?? "Draft"}
            </span>
            <StatusBadge doc={invoice} today={today} />
          </p>
          <h2 className="mt-1.5 truncate font-display text-[22px] font-medium leading-tight text-cream">{billedTo(invoice)}</h2>
          <p className="mt-1 text-[12px] text-sand">
            {[
              invoice.subject,
              `Issued ${formatDate(invoice.issue_date)}`,
              quote
                ? invoice.valid_until && `Valid until ${formatDate(invoice.valid_until)}`
                : invoice.due_date && `Due ${formatDate(invoice.due_date)}`,
              invoice.owner_id && names[invoice.owner_id] && `Owner ${names[invoice.owner_id]}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <RelatedLine related={related} />
        </div>

        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
          {invoice.status === "draft" && !quote && (
            <Button variant="primary" disabled={pending} onClick={() => run(() => issueDocument(invoice.id))} className="min-h-9">
              <Icon.send size={13} /> Issue
            </Button>
          )}
          {quote && <QuoteActions quote={invoice} run={run} pending={pending} today={today} canCrm={canCrm} />}
          {hasPaymentSwitch(invoice) && (
            <PaymentSwitch state={paymentState(invoice)} disabled={pending} onPick={(next) => flow.pick(invoice, payments, next)} />
          )}
          <a
            href={`${hrefFor("invoice_print", invoice.id)}?print=1`}
            target="_blank"
            rel="noopener"
            className={`${linkButton.ghost} min-h-9`}
          >
            <Icon.printer size={13} /> Print / PDF
          </a>
          {editable && (
            <Link href={`/admin/invoices/${invoice.id}/edit`} className={`${linkButton.ghost} min-h-9`}>
              <Icon.edit size={13} /> Edit
            </Link>
          )}
          <Button variant="quiet" disabled={pending} onClick={duplicate} className="min-h-9">
            <Icon.copy size={13} /> Duplicate
          </Button>
          {!quote && paid === 0 && ["issued", "partially_paid", "paid"].includes(invoice.status) && (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                if (confirm(`Void ${docLabel(invoice)}? It stays on record with its number, marked void.`)) run(() => voidInvoice(invoice.id));
              }}
              className="min-h-9"
            >
              <Icon.archive size={13} /> Void
            </Button>
          )}
          {invoice.status === "draft" && (
            <Button variant="danger" disabled={pending} onClick={remove} className="min-h-9">
              <Icon.trash size={13} /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Figures */}
      <div className="no-print mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Total" value={money(total)} sub={`${items.length} line${items.length === 1 ? "" : "s"} · ${invoice.currency}`} />
        {quote ? (
          <>
            <Stat
              label="Valid until"
              value={invoice.valid_until ? formatDate(invoice.valid_until) : "—"}
              sub={status === "expired" ? "Past its validity date" : "Quote validity"}
              tone={status === "expired" ? "danger" : "neutral"}
            />
            <Stat
              label="Answer"
              value={status === "accepted" ? "Accepted" : status === "declined" ? "Declined" : status === "converted" ? "Invoiced" : "Waiting"}
              sub={
                invoice.accepted_at
                  ? `Accepted ${formatDate(invoice.accepted_at)}`
                  : invoice.declined_at
                    ? `Declined ${formatDate(invoice.declined_at)}`
                    : invoice.status === "draft"
                      ? "Not sent yet"
                      : "Sent to the client"
              }
              tone={status === "accepted" || status === "converted" ? "success" : status === "declined" ? "danger" : "neutral"}
            />
          </>
        ) : (
          <>
            <Stat
              label="Paid so far"
              value={money(paid)}
              sub={payments.length ? `${payments.length} payment${payments.length === 1 ? "" : "s"} · in Income` : "Nothing received yet"}
              tone="success"
            />
            <Stat
              label="Left to pay"
              value={money(left)}
              sub={
                invoice.status === "paid"
                  ? `Paid${invoice.paid_at ? ` ${formatDate(invoice.paid_at)}` : ""}`
                  : status === "overdue"
                    ? `Overdue since ${formatDate(invoice.due_date!)}`
                    : invoice.due_date
                      ? `Due ${formatDate(invoice.due_date)}`
                      : "Due on receipt"
              }
              tone={status === "overdue" ? "danger" : left > 0 ? "terra" : "neutral"}
            />
          </>
        )}
      </div>

      <Tabs className="no-print mb-4" value={tab} onChange={setTab} options={tabs} />

      {tab === "preview" && (
        <div className="border border-cream/[0.08] bg-ink-2/60 p-3 sm:p-6 print:border-0 print:bg-transparent print:p-0">
          <div className="mx-auto max-w-[820px] print:max-w-none">
            <ScaledSheet>
              <InvoiceDocument
                doc={documentFromRow(invoice, items)}
                business={business}
                today={today}
                className="shadow-[0_40px_100px_-40px_rgba(0,0,0,0.95)]"
              />
            </ScaledSheet>
          </div>
        </div>
      )}

      {tab === "payments" && !quote && (
        <Panel
          title="Payments"
          hint="Each payment is an income entry in Expenses, in LKR. Remove one to take it back."
          right={
            canPay ? (
              <Button variant="primary" onClick={() => setPaying(true)} className="min-h-9">
                <Icon.plus size={13} /> Record payment
              </Button>
            ) : undefined
          }
          bodyClass="p-0"
        >
          {payments.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No payments yet"
                hint={
                  canPay
                    ? "Record what arrives — part payments are fine. The balance and Income update together."
                    : invoice.status === "draft"
                      ? "Issue the invoice first; payments are recorded against issued invoices."
                      : "Nothing to record on this invoice."
                }
              />
            </div>
          ) : (
            <ul>
              {payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 border-b border-cream/[0.06] px-4 py-3 last:border-0">
                  <div className="min-w-0">
                    <p className="text-[13px] text-cream">
                      {formatDate(p.paid_on)}
                      <span className="text-sand"> · {p.method || "Payment"}</span>
                    </p>
                    <p className="mt-0.5 truncate text-[11.5px] text-sand">
                      {[p.reference && `Ref ${p.reference}`, p.note, p.created_by && names[p.created_by] && `Recorded by ${names[p.created_by]}`]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    <p className="text-right font-mono text-[12.5px] text-emerald-300 tabular-nums">
                      +{money(num(p.amount))}
                      {invoice.currency.toUpperCase() !== "LKR" && (
                        <span className="block text-[10.5px] text-sand">{docMoney(num(p.amount_base), "LKR")} in Income</span>
                      )}
                    </p>
                    <button
                      type="button"
                      disabled={pending}
                      aria-label="Remove payment"
                      onClick={() => {
                        if (confirm(`Remove this ${money(num(p.amount))} payment? Its income entry leaves Expenses too.`)) {
                          run(() => deletePayment(p.id));
                        }
                      }}
                      className="flex h-9 w-9 items-center justify-center text-sand transition-colors hover:text-rose-300 disabled:opacity-40"
                    >
                      <Icon.trash size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === "comments" && (
        <Panel title="Discussion" hint="Type @ to mention someone with access to Invoices.">
          <CommentThread target={{ type: "invoice", id: invoice.id }} people={people} />
        </Panel>
      )}

      {tab === "activity" && (
        <Panel title="Activity" bodyClass="p-0">
          <Trail invoice={invoice} payments={payments} activity={activity} names={names} />
        </Panel>
      )}

      {paying && (
        <PaymentDialog
          invoice={invoice}
          full={false}
          today={today}
          pending={pending}
          onClose={() => setPaying(false)}
          onSubmit={(fd) =>
            run(() => recordPayment(invoice.id, fd), {
              onDone: (r) => r.ok && setPaying(false),
            })
          }
        />
      )}
      {flow.node}
      {toast}
    </>
  );
}

function RelatedLine({ related }: { related: RelatedLinks }) {
  const parts: { href: string | null; label: string }[] = [];
  if (related.client) parts.push({ href: hrefFor("client", related.client.id), label: `Client · ${related.client.label}` });
  if (related.lead) parts.push({ href: hrefFor("lead", related.lead.id), label: `Lead · ${related.lead.label}` });
  if (related.sourceQuote) parts.push({ href: hrefFor("quote", related.sourceQuote.id), label: `From ${related.sourceQuote.label}` });
  if (related.converted) parts.push({ href: hrefFor("invoice", related.converted.id), label: `Invoiced as ${related.converted.label}` });
  if (related.schedule) parts.push({ href: hrefFor("schedule", related.schedule.id), label: `Recurring · ${related.schedule.label}` });
  if (parts.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
      {parts.map((p) =>
        p.href ? (
          <Link
            key={p.label}
            href={p.href}
            className="inline-flex min-h-7 items-center gap-1 text-cream-2 transition-colors hover:text-terra-bright pointer-coarse:min-h-9"
          >
            <Icon.link size={12} /> {p.label}
          </Link>
        ) : (
          <span key={p.label} className="text-sand">
            {p.label}
          </span>
        ),
      )}
    </p>
  );
}

/**
 * The audit trail when the viewer can read it (Team access); otherwise the
 * milestones the invoice itself records — created, issued, each payment, paid.
 */
function Trail({
  invoice,
  payments,
  activity,
  names,
}: {
  invoice: Invoice;
  payments: InvoicePayment[];
  activity: ActivityEntry[];
  names: Record<string, string>;
}) {
  const who = (id: string | null | undefined) => (id ? names[id] : null) ?? null;
  const rows: { key: string; at: string; actor: string | null; text: string }[] =
    activity.length > 0
      ? activity.map((a) => ({
          key: `a${a.id}`,
          at: a.created_at,
          // No actor = the scheduler or an approval step did it.
          actor: a.actor_id ? (who(a.actor_id) ?? "Someone") : null,
          text: a.actor_id ? a.summary : `Automatically ${a.summary}`,
        }))
      : [
          { key: "created", at: invoice.created_at, actor: who(invoice.created_by), text: `created this ${invoice.kind}` },
          invoice.issued_at && {
            key: "issued",
            at: invoice.issued_at,
            actor: null,
            text: invoice.kind === "quote" ? `Sent as ${invoice.number}` : `Issued as ${invoice.number}`,
          },
          ...payments.map((p) => ({
            key: `p${p.id}`,
            at: p.created_at,
            actor: who(p.created_by),
            text: `recorded a payment of ${docMoney(num(p.amount), invoice.currency)}`,
          })),
          invoice.paid_at && { key: "paid", at: invoice.paid_at, actor: null, text: "Paid in full" },
          invoice.accepted_at && { key: "accepted", at: invoice.accepted_at, actor: null, text: "Accepted by the client" },
          invoice.declined_at && { key: "declined", at: invoice.declined_at, actor: null, text: "Declined by the client" },
          invoice.voided_at && { key: "voided", at: invoice.voided_at, actor: null, text: "Voided" },
        ]
          .filter((r): r is { key: string; at: string; actor: string | null; text: string } => !!r)
          .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <ul>
      {rows.map((r) => (
        <li key={r.key} className="flex items-start gap-3 border-b border-cream/[0.05] px-4 py-3 last:border-0">
          {r.actor ? (
            <Avatar name={r.actor} size={24} />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cream/[0.06] text-sand">
              <Icon.history size={12} />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[12.5px] text-cream-2">
              {r.actor && <span className="text-cream">{r.actor} </span>}
              {r.text}
            </p>
            <p className="mt-0.5 font-mono text-[10.5px] text-sand tabular-nums">{formatDateTime(r.at)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
