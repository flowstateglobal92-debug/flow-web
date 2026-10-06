import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { canAccess } from "@/lib/admin/modules";
import { loadTeam } from "@/lib/admin/team";
import type { Lead, Stage } from "@/lib/admin/types";
import { PageHead } from "@/components/admin/ui";
import { loadClientOptions, selectTolerant } from "../clients/data";
import Board, { type TrailEntry } from "./Board";

export const metadata: Metadata = { title: "CRM" };

const LEAD_COLUMNS =
  "id, stage_id, name, company, email, phone, value, currency, score, source, notes, next_action, position, inquiry_id, created_at, updated_at";

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { supabase, profile } = await requireModule("crm");
  const { lead: focus } = await searchParams;

  const [{ data: stages }, leads, { data: activities }, team, clients] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, name, slug, position, tone, is_protected, is_won, is_lost")
      .order("position", { ascending: true })
      .returns<Stage[]>(),
    // Owners (0012) and client links (0011) may lag behind the board itself.
    selectTolerant<Lead>(
      (columns) => supabase.from("leads").select(columns).order("position", { ascending: true }).returns<Lead[]>(),
      LEAD_COLUMNS,
      "owner_id, client_id",
    ),
    supabase
      .from("lead_activities")
      .select("id, lead_id, kind, body, actor_id, created_at")
      .order("created_at", { ascending: false })
      .limit(400)
      .returns<TrailEntry[]>(),
    loadTeam(supabase),
    loadClientOptions(supabase),
  ]);

  // Owners must be able to open the CRM — the database refuses anyone else.
  const owners = team.filter((m) => canAccess({ ...m, workspace: profile.workspace }, "crm"));

  return (
    <>
      <PageHead
        eyebrow="Pipeline"
        title="CRM"
        hint="Drag a card to move it through the pipeline. Stages are yours to rename, reorder and add to — except New leads, which every inquiry lands in."
      />
      <Board
        stages={stages ?? []}
        leads={leads.rows}
        activities={activities ?? []}
        team={team}
        owners={owners}
        clients={clients}
        me={profile.id}
        can={{
          clients: canAccess(profile, "clients"),
          invoices: canAccess(profile, "invoices"),
          ownership: leads.full,
        }}
        focus={focus ?? null}
      />
    </>
  );
}
