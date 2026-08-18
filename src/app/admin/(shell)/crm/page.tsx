import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import type { Lead, LeadActivity, Stage } from "@/lib/admin/types";
import { PageHead } from "@/components/admin/ui";
import Board from "./Board";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmPage() {
  const { supabase } = await requireAdmin();

  const [{ data: stages }, { data: leads }, { data: activities }] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, name, slug, position, tone, is_protected, is_won, is_lost")
      .order("position", { ascending: true })
      .returns<Stage[]>(),
    supabase
      .from("leads")
      .select(
        "id, stage_id, name, company, email, phone, value, currency, score, source, notes, next_action, position, inquiry_id, created_at, updated_at",
      )
      .order("position", { ascending: true })
      .returns<Lead[]>(),
    supabase
      .from("lead_activities")
      .select("id, lead_id, kind, body, created_at")
      .order("created_at", { ascending: false })
      .limit(400)
      .returns<LeadActivity[]>(),
  ]);

  return (
    <>
      <PageHead
        eyebrow="Pipeline"
        title="CRM"
        hint="Drag a card to move it through the pipeline. Stages are yours to rename, reorder and add to — except New leads, which every inquiry lands in."
      />
      <Board stages={stages ?? []} leads={leads ?? []} activities={activities ?? []} />
    </>
  );
}
