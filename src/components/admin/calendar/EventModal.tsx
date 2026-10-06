"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Modal from "../Modal";
import { Icon } from "../icons";
import type { useAction } from "../useAction";
import { Avatar, AvatarStack, Badge, Button, Checkbox, Field, Input, Notice, Select, Textarea, labelClass } from "../ui";
import { formatDateTime, formatTime, toDateTimeInput, todayISO } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import { canAccess } from "@/lib/admin/modules";
import { EVENT_KIND_LABEL, type EventKind, type TeamMember } from "@/lib/admin/types";
import { createEvent, deleteEvent, leaveEvent, loadEventForm, toggleEventDone, updateEvent } from "@/app/admin/actions/calendar";
import { dayKey, dayLabel, personName, type EventDetail, type EventFormData } from "./items";

type Run = ReturnType<typeof useAction>["run"];

/** What the calendar asks the modal to open: an existing event, or a new one on a day. */
export type EventTarget = { id: string | null; day?: string };

/**
 * Create / edit an event — or, for anyone who isn't the creator or an admin,
 * a read-only view with "Created by X" (attendees can take themselves off).
 * The full row and the pickers load when it opens; CalendarItem only carries
 * what a chip needs.
 */
export default function EventModal({
  target,
  onClose,
  people,
  me,
  run,
  pending,
}: {
  target: EventTarget | null;
  onClose: () => void;
  people: TeamMember[];
  me?: string;
  run: Run;
  pending: boolean;
}) {
  const id = target?.id ?? null;
  const open = !!target;
  const key = target ? (target.id ?? `new:${target.day ?? ""}`) : "";
  const [loaded, setLoaded] = useState<{ key: string; data: EventFormData } | null>(null);
  // Forget the last copy once the dialog closes: reopening the same event
  // must show (and post back) the saved row, not the one from before an edit.
  if (!open && loaded) setLoaded(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadEventForm(id)
      .then((data) => {
        if (live) setLoaded({ key, data });
      })
      .catch(() => {
        // Offline, or a deploy swapped the action out from under the page.
        if (live) setLoaded({ key, data: { ...UNLOADED, error: "Couldn't load this event — try again." } });
      });
    return () => {
      live = false;
    };
  }, [open, id, key]);

  const data = loaded?.key === key ? loaded.data : null;
  const event = data?.event ?? null;
  const readOnly = !!data && data.ok && !data.canEdit;

  const title = !data || !data.ok ? (id ? "Event" : "New event") : readOnly ? event?.title || "Event" : event ? "Edit event" : "New event";
  const hint = !data || !data.ok
    ? undefined
    : readOnly
      ? `${EVENT_KIND_LABEL[event?.kind ?? "task"]} · only ${data.creator ?? "the creator"} or an admin can change it`
      : event
        ? `${EVENT_KIND_LABEL[event.kind]}${data.creator ? ` · created by ${data.creator}` : ""}`
        : "It shows on the shared calendar. Attendees are told and reminded.";

  return (
    <Modal open={open} onClose={onClose} title={title} hint={hint} width="max-w-2xl">
      {!data ? (
        <p className="py-6 text-center font-mono text-[11px] text-sand">Loading…</p>
      ) : !data.ok ? (
        <Notice tone="danger" title="Couldn't open this event">
          {data.error}
        </Notice>
      ) : readOnly && event ? (
        <EventReadOnly event={event} data={data} people={people} me={me} run={run} pending={pending} onClose={onClose} />
      ) : (
        <EventForm
          key={key}
          event={event}
          data={data}
          day={target?.day}
          people={people}
          me={me}
          run={run}
          pending={pending}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

const UNLOADED: EventFormData = {
  ok: false,
  event: null,
  attendees: [],
  leads: [],
  clients: [],
  canEdit: false,
  creator: null,
};

/* ─────────────────────────────── form ──────────────────────────────── */

/** Attendees must be able to open the calendar. TeamMember has no workspace; it's always the viewer's. */
const calendarPeople = (people: TeamMember[]) =>
  people.filter((m) => canAccess({ ...m, workspace: "live" }, "calendar"));

function EventForm({
  event,
  data,
  day,
  people,
  me,
  run,
  pending,
  onClose,
}: {
  event: EventDetail | null;
  data: EventFormData;
  day?: string;
  people: TeamMember[];
  me?: string;
  run: Run;
  pending: boolean;
  onClose: () => void;
}) {
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  // Kept as datetime-local strings (Colombo); the all-day inputs edit the date part.
  const [start, setStart] = useState(
    event ? toDateTimeInput(new Date(event.starts_at)) : `${day ?? todayISO()}T09:00`,
  );
  const [end, setEnd] = useState(event?.ends_at ? toDateTimeInput(new Date(event.ends_at)) : "");
  const [attendees, setAttendees] = useState<string[]>(data.attendees);

  // The creator is on it already; offer everyone else who can open the calendar.
  const creator = event?.created_by ?? me;
  const invitable = useMemo(() => calendarPeople(people).filter((m) => m.id !== creator), [people, creator]);
  const leadKnown = !event?.lead_id || data.leads.some((l) => l.id === event.lead_id);
  const clientKnown = !event?.client_id || data.clients.some((c) => c.id === event.client_id);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(event ? () => updateEvent(event.id, fd) : () => createEvent(fd), {
      onDone: (r) => r.ok && onClose(),
    });
  };

  const toggle = (uid: string) =>
    setAttendees((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title">
        <Input name="title" required maxLength={200} defaultValue={event?.title ?? ""} placeholder="Kick-off with Perera Dental" />
      </Field>

      <Checkbox
        name="all_day"
        label="All day"
        checked={allDay}
        onChange={(e) => setAllDay(e.target.checked)}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {allDay ? (
          <>
            <Field label="First day">
              <Input
                name="starts_at"
                type="date"
                required
                value={start.slice(0, 10)}
                onChange={(e) => setStart(`${e.target.value}T${start.slice(11, 16) || "09:00"}`)}
              />
            </Field>
            <Field label="Last day" hint="Optional — for multi-day events.">
              <Input
                name="ends_at"
                type="date"
                min={start.slice(0, 10)}
                value={end.slice(0, 10)}
                onChange={(e) => setEnd(e.target.value ? `${e.target.value}T00:00` : "")}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Starts">
              <Input name="starts_at" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Ends" hint="Optional.">
              <Input name="ends_at" type="datetime-local" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Type">
          <Select name="kind" defaultValue={event?.kind ?? "meeting"}>
            {(Object.keys(EVENT_KIND_LABEL) as EventKind[]).map((k) => (
              <option key={k} value={k} className="bg-ink text-cream">
                {EVENT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location" hint="Optional.">
          <Input name="location" maxLength={200} defaultValue={event?.location ?? ""} placeholder="Office, client site…" />
        </Field>
        <Field label="Meeting link" hint="Optional — Meet, Zoom, Teams." className="sm:col-span-2">
          <Input
            name="meeting_url"
            inputMode="url"
            maxLength={500}
            defaultValue={event?.meeting_url ?? ""}
            placeholder="https://meet.google.com/…"
          />
        </Field>
        <Field label="Client" hint="Optional." className="min-w-0">
          <Select name="client_id" defaultValue={event?.client_id ?? ""}>
            <option value="" className="bg-ink text-cream">
              None
            </option>
            {!clientKnown && event?.client_id && (
              <option value={event.client_id} className="bg-ink text-cream">
                Linked client
              </option>
            )}
            {data.clients.map((c) => (
              <option key={c.id} value={c.id} className="bg-ink text-cream">
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lead" hint="Optional." className="min-w-0">
          <Select name="lead_id" defaultValue={event?.lead_id ?? ""}>
            <option value="" className="bg-ink text-cream">
              None
            </option>
            {!leadKnown && event?.lead_id && (
              <option value={event.lead_id} className="bg-ink text-cream">
                Linked lead
              </option>
            )}
            {data.leads.map((l) => (
              <option key={l.id} value={l.id} className="bg-ink text-cream">
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div>
        <p className={labelClass}>Attendees</p>
        <input type="hidden" name="attendees_field" value="1" />
        {attendees.map((uid) => (
          <input key={uid} type="hidden" name="attendees" value={uid} />
        ))}
        {invitable.length === 0 ? (
          <p className="text-[11.5px] text-sand">Nobody else on the team can open the calendar yet.</p>
        ) : (
          <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto border border-cream/[0.08] p-1.5 scroll-thin sm:grid-cols-2" data-lenis-prevent>
            {invitable.map((m) => {
              const on = attendees.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(m.id)}
                  className={`flex min-h-9 min-w-0 items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                    on ? "bg-terra/[0.12] text-cream" : "text-cream-2 hover:bg-cream/[0.04]"
                  }`}
                >
                  <Avatar name={personName(m)} size={22} />
                  <span className="min-w-0 flex-1 truncate text-[12px]">{personName(m)}</span>
                  {on && <Icon.check size={13} className="shrink-0 text-terra-bright" />}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-1 text-[11px] text-sand/80">Each attendee gets an invite and a reminder 15 minutes before.</p>
      </div>

      <Field label="Notes">
        <Textarea name="description" rows={3} maxLength={4000} defaultValue={event?.description ?? ""} />
      </Field>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
        {event && (
          <>
            <Button
              type="button"
              variant="danger"
              className="mr-auto"
              disabled={pending}
              onClick={() => {
                if (confirm("Delete this event for everyone?")) run(() => deleteEvent(event.id), { onDone: (r) => r.ok && onClose() });
              }}
            >
              <Icon.trash size={13} /> Delete
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => run(() => toggleEventDone(event.id, !event.done), { onDone: (r) => r.ok && onClose() })}
            >
              <Icon.check size={13} /> {event.done ? "Mark not done" : "Mark done"}
            </Button>
          </>
        )}
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {event ? "Save event" : "Add event"}
        </Button>
      </div>
    </form>
  );
}

/* ───────────────────────────── read-only ───────────────────────────── */

function whenLabel(event: EventDetail) {
  const startDay = dayKey(event.starts_at);
  if (event.all_day) {
    const endDay = event.ends_at ? dayKey(event.ends_at) : startDay;
    return endDay === startDay ? `${dayLabel(startDay)} · all day` : `${dayLabel(startDay)} – ${dayLabel(endDay)} · all day`;
  }
  if (!event.ends_at) return formatDateTime(event.starts_at);
  return dayKey(event.ends_at) === startDay
    ? `${formatDateTime(event.starts_at)} – ${formatTime(event.ends_at)}`
    : `${formatDateTime(event.starts_at)} – ${formatDateTime(event.ends_at)}`;
}

function EventReadOnly({
  event,
  data,
  people,
  me,
  run,
  pending,
  onClose,
}: {
  event: EventDetail;
  data: EventFormData;
  people: TeamMember[];
  me?: string;
  run: Run;
  pending: boolean;
  onClose: () => void;
}) {
  const name = (uid: string) => {
    const m = people.find((p) => p.id === uid);
    return m ? personName(m) : null;
  };
  const attendeeNames = data.attendees.map(name).filter(Boolean) as string[];
  const lead = event.lead_id ? data.leads.find((l) => l.id === event.lead_id) : null;
  const client = event.client_id ? data.clients.find((c) => c.id === event.client_id) : null;
  const attending = !!me && data.attendees.includes(me);

  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-sand">{label}</dt>
      <dd className="min-w-0 text-[12.5px] text-cream-2">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={data.creator ?? "?"} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Created by</p>
          <p className="truncate text-[13px] text-cream">{data.creator ?? "Someone"}</p>
        </div>
        {event.done && <Badge tone="success">Done</Badge>}
      </div>

      <dl className="space-y-3 border-t border-cream/[0.08] pt-4">
        {row("When", whenLabel(event))}
        {row("Type", EVENT_KIND_LABEL[event.kind])}
        {event.location && row("Location", event.location)}
        {event.meeting_url &&
          row(
            "Meeting link",
            <a
              href={event.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-terra-bright hover:underline"
            >
              {event.meeting_url}
            </a>,
          )}
        {client && row("Client", <Link href={hrefFor("client", client.id) ?? "#"} className="hover:text-terra-bright">{client.label}</Link>)}
        {lead && row("Lead", <Link href={hrefFor("lead", lead.id) ?? "#"} className="hover:text-terra-bright">{lead.label}</Link>)}
        {attendeeNames.length > 0 &&
          row(
            "Attendees",
            <span className="flex flex-wrap items-center gap-2">
              <AvatarStack names={attendeeNames} max={5} size={20} />
              <span className="min-w-0">{attendeeNames.join(", ")}</span>
            </span>,
          )}
        {event.description && row("Notes", <span className="whitespace-pre-wrap">{event.description}</span>)}
      </dl>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
        {attending && (
          <Button
            type="button"
            variant="danger"
            className="mr-auto"
            disabled={pending}
            onClick={() => run(() => leaveEvent(event.id), { onDone: (r) => r.ok && onClose() })}
          >
            Take me off this event
          </Button>
        )}
        <Button type="button" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
