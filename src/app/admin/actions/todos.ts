"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/admin/auth";
import { fromLocalInput, todayISO } from "@/lib/admin/format";
import {
  KIND_LABEL,
  PRIORITIES,
  RECURRENCES,
  STATUSES,
  type TodoInput,
  type TodoKind,
  type TodoStatus,
} from "@/app/admin/(shell)/todos/model";
import { fail, mustAffect, ok, type ActionResult } from "./shared";

/**
 * To-dos (0020). RLS decides who sees and edits what: private to-dos are for
 * their participants; the creator, an assignee or an admin may edit; only the
 * creator or an admin deletes. The database also re-checks that everyone
 * tagged can open To-dos, and schedules the reminders and notifications.
 */

type Supabase = Awaited<ReturnType<typeof authorize>>["supabase"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function revalidate() {
  revalidatePath("/admin/todos");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
}

const uuidOrNull = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

/** An ISO instant, null for empty, undefined for garbage. */
function instant(v: unknown) {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/**
 * Whitelist and validate what the browser sent. Server Actions are plain POST
 * endpoints, so nothing from `input` reaches a write unless it's named here.
 */
function clean(input: TodoInput) {
  const title = String(input.title ?? "").trim().slice(0, 300);
  if (!title) return { error: "Give the to-do a title." } as const;

  const due = instant(input.due_at);
  const remind = instant(input.remind_at);
  if (due === undefined) return { error: "That due date isn't valid." } as const;
  if (remind === undefined) return { error: "That reminder time isn't valid." } as const;

  const recurrence = RECURRENCES.includes(input.recurrence as never) ? input.recurrence! : "none";
  if (recurrence !== "none" && !due) return { error: "A repeating to-do needs a due date." } as const;
  const until = recurrence !== "none" && input.recurrence_until && DAY.test(input.recurrence_until) ? input.recurrence_until : null;

  const labels = [
    ...new Set((Array.isArray(input.labels) ? input.labels : []).map((l) => String(l).trim().slice(0, 32)).filter(Boolean)),
  ].slice(0, 12);

  const assignees = Array.isArray(input.assignees)
    ? [...new Set(input.assignees.filter((a): a is string => typeof a === "string" && UUID.test(a)))].slice(0, 25)
    : null;

  const row = {
    title,
    notes: input.notes ? String(input.notes).trim().slice(0, 5000) || null : null,
    kind: (input.kind && input.kind in KIND_LABEL ? input.kind : "task") as TodoKind,
    status: (STATUSES.includes(input.status as never) ? input.status : "open") as TodoStatus,
    priority: PRIORITIES.includes(input.priority as never) ? input.priority! : "normal",
    due_at: due,
    all_day: !!due && !!input.all_day,
    remind_at: remind,
    recurrence,
    recurrence_until: until,
    labels,
    is_private: !!input.is_private,
    lead_id: uuidOrNull(input.lead_id),
    client_id: uuidOrNull(input.client_id),
    invoice_id: uuidOrNull(input.invoice_id),
  };
  return { row, assignees } as const;
}

const tagError = (message: string) =>
  /row-level security|permission|user_can_access|access/i.test(message)
    ? "Someone you tagged can't use To-dos."
    : message;

/** Bring todo_assignees in line with `wanted`. */
async function syncAssignees(supabase: Supabase, todoId: string, wanted: string[]) {
  const { data: current, error } = await supabase
    .from("todo_assignees")
    .select("user_id")
    .eq("todo_id", todoId)
    .returns<{ user_id: string }[]>();
  if (error) throw error;

  const have = new Set((current ?? []).map((a) => a.user_id));
  const add = wanted.filter((id) => !have.has(id));
  const drop = [...have].filter((id) => !wanted.includes(id));

  if (drop.length) {
    const { error: e } = await supabase.from("todo_assignees").delete().eq("todo_id", todoId).in("user_id", drop);
    if (e) throw e;
  }
  if (add.length) {
    const { error: e } = await supabase.from("todo_assignees").insert(add.map((user_id) => ({ todo_id: todoId, user_id })));
    if (e) throw new Error(tagError(e.message));
  }
}

export async function createTodo(input: TodoInput): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("todos");
    const cleaned = clean(input);
    if ("error" in cleaned) return { ok: false, error: cleaned.error };
    const { row, assignees } = cleaned;

    // Tagging someone puts it on their calendar — no date means today, all day.
    if (assignees?.length && !row.due_at) {
      row.due_at = fromLocalInput(todayISO());
      row.all_day = true;
    }

    const { data, error } = await supabase.from("todos").insert(row).select("id").single<{ id: string }>();
    if (error) throw error;

    if (assignees?.length) {
      const { error: e } = await supabase
        .from("todo_assignees")
        .insert(assignees.map((user_id) => ({ todo_id: data.id, user_id })));
      if (e) {
        // Don't leave a half-made to-do behind.
        await supabase.from("todos").delete().eq("id", data.id);
        throw new Error(tagError(e.message));
      }
    }

    revalidate();
    const n = assignees?.length ?? 0;
    return ok(n ? `Added — ${n === 1 ? "1 person" : `${n} people`} tagged.` : "To-do added.", data.id);
  } catch (e) {
    return fail(e);
  }
}

