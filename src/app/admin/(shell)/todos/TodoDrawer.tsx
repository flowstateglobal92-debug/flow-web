"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import CommentThread from "@/components/admin/comments/CommentThread";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import type { useAction } from "@/components/admin/useAction";
import { Avatar, Button, Checkbox, Field, Input, Notice, Select, Textarea, fieldClass, labelClass } from "@/components/admin/ui";
import { dayKey, dayShort, personName } from "@/components/admin/calendar/items";
import { TIME_OFF_LABEL, type TimeOffType } from "@/components/admin/timeoff/timeoff";
import { fromLocalInput, relativeTime, toDateTimeInput, todayISO } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import type { TeamMember } from "@/lib/admin/types";
import {
  addChecklistItem,
  createTodo,
  deleteChecklistItem,
  deleteTodo,
  toggleChecklistItem,
  updateTodo,
} from "@/app/admin/actions/todos";
import {
  KIND_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  RECURRENCES,
  RECURRENCE_LABEL,
  REMINDER_LABEL,
  STATUSES,
  STATUS_LABEL,
  leaveOn,
  presetFor,
  reminderAt,
  type LeaveSpan,
  type ReminderPreset,
  type Todo,
  type TodoInput,
  type TodoKind,
  type TodoLinks,
  type TodoPriority,
  type TodoRecurrence,
  type TodoStatus,
} from "./model";

type Run = ReturnType<typeof useAction>["run"];

/** What to open: an existing to-do, or a new one (optionally on a day / for a person). */
export type DrawerTarget = { id: string | null; day?: string; assignee?: string };

type Shared = {
  people: TeamMember[];
  team: TeamMember[];
  me: string;
  canAdmin: boolean;
  links: TodoLinks;
  leave: LeaveSpan[];
  run: Run;
  pending: boolean;
  onClose: () => void;
};

/**
 * Everything about one to-do: fields, assignees (To-dos users only, with an
 * on-leave warning), due/reminder/recurrence, links, checklist and the
 * discussion. People who can see but not edit it get the same view, disabled.
 */
export default function TodoDrawer({ target, todo, ...shared }: Shared & { target: DrawerTarget | null; todo: Todo | null }) {
  const open = !!target;
  const gone = !!target?.id && !todo;
  const key = target ? (target.id ?? `new:${target.day ?? ""}:${target.assignee ?? ""}`) : "";
  const creator = todo?.created_by ? shared.team.find((m) => m.id === todo.created_by) : null;

  return (
    <Modal
      open={open}
      onClose={shared.onClose}
      title={!target ? "" : todo ? todo.title : gone ? "To-do" : "New to-do"}
      hint={
        todo
          ? `${KIND_LABEL[todo.kind]} · created by ${creator ? personName(creator) : "someone"} ${relativeTime(todo.created_at)}`
          : gone
            ? undefined
            : "Tag people to put it on their calendar."
      }
      width="max-w-2xl"
    >
      {gone ? (
        <Notice tone="warn" title="Can't open this to-do">
          It was deleted, finished a while ago, or it&apos;s private to the people on it.
        </Notice>
      ) : (
        open && <TodoForm key={key} todo={todo} target={target} {...shared} />
      )}
    </Modal>
  );
}

/* ─────────────────────────────── form ──────────────────────────────── */

