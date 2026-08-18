"use client";

import { useMemo, useState, type FormEvent } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Button, Field, Input, Panel, Select, Textarea } from "@/components/admin/ui";
import { toDateInput, toDateTimeInput } from "@/lib/admin/format";
import { EVENT_KIND_LABEL, type CalendarEvent, type EventKind } from "@/lib/admin/types";
import { createEvent, deleteEvent, toggleEventDone, updateEvent } from "@/app/admin/actions/calendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const KIND_TONE: Record<EventKind, string> = {
  task: "border-cream/20 bg-cream/[0.06] text-cream-2",
  meeting: "border-terra/40 bg-terra/[0.14] text-terra-bright",
  follow_up: "border-amber-300/35 bg-amber-400/[0.10] text-amber-100",
  payment: "border-emerald-300/35 bg-emerald-400/[0.10] text-emerald-200",
  other: "border-cream/12 bg-cream/[0.04] text-sand",
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Six-week grid starting on the Monday on or before the 1st. */
function buildGrid(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Sunday(0) → 6
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export default function Calendar({
  events,
  leads,
}: {
  events: CalendarEvent[];
  leads: { id: string; label: string }[];
}) {
  const { run, pending, toast } = useAction();
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [modal, setModal] = useState<{ mode: "create" | "edit"; event?: CalendarEvent; date?: Date } | null>(null);

  const days = useMemo(() => buildGrid(cursor), [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = toDateInput(new Date(e.starts_at));
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [events]);

  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(cursor);
  const shift = (by: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + by, 1));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const editing = modal?.mode === "edit" ? modal.event?.id : null;
    run(editing ? () => updateEvent(editing, fd) : () => createEvent(fd), {
      onDone: (r) => r.ok && setModal(null),
    });
  };

  const defaultStart = modal?.event
    ? toDateTimeInput(new Date(modal.event.starts_at))
    : toDateTimeInput(
        (() => {
          const d = modal?.date ? new Date(modal.date) : new Date();
          d.setHours(9, 0, 0, 0);
          return d;
        })(),
      );

  return (
    <>
      <Panel
        title={monthName}
        hint="Follow-ups, meetings and payments in one place"
        bodyClass="p-3"
        right={
          <>
            <Button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</Button>
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="Previous month"
              className="flex h-7 w-7 items-center justify-center border border-cream/12 text-cream-2 transition-colors hover:bg-cream/[0.06]"
            >
              <Icon.chevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="Next month"
              className="flex h-7 w-7 items-center justify-center border border-cream/12 text-cream-2 transition-colors hover:bg-cream/[0.06]"
            >
              <Icon.chevronRight size={14} />
            </button>
            <Button variant="primary" onClick={() => setModal({ mode: "create", date: new Date() })}>
              <Icon.plus size={13} /> Event
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-7 gap-px border border-cream/[0.06] bg-cream/[0.06]">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-ink px-2 py-1.5 text-center text-[10px] uppercase tracking-[0.16em] text-sand">
              {d}
            </div>
          ))}

          {days.map((day) => {
            const key = toDateInput(day);
            const list = byDay.get(key) ?? [];
            const isThisMonth = day.getMonth() === cursor.getMonth();
            const isToday = sameDay(day, today);
            return (
              <div
                key={key}
                className={`group relative min-h-[92px] bg-ink px-1.5 pb-1.5 pt-1 transition-colors ${
                  isThisMonth ? "" : "opacity-40"
                } ${isToday ? "ring-1 ring-inset ring-terra/50" : "hover:bg-cream/[0.03]"}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`font-mono text-[10.5px] tabular-nums ${isToday ? "text-terra-bright" : "text-sand"}`}
                  >
                    {day.getDate()}
                  </span>
                  <button
                    type="button"
                    onClick={() => setModal({ mode: "create", date: day })}
                    aria-label={`Add event on ${key}`}
                    className="text-cream/0 transition-colors group-hover:text-cream/40 hover:!text-terra-bright"
                  >
                    <Icon.plus size={12} />
                  </button>
                </div>

                <div className="mt-1 space-y-1">
                  {list.slice(0, 3).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setModal({ mode: "edit", event: e })}
                      className={`block w-full truncate border px-1.5 py-0.5 text-left text-[10.5px] transition-opacity ${
                        KIND_TONE[e.kind]
                      } ${e.done ? "opacity-45 line-through" : ""}`}
                      title={e.title}
                    >
                      {!e.all_day && (
                        <span className="mr-1 font-mono text-[9.5px] opacity-80">
                          {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
                            new Date(e.starts_at),
                          )}
                        </span>
                      )}
                      {e.title}
                    </button>
                  ))}
                  {list.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setModal({ mode: "edit", event: list[3] })}
                      className="block w-full text-left text-[10px] text-sand hover:text-cream"
                    >
                      +{list.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? "Edit event" : "New event"}
        hint={modal?.mode === "edit" ? EVENT_KIND_LABEL[modal.event?.kind ?? "task"] : "Everything you schedule shows on the month grid."}
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Title">
            <Input name="title" required defaultValue={modal?.event?.title ?? ""} placeholder="Call Nadia about the proposal" />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Starts">
              <Input name="starts_at" type="datetime-local" required defaultValue={defaultStart} />
            </Field>
            <Field label="Ends" hint="Optional.">
              <Input
                name="ends_at"
                type="datetime-local"
                defaultValue={modal?.event?.ends_at ? toDateTimeInput(new Date(modal.event.ends_at)) : ""}
              />
            </Field>
            <Field label="Type">
              <Select name="kind" defaultValue={modal?.event?.kind ?? "task"}>
                {(Object.keys(EVENT_KIND_LABEL) as EventKind[]).map((k) => (
                  <option key={k} value={k} className="bg-ink text-cream">
                    {EVENT_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Linked lead" hint="Optional.">
              <Select name="lead_id" defaultValue={modal?.event?.lead_id ?? ""}>
                <option value="" className="bg-ink text-cream">
                  None
                </option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id} className="bg-ink text-cream">
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-[12.5px] text-cream-2">
            <input
              type="checkbox"
              name="all_day"
              defaultChecked={modal?.event?.all_day}
              className="h-3.5 w-3.5 accent-[#c65d3b]"
            />
            All day
          </label>

          <Field label="Notes">
            <Textarea name="description" rows={3} defaultValue={modal?.event?.description ?? ""} />
          </Field>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
            {modal?.mode === "edit" && modal.event && (
              <>
                <Button
                  type="button"
                  variant="danger"
                  className="mr-auto"
                  disabled={pending}
                  onClick={() => {
                    if (confirm("Delete this event?"))
                      run(() => deleteEvent(modal.event!.id), { onDone: (r) => r.ok && setModal(null) });
                  }}
                >
                  <Icon.trash size={13} /> Delete
                </Button>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() => toggleEventDone(modal.event!.id, !modal.event!.done), {
                      onDone: (r) => r.ok && setModal(null),
                    })
                  }
                >
                  <Icon.check size={13} /> {modal.event.done ? "Mark not done" : "Mark done"}
                </Button>
              </>
            )}
            <Button type="button" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {modal?.mode === "edit" ? "Save event" : "Add event"}
            </Button>
          </div>
        </form>
      </Modal>

      {toast}
    </>
  );
}
