"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import type { EventKind } from "@/lib/admin/types";
import { fail, ok, optional, text, type ActionResult } from "./shared";

function readEvent(formData: FormData) {
  const allDay = formData.get("all_day") === "on";
  const starts = text(formData, "starts_at");
  const ends = text(formData, "ends_at");
  return {
    title: text(formData, "title"),
    description: optional(formData, "description"),
    // datetime-local has no timezone; new Date() reads it as local, which is
    // what the person typing it meant.
    starts_at: starts ? new Date(starts).toISOString() : null,
    ends_at: ends ? new Date(ends).toISOString() : null,
    all_day: allDay,
    kind: (text(formData, "kind") || "task") as EventKind,
    lead_id: optional(formData, "lead_id"),
  };
}

export async function createEvent(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireAdmin();
    const event = readEvent(formData);
    if (!event.title) return { ok: false, error: "Give the event a title." };
    if (!event.starts_at) return { ok: false, error: "Pick a date and time." };

    const { error } = await supabase.from("calendar_events").insert({ ...event, created_by: user.id });
    if (error) throw error;

    revalidatePath("/admin");
    return ok("Added to the calendar.");
  } catch (e) {
    return fail(e);
  }
}

export async function updateEvent(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const event = readEvent(formData);
    if (!event.title) return { ok: false, error: "Give the event a title." };
    if (!event.starts_at) return { ok: false, error: "Pick a date and time." };

    const { error } = await supabase.from("calendar_events").update(event).eq("id", id);
    if (error) throw error;

    revalidatePath("/admin");
    return ok("Event updated.");
  } catch (e) {
    return fail(e);
  }
}

export async function toggleEventDone(id: string, done: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("calendar_events").update({ done }).eq("id", id);
    if (error) throw error;
    revalidatePath("/admin");
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("calendar_events").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/admin");
    return ok("Event deleted.");
  } catch (e) {
    return fail(e);
  }
}