export async function updateTodo(id: string, input: TodoInput): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("todos");
    const cleaned = clean(input);
    if ("error" in cleaned) return { ok: false, error: cleaned.error };
    const { row, assignees } = cleaned;

    const { data, error } = await supabase.from("todos").update(row).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data, "Only the creator, someone on it or an admin can change this to-do.");

    if (assignees) await syncAssignees(supabase, id, assignees);

    revalidate();
    return ok("To-do saved.", id);
  } catch (e) {
    return fail(e);
  }
}

export async function setTodoStatus(id: string, status: TodoStatus): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("todos");
    if (!STATUSES.includes(status)) return { ok: false, error: "Unknown status." };
    const { data, error } = await supabase.from("todos").update({ status }).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data, "Only the creator, someone on it or an admin can change this to-do.");
    revalidate();
    return ok(status === "done" ? "Done." : status === "in_progress" ? "In progress." : "Reopened.");
  } catch (e) {
    return fail(e);
  }
}

/**
 * A board drop: the card's new status, plus the positions that changed in
 * its column. Rows RLS won't let you touch keep their place quietly.
 */
export async function moveTodo(
  id: string,
  status: TodoStatus,
  positions: { id: string; position: number }[],
): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("todos");
    if (!STATUSES.includes(status)) return { ok: false, error: "Unknown status." };

    const { data, error } = await supabase.from("todos").update({ status }).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data, "Only the creator, someone on it or an admin can move this to-do.");

    const moves = (Array.isArray(positions) ? positions : [])
      .filter((p) => UUID.test(String(p?.id)) && Number.isInteger(p?.position))
      .slice(0, 300);
    await Promise.all(moves.map((p) => supabase.from("todos").update({ position: p.position }).eq("id", p.id)));

    revalidate();
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTodo(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("todos");
    const { data, error } = await supabase.from("todos").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data, "Only the creator or an admin can delete this to-do.");
    revalidate();
    return ok("To-do deleted.");
  } catch (e) {
    return fail(e);
  }
}

/* ───────────────────────────── checklist ───────────────────────────── */

export async function addChecklistItem(todoId: string, body: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("todos");
    const text = String(body ?? "").trim().slice(0, 300);
    if (!text) return { ok: false, error: "Write the step first." };

    const { data: last } = await supabase
      .from("todo_checklist")
      .select("position")
      .eq("todo_id", todoId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle<{ position: number }>();

    const { data, error } = await supabase
      .from("todo_checklist")
      .insert({ todo_id: todoId, body: text, position: (last?.position ?? -1) + 1 })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    revalidatePath("/admin/todos");
    return ok("Step added.", data.id);
  } catch (e) {
    return fail(e);
  }
}

export async function toggleChecklistItem(id: string, done: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("todos");
    const { data, error } = await supabase.from("todo_checklist").update({ done: !!done }).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    revalidatePath("/admin/todos");
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function deleteChecklistItem(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("todos");
    const { data, error } = await supabase.from("todo_checklist").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    revalidatePath("/admin/todos");
    return ok("Step removed.");
  } catch (e) {
    return fail(e);
  }
}
