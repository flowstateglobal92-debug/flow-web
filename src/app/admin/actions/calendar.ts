"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/admin/auth";
import { fromLocalInput } from "@/lib/admin/format";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { EVENT_KIND_LABEL, type EventKind } from "@/lib/admin/types";
import type { EventDetail, EventFormData, PickOption } from "@/components/admin/calendar/items";
import { fail, mustAffect, ok, optional, text, type ActionResult } from "./shared";

/**
 * Shared-calendar events. RLS (0018) is the wall: everyone with Calendar reads
 * every event; only the creator or an admin edits, deletes or ticks one done;
 * attendees may only take themselves off. Every write chains `.select("id")`
 * so a row RLS filtered out reports as blocked instead of "Saved".
 */

const BASE_COLUMNS = "id, title, description, starts_at, ends_at, all_day, kind, done, lead_id, inquiry_id, created_by";
const SHARED_COLUMNS = `${BASE_COLUMNS}, client_id, location, meeting_url`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidate() {
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
}

/** Only http(s) links — a `javascript:` URL in a meeting link would run on click. */
function meetingUrl(raw: string | null) {
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw new Error("That meeting link doesn't look like a web address.");
  }
}

function readEvent(fd: FormData) {
  const kind = text(fd, "kind");
  // Times are typed in Colombo; fromLocalInput pins the +05:30 offset instead
  // of trusting whatever zone the server runs in. A bare date = local midnight.
  const event: Record<string, unknown> = {
    title: text(fd, "title"),
    description: optional(fd, "description"),
    starts_at: fromLocalInput(text(fd, "starts_at")),
    ends_at: fromLocalInput(text(fd, "ends_at")),
    all_day: fd.get("all_day") === "on",
    kind: (kind in EVENT_KIND_LABEL ? kind : "task") as EventKind,
    lead_id: optional(fd, "lead_id"),
  };
  // The 0011/0018 columns are only written when the form carries them, so an
  // older form can't blank them out.
  if (fd.has("location")) event.location = optional(fd, "location");
  if (fd.has("meeting_url")) event.meeting_url = meetingUrl(optional(fd, "meeting_url"));
  if (fd.has("client_id")) event.client_id = optional(fd, "client_id");
  return event;
}

function check(event: Record<string, unknown>) {
  if (!event.title) return "Give the event a title.";
  if (!event.starts_at) return "Pick a date and time.";
  if (event.ends_at && String(event.ends_at) < String(event.starts_at)) return "The end is before the start.";
  return null;
}

/** Attendees from the form, or null when the form doesn't manage them. */
function readAttendees(fd: FormData) {
  if (!fd.has("attendees_field")) return null;
  return [...new Set(fd.getAll("attendees").map(String).filter((id) => UUID.test(id)))].slice(0, 40);
}

/** Bring the attendee rows in line with the form. Returns a warning, or null. */
async function syncAttendees(
  supabase: Awaited<ReturnType<typeof authorize>>["supabase"],
  eventId: string,
  wanted: string[],
) {
  const { data: current, error } = await supabase
    .from("calendar_event_attendees")
    .select("user_id")
    .eq("event_id", eventId)
    .returns<{ user_id: string }[]>();
  if (error) return wanted.length ? "attendees need migration 0018" : null;

  const have = new Set((current ?? []).map((a) => a.user_id));
  const add = wanted.filter((id) => !have.has(id));
  const drop = [...have].filter((id) => !wanted.includes(id));

  if (drop.length) {
    const { error: e } = await supabase
      .from("calendar_event_attendees")
      .delete()
      .eq("event_id", eventId)
      .in("user_id", drop);
    if (e) return e.message;
  }
  if (add.length) {
    // The database re-checks that each person can open the calendar.
    const { error: e } = await supabase
      .from("calendar_event_attendees")
      .insert(add.map((user_id) => ({ event_id: eventId, user_id })));
    if (e) return /row-level security|permission/i.test(e.message) ? "someone picked can't open the calendar" : e.message;
  }
  return null;
}

export async function createEvent(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("calendar");
    const event = readEvent(formData);
    const problem = check(event);
    if (problem) return { ok: false, error: problem };

    // created_by is stamped by the database (0007).
    const { data, error } = await supabase.from("calendar_events").insert(event).select("id").single<{ id: string }>();
    if (error) throw error;

    const attendees = readAttendees(formData);
    const warning = attendees?.length ? await syncAttendees(supabase, data.id, attendees) : null;

    revalidate();
    return ok(warning ? `Added — but ${warning}.` : "Added to the calendar.", data.id);
  } catch (e) {
    return fail(e);
  }
}

