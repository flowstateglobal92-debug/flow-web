"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Avatar, Badge, Button, Checkbox, EmptyState, Field, Input, Notice, Panel, Select, Stat } from "@/components/admin/ui";
import { linkButton } from "@/components/admin/invoice/parts";
import { formatDate, formatDateShort, moneyShort, num } from "@/lib/admin/format";
import {
  FREQUENCIES,
  cadenceLabel,
  docMoney,
  monthlyValue,
  scheduleEnded,
  type Frequency,
  type InvoiceSchedule,
} from "@/lib/admin/invoice-types";
import { deleteSchedule, runRecurringNow, setScheduleActive, updateSchedule } from "@/app/admin/actions/invoices";

const billTo = (s: InvoiceSchedule) =>
  s.template?.bill_to_company?.trim() || s.template?.bill_to_name?.trim() || "No client set";

function scheduleState(s: InvoiceSchedule): { label: string; tone: "success" | "muted" | "warn" } {
  if (scheduleEnded(s)) return { label: "Ended", tone: "muted" };
  if (!s.active) return { label: "Paused", tone: "warn" };
  return { label: "Active", tone: "success" };
}

export default function RecurringList({
  schedules,
  lastInvoices,
  people,
  openId,
  generated,
  today,
  admin,
}: {
  schedules: InvoiceSchedule[];
  lastInvoices: Record<string, string>;
  people: Record<string, string>;
  openId: string | null;
  generated: number;
  today: string;
  admin: boolean;
}) {
  const { run, pending, toast } = useAction();
  const [editing, setEditing] = useState<InvoiceSchedule | null>(() => schedules.find((s) => s.id === openId) ?? null);

  const live = schedules.filter((s) => s.active && !scheduleEnded(s));
  const retainers = live.filter((s) => s.is_retainer && s.currency.toUpperCase() === "LKR");
  const mrr = retainers.reduce((a, s) => a + monthlyValue(num(s.amount), s.frequency, s.interval_count), 0);
  const foreignRetainers = live.filter((s) => s.is_retainer && s.currency.toUpperCase() !== "LKR").length;
  const next = [...live].sort((a, b) => a.next_run_on.localeCompare(b.next_run_on))[0];
  const paused = schedules.filter((s) => !s.active && !scheduleEnded(s)).length;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    run(() => updateSchedule(editing.id, fd), { onDone: (r) => r.ok && setEditing(null) });
  };

  const actions = (s: InvoiceSchedule) => {
    const ended = scheduleEnded(s);
    return (
      <div className="flex flex-wrap items-center gap-1.5 [&>button]:min-h-9">
        {!ended && (
          <Button disabled={pending} onClick={() => run(() => setScheduleActive(s.id, !s.active))}>
            {s.active ? "Pause" : "Resume"}
          </Button>
        )}
        <Button variant="quiet" disabled={pending} onClick={() => setEditing(s)}>
          <Icon.settings size={13} /> Settings
        </Button>
        <Link href={`/admin/invoices/recurring/${s.id}`} className={`${linkButton.ghost} min-h-9`}>
          <Icon.edit size={13} /> Lines
        </Link>
      </div>
    );
  };

  return (
    <>
      {generated > 0 && (
        <div className="mb-4">
          <Notice tone="info" title={`${generated} invoice${generated === 1 ? " was" : "s were"} due and just generated.`}>
            Auto-issued ones are under Issued invoices; the rest wait as drafts on the Create tab.
          </Notice>
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="MRR"
          value={moneyShort(mrr)}
          sub={`${retainers.length} active retainer${retainers.length === 1 ? "" : "s"} · per month${foreignRetainers ? ` · ${foreignRetainers} in other currencies` : ""}`}
          tone="terra"
          icon={<Icon.repeat size={15} />}
        />
        <Stat
          label="Active schedules"
          value={String(live.length)}
          sub={paused ? `${paused} paused` : "None paused"}
          icon={<Icon.calendar size={15} />}
        />
        <Stat
          label="Next run"
          value={next ? formatDateShort(next.next_run_on) : "—"}
          sub={next ? `${next.name} · ${docMoney(num(next.amount), next.currency)}` : "Nothing scheduled"}
          icon={<Icon.clock size={15} />}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-[12px] text-sand">
          Due periods generate once a day and whenever this page opens. Admins can let a schedule issue on its own; otherwise each
          run leaves a draft to check.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={pending} onClick={() => run(() => runRecurringNow())} className="min-h-9">
            <Icon.refresh size={13} /> Generate now
          </Button>
          <Link href="/admin/invoices/new?recurring=1" className={`${linkButton.primary} min-h-9`}>
            <Icon.plus size={13} /> New schedule
          </Link>
        </div>
      </div>

      <Panel bodyClass="p-0">
        {schedules.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No recurring invoices yet"
              hint="Retainers, subscriptions, monthly support — create the first invoice and switch on “Make recurring”."
              action={
                <Link href="/admin/invoices/new?recurring=1" className={`${linkButton.primary} min-h-9`}>
                  <Icon.plus size={13} /> New schedule
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scroll-thin md:block" data-lenis-prevent>
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                    <th className="px-3 py-2.5 font-normal">Schedule</th>
                    <th className="px-3 py-2.5 font-normal">Repeats</th>
                    <th className="px-3 py-2.5 font-normal">Next run</th>
                    <th className="px-3 py-2.5 text-right font-normal">Amount</th>
                    <th className="px-3 py-2.5 font-normal">Each run</th>
                    <th className="px-3 py-2.5 font-normal">Status</th>
                    <th className="px-3 py-2.5 font-normal">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => {
                    const state = scheduleState(s);
                    const owner = s.owner_id ? people[s.owner_id] : null;
                    return (
                      <tr key={s.id} className="border-b border-cream/[0.05] align-middle transition-colors last:border-0 hover:bg-cream/[0.03]">
                        <td className="max-w-[300px] px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            {owner && (
                              <span title={owner}>
                                <Avatar name={owner} size={22} />
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-[13px] text-cream">
                                {s.name}
                                {s.is_retainer && <span className="ml-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-terra-bright">Retainer</span>}
                              </p>
                              <p className="truncate text-[11px] text-sand">
                                {billTo(s)}
                                {s.last_invoice_id && lastInvoices[s.last_invoice_id] && (
                                  <>
                                    {" · last "}
                                    <Link href={`/admin/invoices/${s.last_invoice_id}`} className="text-cream-2 hover:text-terra-bright">
                                      {lastInvoices[s.last_invoice_id]}
                                    </Link>
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-cream-2">{cadenceLabel(s.frequency, s.interval_count)}</td>
                        <td className={`whitespace-nowrap px-3 py-3 text-[11.5px] ${state.label === "Active" ? "text-cream-2" : "text-sand/70"}`}>
                          {state.label === "Ended" ? "—" : formatDate(s.next_run_on)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-[12px] text-cream tabular-nums">
                          {docMoney(num(s.amount), s.currency)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[11.5px] text-sand">{s.auto_issue ? "Issues itself" : "Draft to review"}</td>
                        <td className="px-3 py-3">
                          <Badge tone={state.tone}>{state.label}</Badge>
                        </td>
                        <td className="px-3 py-3">{actions(s)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="md:hidden">
              {schedules.map((s) => {
                const state = scheduleState(s);
                return (
                  <li key={s.id} className="border-b border-cream/[0.06] px-4 py-3.5 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sand">
                          {cadenceLabel(s.frequency, s.interval_count)}
                          {s.is_retainer ? " · retainer" : ""}
                        </p>
                        <p className="mt-0.5 truncate font-display text-[14px] text-cream">{s.name}</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-sand">
                          {docMoney(num(s.amount), s.currency)}
                          {state.label === "Ended" ? " · finished" : ` · next ${formatDateShort(s.next_run_on)}`}
                        </p>
                      </div>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </div>
                    <div className="mt-3">{actions(s)}</div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? editing.name : "Schedule"}
        hint="Cadence and dates. To change the lines or the client, use Lines."
      >
        {editing && (
          <form key={editing.id} onSubmit={submit} className="space-y-4">
            <Field label="Name">
              <Input name="name" required defaultValue={editing.name} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
                <Field label="Repeats">
                  <Select name="frequency" defaultValue={editing.frequency}>
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value as Frequency} className="bg-ink text-cream">
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Every">
                  <Input name="interval_count" type="number" min="1" step="1" defaultValue={editing.interval_count} />
                </Field>
              </div>
              <Field label="Next invoice on" hint="Move it to a new day and later runs follow that day.">
                <Input name="next_run_on" type="date" required defaultValue={editing.next_run_on} min={today} />
              </Field>
              <Field label="Ends on" hint="Optional.">
                <Input name="ends_on" type="date" defaultValue={editing.ends_on ?? ""} />
              </Field>
              <Field label="Or after (invoices)" hint={`${editing.occurrences} invoiced so far.`}>
                <Input name="max_occurrences" type="number" min="1" step="1" defaultValue={editing.max_occurrences ?? ""} />
              </Field>
            </div>
            <div className="space-y-2.5 border-t border-cream/[0.08] pt-3">
              <Checkbox name="is_retainer" defaultChecked={editing.is_retainer} label="This is a retainer" hint="Counts towards MRR." />
              <Checkbox
                name="auto_issue"
                defaultChecked={editing.auto_issue}
                disabled={!admin}
                label="Issue automatically"
                hint={
                  admin
                    ? "Numbered and issued on the run day."
                    : editing.auto_issue
                      ? "Only admins can change this. Moving its dates or cadence, or resuming it, switches it to drafts for review."
                      : "Only admins can change this."
                }
              />
              <Checkbox
                name="active"
                defaultChecked={editing.active}
                label="Active"
                hint="Paused schedules generate nothing, and resuming skips the periods missed."
              />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
              <Button
                type="button"
                variant="danger"
                className="mr-auto"
                disabled={pending}
                onClick={() => {
                  if (confirm(`Delete “${editing.name}”? Invoices it already made stay.`)) {
                    run(() => deleteSchedule(editing.id), { onDone: (r) => r.ok && setEditing(null) });
                  }
                }}
              >
                <Icon.trash size={13} /> Delete
              </Button>
              <Button type="button" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Modal>
      {toast}
    </>
  );
}
