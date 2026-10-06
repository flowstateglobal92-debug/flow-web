"use server";

import { revalidatePath } from "next/cache";
import { authorize, type Session } from "@/lib/admin/auth";
import { roleAllows } from "@/lib/admin/modules";
import type { Role, Score, StageTone } from "@/lib/admin/types";
import { amount, fail, mustAffect, nextPosition, ok, optional, text, type ActionResult } from "./shared";

/* ─────────────────────────────── leads ─────────────────────────────────── */

/**
 * A lead's owner has to be an active teammate here who can open the CRM —
 * 0012 refuses anyone else; this says so in a sentence. A blank pick means
 * "leave it": new leads default to whoever adds them.
 */
async function ownerFrom(session: Session, fd: FormData) {
  const id = text(fd, "owner_id");
  if (!id) return undefined;
  const { data } = await session.supabase
    .from("profiles")
    .select("id, role, permissions, is_active")
    .eq("id", id)
    .maybeSingle<{ id: string; role: Role; permissions: string[]; is_active: boolean }>();
  if (!data || !roleAllows(data.role, data.permissions, session.profile.workspace, data.is_active, "crm")) {
    throw new Error("Pick an owner who can open the CRM.");
  }
  return id;
}

/**
 * The linked client, only when the form carries the field ("" unlinks). The
 * id is looked up first so a lead can't point at a client nobody here can see.
 */
async function clientFrom(session: Session, fd: FormData) {
  if (!fd.has("client_id")) return {};
  const id = text(fd, "client_id");
  if (!id) return { client_id: null };
  const { data } = await session.supabase.from("clients").select("id").eq("id", id).maybeSingle<{ id: string }>();
  if (!data) throw new Error("That client no longer exists.");
  return { client_id: id };
}

const leadFields = (fd: FormData) => ({
  name: text(fd, "name"),
  company: optional(fd, "company"),
  email: optional(fd, "email"),
  phone: optional(fd, "phone"),
  value: amount(fd, "value"),
  score: (text(fd, "score") || "WARM") as Score,
  source: text(fd, "source") || "manual",
  notes: optional(fd, "notes"),
  next_action: optional(fd, "next_action"),
});

