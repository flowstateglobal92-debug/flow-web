"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/admin/auth";
import type { InquiryStatus } from "@/lib/admin/types";
import { fail, nextPosition, ok, type ActionResult } from "./shared";

export async function setInquiryStatus(ids: string[], status: InquiryStatus): Promise<ActionResult> {
  if (!ids.length) return ok();
  try {
    const { supabase } = await authorize("inquiries");
    const { error } = await supabase.from("inquiries").update({ status }).in("id", ids);
    if (error) throw error;
    revalidatePath("/admin/inquiries");
    revalidatePath("/admin");
    return ok(`${ids.length} inquir${ids.length === 1 ? "y" : "ies"} marked ${status}.`);
  } catch (e) {
    return fail(e);
  }
}

export async function saveInquiryNotes(id: string, notes: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("inquiries");
    const { error } = await supabase.from("inquiries").update({ notes: notes || null }).eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/inquiries");
    return ok("Note saved.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteInquiries(ids: string[]): Promise<ActionResult> {
  if (!ids.length) return ok();
  try {
    const { supabase } = await authorize("inquiries");
    const { error } = await supabase.from("inquiries").delete().in("id", ids);
    if (error) throw error;
    revalidatePath("/admin/inquiries");
    revalidatePath("/admin");
    return ok("Deleted.");
  } catch (e) {
    return fail(e);
  }
}

/**
 * Push selected inquiries into the CRM.
 *
 * Each one becomes a lead in the protected first stage, carrying its contact
 * details across; the inquiry is then marked converted and linked to the lead
 * so the trail stays intact. Already-converted inquiries are skipped rather
 * than duplicated.
 */
export async function convertInquiries(ids: string[], stageId?: string): Promise<ActionResult> {
  if (!ids.length) return ok();
  try {
    const { supabase, user } = await authorize("inquiries");
    // Converting writes leads, so it needs the CRM too.
    await authorize("crm");

    let targetStage = stageId;
    if (!targetStage) {
      const { data: stage } = await supabase
        .from("pipeline_stages")
        .select("id")
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (!stage) throw new Error("No pipeline stages exist yet. Run migration 0003.");
      targetStage = stage.id;
    }

    const { data: inquiries, error: readError } = await supabase
      .from("inquiries")
      .select("id, name, business, contact, focus, message, source, converted_lead_id")
      .in("id", ids);
    if (readError) throw readError;

    const pending = (inquiries ?? []).filter((i) => !i.converted_lead_id);
    if (!pending.length) return ok("Already in the CRM.");

    let position = await nextPosition(supabase, targetStage);

    const rows = pending.map((i) => {
      const contact = String(i.contact ?? "");
      const isEmail = contact.includes("@");
      return {
        stage_id: targetStage,
        name: i.name,
        company: i.business,
        email: isEmail ? contact : null,
        phone: isEmail ? null : contact,
        source: i.source ? `inquiry · ${i.source}` : "inquiry",
        notes: [i.focus ? `Focus: ${i.focus}` : null, i.message].filter(Boolean).join("\n\n") || null,
        next_action: "Reply and book the walkthrough",
        position: position++,
        inquiry_id: i.id,
        created_by: user.id,
      };
    });

    const { data: leads, error: insertError } = await supabase
      .from("leads")
      .insert(rows)
      .select("id, inquiry_id");
    if (insertError) throw insertError;

    await Promise.all(
      (leads ?? []).map((lead) =>
        supabase
          .from("inquiries")
          .update({ status: "converted", converted_lead_id: lead.id })
          .eq("id", lead.inquiry_id as string),
      ),
    );

    revalidatePath("/admin/inquiries");
    revalidatePath("/admin/crm");
    revalidatePath("/admin");
    return ok(`${rows.length} lead${rows.length === 1 ? "" : "s"} added to the CRM.`);
  } catch (e) {
    return fail(e);
  }
}