export async function updateEvent(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("calendar");
    const event = readEvent(formData);
    const problem = check(event);
    if (problem) return { ok: false, error: problem };

    const { data, error } = await supabase.from("calendar_events").update(event).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data, "Only the person who created this event, or an admin, can change it.");

    const attendees = readAttendees(formData);
    const warning = attendees ? await syncAttendees(supabase, id, attendees) : null;

    revalidate();
    return ok(warning ? `Saved — but ${warning}.` : "Event updated.", id);
  } catch (e) {
    return fail(e);
  }
}

export async function toggleEventDone(id: string, done: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("calendar");
    const { data, error } = await supabase.from("calendar_events").update({ done }).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data, "Only the person who created this event, or an admin, can mark it done.");
    revalidate();
    return ok(done ? "Marked done." : "Marked not done.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("calendar");
    const { data, error } = await supabase.from("calendar_events").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data, "Only the person who created this event, or an admin, can delete it.");
    revalidate();
    return ok("Event deleted.");
  } catch (e) {
    return fail(e);
  }
}

/** An attendee takes themselves off an event they can't otherwise edit. */
export async function leaveEvent(id: string): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("calendar");
    const { data, error } = await supabase
      .from("calendar_event_attendees")
      .delete()
      .eq("event_id", id)
      .eq("user_id", profile.id)
      .select("event_id");
    if (error) throw error;
    mustAffect(data, "You're not on this event.");
    revalidate();
    return ok("You're off this event.");
  } catch (e) {
    return fail(e);
  }
}

/**
 * Everything the event modal needs when it opens: the full row (CalendarItem
 * only carries what a chip shows), its attendees, the lead and client pickers,
 * and whether this viewer may edit it.
 */
export async function loadEventForm(id: string | null): Promise<EventFormData> {
  const empty: EventFormData = { ok: false, event: null, attendees: [], leads: [], clients: [], canEdit: false, creator: null };
  try {
    const { supabase, profile } = await authorize("calendar");

    const loadEvent = async () => {
      if (!id) return null;
      const select = (cols: string) =>
        supabase.from("calendar_events").select(cols).eq("id", id).maybeSingle<EventDetail>();
      // Before 0011/0018 the extra columns don't exist — fall back to the old set.
      const full = await select(SHARED_COLUMNS);
      if (!full.error) return full.data;
      const base = await select(BASE_COLUMNS);
      if (base.error) throw base.error;
      return base.data ? { ...base.data, location: null, meeting_url: null, client_id: null } : null;
    };

    const [event, attendees, leads, clients] = await Promise.all([
      loadEvent(),
      id
        ? supabase
            .from("calendar_event_attendees")
            .select("user_id")
            .eq("event_id", id)
            .returns<{ user_id: string }[]>()
            .then(({ data }) => (data ?? []).map((a) => a.user_id))
        : Promise.resolve([] as string[]),
      canAccess(profile, "crm")
        ? supabase
            .from("leads")
            .select("id, name, company")
            .order("updated_at", { ascending: false })
            .limit(400)
            .returns<{ id: string; name: string; company: string | null }[]>()
            .then(({ data }) => (data ?? []).map((l): PickOption => ({ id: l.id, label: l.company || l.name })))
        : Promise.resolve([] as PickOption[]),
      supabase
        .from("clients")
        .select("id, name, company")
        .neq("status", "archived")
        .order("name", { ascending: true })
        .limit(400)
        .returns<{ id: string; name: string; company: string | null }[]>()
        .then(({ data }) =>
          (data ?? []).map((c): PickOption => ({ id: c.id, label: c.company && c.company !== c.name ? `${c.name} · ${c.company}` : c.name })),
        ),
    ]);

    if (id && !event) return { ...empty, error: "That event is gone, or you can't see it." };

    let creator: string | null = null;
    if (event?.created_by) {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", event.created_by)
        .maybeSingle<{ full_name: string | null; email: string }>();
      creator = data ? data.full_name || data.email.split("@")[0] : "A former teammate";
    }

    return {
      ok: true,
      event,
      attendees,
      leads,
      clients,
      canEdit: !event || isApprover(profile) || event.created_by === profile.id,
      creator,
    };
  } catch (e) {
    return { ...empty, error: fail(e).error };
  }
}
