"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Modal from "@/components/admin/Modal";
import { Tabs } from "@/components/admin/Tabs";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Avatar, Badge, Button, Checkbox, EmptyState, Field, Input, Notice, Panel, Textarea } from "@/components/admin/ui";
import { formatDateTime, money } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import type { TeamMember } from "@/lib/admin/types";
import { decideApproval, saveApprovalSettings } from "@/app/admin/actions/approvals";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type ApprovalEntity = "expense" | "invoice" | "time_off";

/** A row of `approval_requests` (0016). */
export type ApprovalRequest = {
  id: string;
  entity_type: ApprovalEntity;
  entity_id: string;
  requested_by: string | null;
  amount: number | null;
  currency: string | null;
  summary: string;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  created_at: string;
};

/** The approval columns 0016 adds to `workspaces`. */
export type ApprovalSettings = {
  expense_approval_threshold: number | null;
  invoice_approval_threshold: number | null;
  leave_requires_approval: boolean | null;
};

type Access = { finance: boolean; invoices: boolean; calendar: boolean };
type View = "queue" | "mine" | "history";
type Intent = "approve" | "reject" | null;

const ENTITY_LABEL: Record<ApprovalEntity, string> = { expense: "Expense", invoice: "Invoice", time_off: "Time off" };
const ENTITY_ICON: Record<ApprovalEntity, keyof typeof Icon> = { expense: "ledger", invoice: "receipt", time_off: "plane" };

const STATUS_TONE: Record<ApprovalStatus, "warn" | "success" | "danger" | "muted"> = {
  pending: "warn",
  approved: "success",
  rejected: "danger",
  cancelled: "muted",
};

function entityHref(r: ApprovalRequest, access: Access, me: string) {
  if (r.entity_type === "expense") return access.finance ? hrefFor("entry", r.entity_id) : null;
  if (r.entity_type === "invoice") return access.invoices ? hrefFor("invoice", r.entity_id) : null;
  if (access.calendar) return hrefFor("time_off", r.entity_id);
  return r.requested_by === me ? "/admin/account#time-off" : null;
}

const amountOf = (r: ApprovalRequest) =>
  r.amount !== null && r.amount !== undefined ? money(Number(r.amount), { code: r.currency ?? "LKR" }) : null;