export async function createLead(formData: FormData): Promise<ActionResult> {
  try {
    const session = await authorize("crm");
    const { supabase } = session;

    const fields = leadFields(formData);
    if (!fields.name) return { ok: false, error: "A lead needs a name." };

    let stageId = text(formData, "stage_id");
    if (!stageId) {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("id")
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (!data) return { ok: false, error: "No pipeline stages exist yet. Run migration 0003." };
      stageId = data.id;
    }

    const owner = await ownerFrom(session, formData);
    const client = await clientFrom(session, formData);

    const { data, error } = await supabase
      .from("leads")
      .insert({
        ...fields,
        ...client,
        ...(owner && { owner_id: owner }),
        stage_id: stageId,
        position: await nextPosition(supabase, stageId),
        created_by: session.user.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;

    revalidatePath("/admin/crm");
    revalidatePath("/admin");
    return ok("Lead added.", data.id);
  } catch (e) {
    return fail(e);
  }
}

export async function updateLead(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const session = await authorize("crm");
    const fields = leadFields(formData);
    if (!fields.name) return { ok: false, error: "A lead needs a name." };

    const owner = await ownerFrom(session, formData);
    const client = await clientFrom(session, formData);

    const { data, error } = await session.supabase
      .from("leads")
      .update({ ...fields, ...client, ...(owner && { owner_id: owner }) })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    mustAffect(data);

    revalidatePath("/admin/crm");
    revalidatePath("/admin");
    if (client.client_id) revalidatePath(`/admin/clients/${client.client_id}`);
    return ok("Lead updated.", id);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteLead(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("crm");
    const { data, error } = await supabase.from("leads").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    revalidatePath("/admin/crm");
    revalidatePath("/admin");
    return ok("Lead removed.");
  } catch (e) {
    return fail(e);
  }
}

/**
 * Drop a card into a column at a given index and renumber that column.
 * The source column keeps its relative order — gaps are harmless because
 * ordering only ever compares positions inside one stage.
 */
export async function moveLead(id: string, stageId: string, index: number): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("crm");

    const { data: column, error: readError } = await supabase
      .from("leads")
      .select("id")
      .eq("stage_id", stageId)
      .order("position", { ascending: true })
      .returns<{ id: string }[]>();
    if (readError) throw readError;

    const ids = (column ?? []).map((l) => l.id).filter((x) => x !== id);
    const at = Math.max(0, Math.min(index, ids.length));
    ids.splice(at, 0, id);

    const { data: moved, error: moveError } = await supabase
      .from("leads")
      .update({ stage_id: stageId })
      .eq("id", id)
      .select("id");
    if (moveError) throw moveError;
    mustAffect(moved);

    const results = await Promise.all(
      ids.map((leadId, position) => supabase.from("leads").update({ position }).eq("id", leadId)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;

    revalidatePath("/admin/crm");
    revalidatePath("/admin");
    return ok();
  } catch (e) {
    return fail(e);
  }
}

/* ────────────────────────────── stages ─────────────────────────────────── */

export async function createStage(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("crm");
    const name = text(formData, "name");
    if (!name) return { ok: false, error: "Name the stage." };

    const { data: last } = await supabase
      .from("pipeline_stages")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle<{ position: number }>();

    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({
        name,
        position: (last?.position ?? -1) + 1,
        tone: (text(formData, "tone") || "cream") as StageTone,
        is_won: formData.get("is_won") === "on",
        is_lost: formData.get("is_lost") === "on",
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;

    revalidatePath("/admin/crm");
    return ok("Stage added.", data.id);
  } catch (e) {
    return fail(e);
  }
}

export async function updateStage(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("crm");
    const name = text(formData, "name");
    if (!name) return { ok: false, error: "Name the stage." };

    const { data, error } = await supabase
      .from("pipeline_stages")
      .update({
        name,
        tone: (text(formData, "tone") || "cream") as StageTone,
        is_won: formData.get("is_won") === "on",
        is_lost: formData.get("is_lost") === "on",
      })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    mustAffect(data);

    revalidatePath("/admin/crm");
    return ok("Stage updated.");
  } catch (e) {
    return fail(e);
  }
}

/** Deletes through the RPC so the stage's leads are rehomed in one transaction. */
export async function deleteStage(id: string, moveTo?: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("crm");
    const { error } = await supabase.rpc("delete_pipeline_stage", {
      p_stage_id: id,
      p_move_to: moveTo ?? null,
    });
    if (error) throw error;
    revalidatePath("/admin/crm");
    return ok("Stage deleted.");
  } catch (e) {
    return fail(e);
  }
}

/** Shift a stage one column left or right. The protected stage stays first. */
export async function moveStage(id: string, direction: "left" | "right"): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("crm");

    const { data: stages, error } = await supabase
      .from("pipeline_stages")
      .select("id, position, is_protected")
      .order("position", { ascending: true })
      .returns<{ id: string; position: number; is_protected: boolean }[]>();
    if (error) throw error;

    const list = stages ?? [];
    const from = list.findIndex((s) => s.id === id);
    if (from < 0) return { ok: false, error: "Stage not found." };
    if (list[from].is_protected) return { ok: false, error: "That stage is locked to first position." };

    const to = direction === "left" ? from - 1 : from + 1;
    if (to < 0 || to >= list.length) return ok();
    if (list[to].is_protected) return { ok: false, error: "The first stage is locked in place." };

    const reordered = [...list];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    const results = await Promise.all(
      reordered.map((stage, position) =>
        stage.position === position
          ? Promise.resolve({ error: null })
          : supabase.from("pipeline_stages").update({ position }).eq("id", stage.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;

    revalidatePath("/admin/crm");
    return ok();
  } catch (e) {
    return fail(e);
  }
}