function TodoForm({
  todo,
  target,
  people,
  team,
  me,
  canAdmin,
  links,
  leave,
  run,
  pending,
  onClose,
}: Shared & { todo: Todo | null; target: DrawerTarget }) {
  const canEdit = !todo || canAdmin || todo.created_by === me || todo.assignees.includes(me);
  const canDelete = !!todo && (canAdmin || todo.created_by === me);

  const [title, setTitle] = useState(todo?.title ?? "");
  const [notes, setNotes] = useState(todo?.notes ?? "");
  const [status, setStatus] = useState<TodoStatus>(todo?.status ?? "open");
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? "normal");
  const [kind, setKind] = useState<TodoKind>(todo?.kind ?? "task");
  // Due is edited as a Colombo day plus an optional time; no time = all day.
  const initialDay = todo?.due_at ? dayKey(todo.due_at) : (target.day ?? "");
  const initialTime = todo?.due_at && !todo.all_day ? toDateTimeInput(new Date(todo.due_at)).slice(11, 16) : "";
  const [day, setDay] = useState(initialDay);
  const [time, setTime] = useState(initialTime);
  const [preset, setPreset] = useState<ReminderPreset>(() => presetFor(todo?.remind_at ?? null, initialDay, initialTime));
  const [custom, setCustom] = useState(todo?.remind_at ? toDateTimeInput(new Date(todo.remind_at)) : "");
  const [recurrence, setRecurrence] = useState<TodoRecurrence>(todo?.recurrence ?? "none");
  const [until, setUntil] = useState(todo?.recurrence_until ?? "");
  const [assignees, setAssignees] = useState<string[]>(todo?.assignees ?? (target.assignee ? [target.assignee] : []));
  const [labels, setLabels] = useState((todo?.labels ?? []).join(", "));
  const [isPrivate, setPrivate] = useState(todo?.is_private ?? false);
  const [leadId, setLeadId] = useState(todo?.lead_id ?? "");
  const [clientId, setClientId] = useState(todo?.client_id ?? "");
  const [invoiceId, setInvoiceId] = useState(todo?.invoice_id ?? "");

  // Presets that make sense for what's set; a stale choice falls back to none.
  const available: ReminderPreset[] = !day
    ? ["none", "custom"]
    : time
      ? ["none", "at_due", "15m", "1h", "1d", "custom"]
      : ["none", "at_due", "1d", "custom"];
  const reminder = available.includes(preset) ? preset : "none";

  // A new to-do that tags people with no date is due today (the server does the same).
  const today = todayISO();
  const effectiveDay = day || (!todo && assignees.length ? today : "");
  const away = useMemo(
    () =>
      effectiveDay
        ? assignees
            .map((uid) => ({ uid, span: leaveOn(leave, uid, effectiveDay) }))
            .filter((x): x is { uid: string; span: LeaveSpan } => !!x.span)
        : [],
    [assignees, leave, effectiveDay],
  );

  const nameOf = (uid: string) => {
    const m = team.find((p) => p.id === uid);
    return m ? personName(m) : "Someone";
  };
  // Keep anyone already on it visible even if they've since lost To-dos access.
  const assignable = useMemo(() => {
    const extra = assignees.filter((id) => !people.some((p) => p.id === id));
    return [...people, ...team.filter((m) => extra.includes(m.id))];
  }, [people, team, assignees]);

  const repeatWithoutDate = recurrence !== "none" && !day;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (repeatWithoutDate) return;
    const input: TodoInput = {
      title,
      notes,
      kind,
      status,
      priority,
      due_at: day ? fromLocalInput(time ? `${day}T${time}` : day) : null,
      all_day: !!day && !time,
      remind_at: reminderAt(reminder, day, time, custom),
      recurrence,
      recurrence_until: recurrence !== "none" ? until || null : null,
      labels: labels.split(",").map((l) => l.trim()).filter(Boolean),
      is_private: isPrivate,
      lead_id: leadId || null,
      client_id: clientId || null,
      invoice_id: invoiceId || null,
      assignees,
    };
    run(todo ? () => updateTodo(todo.id, input) : () => createTodo(input), {
      onDone: (r) => r.ok && onClose(),
    });
  };

  const toggle = (uid: string) =>
    setAssignees((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));

  const option = (value: string, label: string) => (
    <option key={value} value={value} className="bg-ink text-cream">
      {label}
    </option>
  );

  const linkOpts = [
    { key: "lead", label: "Lead", value: leadId, set: setLeadId, options: links.leads },
    { key: "client", label: "Client", value: clientId, set: setClientId, options: links.clients },
    { key: "invoice", label: "Invoice", value: invoiceId, set: setInvoiceId, options: links.invoices },
  ].filter((l) => l.options.length > 0 || l.value);

  return (
    <div className="space-y-5">
      {!canEdit && (
        <Notice tone="info" title="Read only">
          Only the person who created it, the people on it, or an admin can change this to-do. You can still comment.
        </Notice>
      )}

      <form onSubmit={submit}>
        <fieldset disabled={!canEdit} className="space-y-4">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} placeholder="Send the revised proposal" />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as TodoStatus)}>
                {STATUSES.map((s) => option(s, STATUS_LABEL[s]))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as TodoPriority)}>
                {PRIORITIES.map((p) => option(p, PRIORITY_LABEL[p]))}
              </Select>
            </Field>
            <Field label="Kind">
              <Select value={kind} onChange={(e) => setKind(e.target.value as TodoKind)}>
                {(Object.keys(KIND_LABEL) as TodoKind[]).map((k) => option(k, KIND_LABEL[k]))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Due" hint={day ? undefined : assignees.length && !todo ? "Empty = today, because people are tagged." : "Optional."}>
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="Time" hint="Leave empty for all day.">
              <Input type="time" value={time} disabled={!day} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="Reminder">
              <Select value={reminder} onChange={(e) => setPreset(e.target.value as ReminderPreset)}>
                {available.map((p) => option(p, time ? REMINDER_LABEL[p].timed : REMINDER_LABEL[p].allDay))}
              </Select>
            </Field>
            {reminder === "custom" ? (
              <Field label="Remind at">
                <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
            <Field label="Repeats" hint={repeatWithoutDate ? "Give it a due date to repeat it." : undefined}>
              <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value as TodoRecurrence)}>
                {RECURRENCES.map((r) => option(r, RECURRENCE_LABEL[r]))}
              </Select>
            </Field>
            {recurrence !== "none" && (
              <Field label="Until" hint="Optional.">
                <Input type="date" value={until} min={day || undefined} onChange={(e) => setUntil(e.target.value)} />
              </Field>
            )}
          </div>

          <div>
            <p className={labelClass}>People on it</p>
            {assignable.length === 0 ? (
              <p className="text-[11.5px] text-sand">Nobody else on the team has To-dos yet.</p>
            ) : (
              <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto border border-cream/[0.08] p-1.5 scroll-thin sm:grid-cols-2" data-lenis-prevent>
                {assignable.map((m) => {
                  const on = assignees.includes(m.id);
                  const out = effectiveDay ? leaveOn(leave, m.id, effectiveDay) : null;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(m.id)}
                      className={`flex min-h-9 min-w-0 items-center gap-2 px-2 py-1.5 text-left transition-colors disabled:opacity-60 ${
                        on ? "bg-terra/[0.12] text-cream" : "text-cream-2 hover:bg-cream/[0.04]"
                      }`}
                    >
                      <Avatar name={personName(m)} size={22} />
                      <span className="min-w-0 flex-1 truncate text-[12px]">
                        {personName(m)}
                        {m.id === me ? " (you)" : ""}
                      </span>
                      {out && <span className="shrink-0 font-mono text-[9.5px] uppercase text-amber-200">away</span>}
                      {on && <Icon.check size={13} className="shrink-0 text-terra-bright" />}
                    </button>
                  );
                })}
              </div>
            )}
            {away.length > 0 && (
              <div className="mt-2">
                <Notice tone="warn" title={`On leave ${effectiveDay === today ? "today" : `on ${dayShort(effectiveDay)}`}`}>
                  {away
                    .map(
                      ({ uid, span }) =>
                        `${nameOf(uid)} — ${TIME_OFF_LABEL[span.type as TimeOffType] ?? "away"}${span.half_day ? ` (${span.half_day.toUpperCase()})` : ""}${
                          span.status === "pending" ? ", pending" : ""
                        }`,
                    )
                    .join("; ")}
                  . You can still tag them.
                </Notice>
              </div>
            )}
          </div>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={5000} placeholder="Context, links, the definition of done…" />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Labels" hint="Comma-separated. Searchable — they stay off the cards.">
              <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="website, follow-up" />
            </Field>
            <div className="sm:pt-6">
              <Checkbox
                label="Private"
                hint="Only you and the people on it can see it."
                checked={isPrivate}
                onChange={(e) => setPrivate(e.target.checked)}
              />
            </div>
          </div>

          {linkOpts.length > 0 && (
            <div className={`grid grid-cols-1 gap-3 ${linkOpts.length > 1 ? "sm:grid-cols-2" : ""} ${linkOpts.length > 2 ? "lg:grid-cols-3" : ""}`}>
              {linkOpts.map((l) => {
                const known = l.options.some((o) => o.id === l.value);
                const href = l.value && known ? hrefFor(l.key, l.value) : null;
                return (
                  <div key={l.key} className="min-w-0">
                    <Field label={`Linked ${l.label.toLowerCase()}`}>
                      <Select value={l.value} onChange={(e) => l.set(e.target.value)}>
                        {option("", "None")}
                        {l.value && !known && option(l.value, `Linked ${l.label.toLowerCase()}`)}
                        {l.options.map((o) => option(o.id, o.label))}
                      </Select>
                    </Field>
                    {href && (
                      <Link href={href} className="mt-1 inline-flex min-h-8 items-center gap-1 text-[11px] text-sand hover:text-terra-bright pointer-coarse:min-h-9">
                        Open {l.label.toLowerCase()} <Icon.arrow size={11} />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </fieldset>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
          {canDelete && todo && (
            <Button
              type="button"
              variant="danger"
              className="mr-auto"
              disabled={pending}
              onClick={() => {
                if (confirm(`Delete "${todo.title}"?`)) run(() => deleteTodo(todo.id), { onDone: (r) => r.ok && onClose() });
              }}
            >
              <Icon.trash size={13} /> Delete
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button type="submit" variant="primary" disabled={pending || !title.trim() || repeatWithoutDate}>
              {todo ? "Save to-do" : "Add to-do"}
            </Button>
          )}
        </div>
      </form>

      {todo ? (
        <>
          <Checklist todo={todo} canEdit={canEdit} run={run} pending={pending} />
          <div className="border-t border-cream/[0.08] pt-4">
            <p className={labelClass}>Discussion</p>
            <CommentThread target={{ type: "todo", id: todo.id }} people={people} compact />
          </div>
        </>
      ) : (
        <p className="text-[11.5px] text-sand">Add checklist steps and comments once it&apos;s saved.</p>
      )}
    </div>
  );
}

/* ───────────────────────────── checklist ───────────────────────────── */

function Checklist({ todo, canEdit, run, pending }: { todo: Todo; canEdit: boolean; run: Run; pending: boolean }) {
  const [draft, setDraft] = useState("");
  const done = todo.checklist.filter((c) => c.done).length;

  const add = () => {
    const body = draft.trim();
    if (!body) return;
    run(() => addChecklistItem(todo.id, body), { quiet: true, onDone: (r) => r.ok && setDraft("") });
  };

  return (
    <div className="border-t border-cream/[0.08] pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className={`${labelClass} mb-0`}>Checklist</p>
        {todo.checklist.length > 0 && (
          <span className="font-mono text-[10.5px] text-sand tabular-nums">
            {done}/{todo.checklist.length}
          </span>
        )}
      </div>
      <ul className="mt-2">
        {todo.checklist.map((c) => (
          <li key={c.id} className="flex items-center gap-1 border-b border-cream/[0.05] last:border-0">
            <button
              type="button"
              disabled={!canEdit || pending}
              onClick={() => run(() => toggleChecklistItem(c.id, !c.done), { quiet: true })}
              aria-label={c.done ? `Untick "${c.body}"` : `Tick "${c.body}"`}
              className="flex h-10 w-10 shrink-0 items-center justify-center disabled:opacity-60"
            >
              <span
                className={`flex h-4 w-4 items-center justify-center border ${
                  c.done ? "border-terra bg-terra text-cream" : "border-cream/30"
                }`}
              >
                {c.done && <Icon.check size={11} />}
              </span>
            </button>
            <span className={`min-w-0 flex-1 break-words text-[12.5px] ${c.done ? "text-sand line-through" : "text-cream-2"}`}>
              {c.body}
            </span>
            {canEdit && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteChecklistItem(c.id), { quiet: true })}
                aria-label={`Remove "${c.body}"`}
                className="flex h-10 w-10 shrink-0 items-center justify-center text-sand/60 transition-colors hover:text-rose-200"
              >
                <Icon.close size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            maxLength={300}
            placeholder="Add a step…"
            className={fieldClass}
          />
          <Button type="button" disabled={pending || !draft.trim()} onClick={add}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
