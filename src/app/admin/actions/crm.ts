"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import type { Score, StageTone } from "@/lib/admin/types";
import { amount, fail, nextPosition, ok, optional, text, type ActionResult } from "./shared";

/* ─────────────────────────────── leads ─────────────────────────────────── */

export async function createLead(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireAdmin();

    const name = text(formData, "name");
    if (!name) return { ok: false, error: "A lead needs a name." };

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

    const { error } = await supabase.from("leads").insert({
      stage_id: stageId,
      name,
      company: optional(formData, "company"),
      email: optional(formData, "email"),
      phone: optional(formData, "phone"),
      value: amount(formData, "value"),
      score: (text(formData, "score") || "WARM") as Score,
      source: text(formData, "source") || "manual",
      notes: optional(formData, "notes"),
      next_action: optional(formData, "next_action"),
      position: await nextPosition(supabase, stageId),
      created_by: user.id,
    });
    if (error) throw error;

    revalidatePath("/admin/crm");
    revalidatePath("/admin");
    return ok("Lead added.");
  } catch (e) {
    return fail(e);
  }
}

export async function updateLead(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const name = text(formData, "name");
    if (!name) return { ok: false, error: "A lead needs a name." };

    const { error } = await supabase
      .from("leads")
      .update({
        name,
        company: optional(formData, "company"),
        email: optional(formData, "email"),
        phone: optional(formData, "phone"),
        value: amount(formData, "value"),
        score: (text(formData, "score") || "WARM") as Score,
        source: text(formData, "source") || "manual",
        notes: optional(formData, "notes"),
        next_action: optional(formData, "next_action"),
      })
      .eq("id", id);
    if (error) throw error;

    revalidatePath("/admin/crm");
    revalidatePath("/admin");
    return ok("Lead updated.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteLead(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) throw error;
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
    const { supabase } = await requireAdmin();

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

    const { error: moveError } = await supabase.from("leads").update({ stage_id: stageId }).eq("id", id);
    if (moveError) throw moveError;

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

export async function addLeadNote(leadId: string, body: string): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireAdmin();
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: "Write something first." };
    const { error } = await supabase
      .from("lead_activities")
      .insert({ lead_id: leadId, kind: "note", body: trimmed, actor_id: user.id });
    if (error) throw error;
    revalidatePath("/admin/crm");
    return ok("Note added.");
  } catch (e) {
    return fail(e);
  }
}

/* ────────────────────────────── stages ─────────────────────────────────── */

export async function createStage(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const name = text(formData, "name");
    if (!name) return { ok: false, error: "Name the stage." };

    const { data: last } = await supabase
      .from("pipeline_stages")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle<{ position: number }>();

    const { error } = await supabase.from("pipeline_stages").insert({
      name,
      position: (last?.position ?? -1) + 1,
      tone: (text(formData, "tone") || "cream") as StageTone,
      is_won: formData.get("is_won") === "on",
      is_lost: formData.get("is_lost") === "on",
    });
    if (error) throw error;

    revalidatePath("/admin/crm");
    return ok("Stage added.");
  } catch (e) {
    return fail(e);
  }
}

export async function updateStage(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const name = text(formData, "name");
    if (!name) return { ok: false, error: "Name the stage." };

    const { error } = await supabase
      .from("pipeline_stages")
      .update({
        name,
        tone: (text(formData, "tone") || "cream") as StageTone,
        is_won: formData.get("is_won") === "on",
        is_lost: formData.get("is_lost") === "on",
      })
      .eq("id", id);
    if (error) throw error;

    revalidatePath("/admin/crm");
    return ok("Stage updated.");
  } catch (e) {
    return fail(e);
  }
}

/** Deletes through the RPC so the stage's leads are rehomed in one transaction. */
export async function deleteStage(id: string, moveTo?: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
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
    const { supabase } = await requireAdmin();

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