export default function Approvals({
  me,
  approver,
  ready,
  pending,
  decided,
  people,
  settings,
  openRequest,
  access,
}: {
  me: string;
  approver: boolean;
  /** False until 0016 has run. */
  ready: boolean;
  pending: ApprovalRequest[];
  decided: ApprovalRequest[];
  people: TeamMember[];
  settings: ApprovalSettings | null;
  openRequest: ApprovalRequest | null;
  access: Access;
}) {
  const router = useRouter();
  const { run, pending: busy, toast } = useAction();
  const [view, setView] = useState<View>(approver ? "queue" : "mine");
  const [modal, setModal] = useState<{ id: string; intent: Intent } | null>(() =>
    openRequest ? { id: openRequest.id, intent: null } : null,
  );
  const [note, setNote] = useState("");

  // Re-open on a new ?open= (a notification clicked while already here).
  const [seenOpen, setSeenOpen] = useState(openRequest?.id ?? "");
  if (seenOpen !== (openRequest?.id ?? "")) {
    setSeenOpen(openRequest?.id ?? "");
    if (openRequest) {
      setModal({ id: openRequest.id, intent: null });
      setNote("");
    }
  }

  const nameOf = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p ? p.full_name || p.email.split("@")[0] : id ? "A former teammate" : "Someone";
  };

  const queue = pending.filter((r) => r.requested_by !== me);
  const mine = [...pending, ...decided].filter((r) => r.requested_by === me).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const history = decided;
  const lists: Record<View, ApprovalRequest[]> = { queue, mine, history };

  const all = [...pending, ...decided];
  const selected = modal ? (all.find((r) => r.id === modal.id) ?? (openRequest?.id === modal.id ? openRequest : null)) : null;
  const canDecide = !!selected && approver && selected.status === "pending" && selected.requested_by !== me;

  const openModal = (r: ApprovalRequest, intent: Intent = null) => {
    setNote("");
    setModal({ id: r.id, intent });
  };

  const closeModal = () => {
    setModal(null);
    if (openRequest) router.replace("/admin/approvals", { scroll: false });
  };

  const decide = (decision: "approve" | "reject") => {
    if (!selected) return;
    const id = selected.id;
    run(() => decideApproval(id, decision, note), { onDone: (r) => r.ok && closeModal() });
  };

  const options: { value: View; label: string; count?: number }[] = [
    ...(approver ? [{ value: "queue" as View, label: "Queue", count: queue.length }] : []),
    { value: "mine", label: "My requests", count: mine.filter((r) => r.status === "pending").length },
    { value: "history", label: "History" },
  ];

  const empty: Record<View, { title: string; hint: string }> = {
    queue: { title: "Nothing waiting", hint: "Requests from members land here the moment they're made." },
    mine: {
      title: "No requests yet",
      hint: "Expenses and invoices over the limits below, and leave, are sent for approval automatically.",
    },
    history: { title: "No decisions yet", hint: "Approved and rejected requests are kept here." },
  };

  return (
    <>
      {!ready && (
        <div className="mb-4">
          <Notice tone="info" title="Approvals aren't switched on yet">
            Run the approvals migration (0016) and requests will appear here.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Tabs value={view} onChange={setView} options={options} className="mb-4" />

          {lists[view].length === 0 ? (
            <EmptyState title={empty[view].title} hint={empty[view].hint} />
          ) : (
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {lists[view].map((r) => (
                <RequestCard
                  key={r.id}
                  request={r}
                  requester={nameOf(r.requested_by)}
                  decider={r.decided_by ? nameOf(r.decided_by) : null}
                  actionable={view === "queue"}
                  busy={busy}
                  onOpen={() => openModal(r)}
                  onApprove={() => openModal(r, "approve")}
                  onReject={() => openModal(r, "reject")}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          <RulesPanel approver={approver} settings={settings} busy={busy} onSave={(fd) => run(() => saveApprovalSettings(fd))} />
        </div>
      </div>

      <Modal
        open={!!selected}
        onClose={closeModal}
        title={selected ? `${ENTITY_LABEL[selected.entity_type]} request` : "Request"}
        hint={selected ? `From ${nameOf(selected.requested_by)} · ${formatDateTime(selected.created_at)}` : undefined}
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] text-cream">{selected.summary}</p>
                {amountOf(selected) && <p className="mt-1 font-mono text-[15px] tabular-nums text-cream">{amountOf(selected)}</p>}
              </div>
              <Badge tone={STATUS_TONE[selected.status]}>{selected.status}</Badge>
            </div>

            {entityHref(selected, access, me) && (
              <Link
                href={entityHref(selected, access, me)!}
                className="inline-flex min-h-9 items-center gap-1.5 text-[12px] text-terra-bright underline-offset-4 hover:underline sm:min-h-0"
              >
                <Icon.link size={13} /> Open the {ENTITY_LABEL[selected.entity_type].toLowerCase()}
              </Link>
            )}

            {selected.status !== "pending" && (
              <div className="border-t border-cream/[0.08] pt-3 text-[12.5px] text-cream-2">
                <p>
                  {selected.status === "cancelled" ? "Cancelled" : `${selected.status === "approved" ? "Approved" : "Rejected"} by ${nameOf(selected.decided_by)}`}
                  {selected.decided_at ? ` · ${formatDateTime(selected.decided_at)}` : ""}
                </p>
                {selected.note && <p className="mt-1.5 text-sand">“{selected.note}”</p>}
              </div>
            )}

            {canDecide && (
              <div className="space-y-3 border-t border-cream/[0.08] pt-3">
                <Field
                  label="Note"
                  hint={modal?.intent === "reject" ? `${nameOf(selected.requested_by)} sees this — say what to change.` : "Optional — sent with your decision."}
                >
                  <Textarea
                    rows={3}
                    value={note}
                    maxLength={1000}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={modal?.intent === "reject" ? "Over the event budget — split it across two months?" : "Looks good."}
                  />
                </Field>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button type="button" className="mr-auto min-h-9 sm:min-h-0" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button type="button" variant={modal?.intent === "approve" ? "ghost" : "danger"} className="min-h-9 sm:min-h-0" disabled={busy} onClick={() => decide("reject")}>
                    <Icon.close size={13} /> Reject
                  </Button>
                  <Button type="button" variant={modal?.intent === "reject" ? "ghost" : "primary"} className="min-h-9 sm:min-h-0" disabled={busy} onClick={() => decide("approve")}>
                    <Icon.check size={13} /> Approve
                  </Button>
                </div>
              </div>
            )}

            {approver && selected.status === "pending" && selected.requested_by === me && (
              <p className="text-[11.5px] text-sand">Another admin has to decide this one — nobody approves their own request.</p>
            )}
          </div>
        )}
      </Modal>

      {toast}
    </>
  );
}

/* ─────────────────────────────── pieces ─────────────────────────────── */

function RequestCard({
  request: r,
  requester,
  decider,
  actionable,
  busy,
  onOpen,
  onApprove,
  onReject,
}: {
  request: ApprovalRequest;
  requester: string;
  decider: string | null;
  actionable: boolean;
  busy: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const EntityIcon = Icon[ENTITY_ICON[r.entity_type]];
  const amount = amountOf(r);
  const line =
    r.status === "pending"
      ? `${amount ? `${amount} · ` : ""}from ${requester}`
      : `${amount ? `${amount} · ` : ""}${r.status === "cancelled" ? "cancelled" : `${r.status} by ${decider ?? "an admin"}`}`;

  return (
    <li className="relative flex min-w-0 flex-col border border-cream/[0.08] bg-[linear-gradient(180deg,rgba(243,233,220,0.045),rgba(243,233,220,0.015))] px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-sand">
          <EntityIcon size={12} /> {ENTITY_LABEL[r.entity_type]} · {formatDateTime(r.created_at)}
        </p>
        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
      </div>
      <button type="button" onClick={onOpen} className="mt-1.5 block min-w-0 text-left">
        <span className="block truncate font-display text-[14.5px] font-medium text-cream hover:text-terra-bright">{r.summary}</span>
      </button>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <Avatar name={requester} size={20} />
        <p className="min-w-0 truncate text-[12px] text-sand">{line}</p>
      </div>
      {r.status === "rejected" && r.note && <p className="mt-1.5 line-clamp-2 text-[11.5px] text-rose-200/80">“{r.note}”</p>}

      {actionable && (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-cream/[0.06] pt-3">
          <Button variant="danger" className="min-h-9 sm:min-h-0" disabled={busy} onClick={onReject}>
            Reject
          </Button>
          <Button variant="primary" className="min-h-9 sm:min-h-0" disabled={busy} onClick={onApprove}>
            <Icon.check size={13} /> Approve
          </Button>
        </div>
      )}
    </li>
  );
}

function RulesPanel({
  approver,
  settings,
  busy,
  onSave,
}: {
  approver: boolean;
  settings: ApprovalSettings | null;
  busy: boolean;
  onSave: (fd: FormData) => void;
}) {
  if (!settings) {
    return (
      <Panel title="Approval rules" hint="Thresholds for members' requests">
        <p className="text-[12px] text-sand">The rules appear once the approvals migration has run.</p>
      </Panel>
    );
  }

  const expense = Number(settings.expense_approval_threshold ?? 50000);
  const invoice = Number(settings.invoice_approval_threshold ?? 500000);
  const leave = settings.leave_requires_approval ?? true;

  if (!approver) {
    return (
      <Panel title="What needs approval" hint="Set by your admins">
        <ul className="space-y-2.5 text-[12.5px] text-cream-2">
          <li className="flex items-start gap-2">
            <Icon.ledger size={14} className="mt-0.5 shrink-0 text-sand" />
            <span>Expenses of {money(expense)} or more</span>
          </li>
          <li className="flex items-start gap-2">
            <Icon.receipt size={14} className="mt-0.5 shrink-0 text-sand" />
            <span>Issuing invoices of {money(invoice)} or more</span>
          </li>
          <li className="flex items-start gap-2">
            <Icon.plane size={14} className="mt-0.5 shrink-0 text-sand" />
            <span>{leave ? "Every leave request" : "Leave is approved automatically"}</span>
          </li>
        </ul>
        <p className="mt-3 text-[11.5px] text-sand">Until it&apos;s approved, a pending expense isn&apos;t counted in any total.</p>
      </Panel>
    );
  }

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSave(new FormData(e.currentTarget));
  };

  return (
    <Panel title="Approval rules" hint="Members only — admins are approved automatically">
      <form key={`${expense}-${invoice}-${leave}`} onSubmit={submit} className="space-y-3.5">
        <Field label="Expense threshold (Rs)" hint="Member expenses at or above this wait for sign-off.">
          <Input name="expense_approval_threshold" type="number" min="0" step="1" inputMode="numeric" defaultValue={expense} />
        </Field>
        <Field label="Invoice threshold (Rs)" hint="Issuing an invoice this big needs sign-off first.">
          <Input name="invoice_approval_threshold" type="number" min="0" step="1" inputMode="numeric" defaultValue={invoice} />
        </Field>
        <Checkbox name="leave_requires_approval" label="Leave needs approval" hint="Off = members' leave is approved as soon as it's requested." defaultChecked={leave} />
        <div className="flex justify-end border-t border-cream/[0.08] pt-3">
          <Button type="submit" variant="primary" className="min-h-9 sm:min-h-0" disabled={busy}>
            <Icon.settings size={13} /> Save rules
          </Button>
        </div>
      </form>
    </Panel>
  );
}
