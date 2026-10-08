"use server";

import { revalidatePath } from "next/cache";
import { authorize, type Session } from "@/lib/admin/auth";
import { canAccess, roleAllows } from "@/lib/admin/modules";
import type { Role } from "@/lib/admin/types";
import type { ClientStatus } from "@/app/admin/(shell)/clients/model";
import { fail, mustAffect, ok, optional, text, type ActionResult } from "./shared";

const STATUSES: ClientStatus[] = ["active", "prospect", "archived"];

const refresh = (id?: string) => {
  revalidatePath("/admin/clients");
  if (id) revalidatePath(`/admin/clients/${id}`);
};

/** Form → columns. Notes and the account manager are handled separately so an edit can leave them alone. */
function clientFields(fd: FormData) {
  const status = text(fd, "status") as ClientStatus;
  return {
    name: text(fd, "name"),
    company: optional(fd, "company"),
    email: optional(fd, "email"),
    phone: optional(fd, "phone"),
    address: optional(fd, "address"),
    city: optional(fd, "city"),
    country: optional(fd, "country"),
    tax_id: optional(fd, "tax_id"),
    website: optional(fd, "website"),
    status: STATUSES.includes(status) ? status : "active",
    // Billing preferences (0037/0038) — only when the form showed them.
    ...(fd.has("billing_prefs") && {
      statement_monthly: fd.get("statement_monthly") === "on",
      reminders_paused: fd.get("reminders_paused") === "on",
    }),
  };
}

/**
 * An account manager has to be an active teammate here who can open Clients.
 * 0012 checks the same thing; this says it in a sentence.
 */
async function canManage(session: Session, id: string) {
  const { data } = await session.supabase
    .from("profiles")
    .select("id, role, permissions, is_active")
    .eq("id", id)
    .maybeSingle<{ id: string; role: Role; permissions: string[]; is_active: boolean }>();
  return !!data && roleAllows(data.role, data.permissions, session.profile.workspace, data.is_active, "clients");
}

/** A blank pick means "leave it" — the database defaults a new client to whoever creates it. */
async function managerFrom(session: Session, fd: FormData) {
  const id = text(fd, "account_manager_id");
  if (!id) return undefined;
  if (!(await canManage(session, id))) throw new Error("Pick an account manager who can open Clients.");
  return id;
}

/** Deleting a client that invoices still point at trips the foreign key. */
const blockedByInvoices = (e: unknown) =>
  typeof e === "object" && !!e && "code" in e && (e as { code?: string }).code === "23503";

/* ───────────────────────────── clients ───────────────────────────────── */

export async function addClient(formData: FormData): Promise<ActionResult> {
  try {
    const session = await authorize("clients");
    const fields = clientFields(formData);
    if (!fields.name) return { ok: false, error: "A client needs a contact name." };
    const manager = await managerFrom(session, formData);

    const { data, error } = await session.supabase
      .from("clients")
      .insert({ ...fields, notes: optional(formData, "notes"), ...(manager && { account_manager_id: manager }) })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;

    refresh();
    return ok("Client added.", data.id);
  } catch (e) {
    return fail(e);
  }
}

export async function updateClient(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const session = await authorize("clients");
    const fields = clientFields(formData);
    if (!fields.name) return { ok: false, error: "A client needs a contact name." };
    const manager = await managerFrom(session, formData);

    const { data, error } = await session.supabase
      .from("clients")
      .update({
        ...fields,
        ...(formData.has("notes") && { notes: optional(formData, "notes") }),
        ...(manager && { account_manager_id: manager }),
      })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    mustAffect(data);

    refresh(id);
    return ok("Client updated.", id);
  } catch (e) {
    return fail(e);
  }
}

export async function setClientStatus(id: string, status: ClientStatus): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("clients");
    if (!STATUSES.includes(status)) return { ok: false, error: "Unknown status." };
    const { data, error } = await supabase.from("clients").update({ status }).eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh(id);
    return ok(status === "archived" ? "Client archived." : "Client restored.", id);
  } catch (e) {
    return fail(e);
  }
}

export async function saveClientNotes(id: string, notes: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("clients");
    const { data, error } = await supabase
      .from("clients")
      .update({ notes: notes.trim() || null })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    mustAffect(data);
    refresh(id);
    return ok("Notes saved.", id);
  } catch (e) {
    return fail(e);
  }
}

/** Leads and events let go of the client (on delete set null); invoices hold on to it. */
export async function deleteClient(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("clients");
    const { data, error } = await supabase.from("clients").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);
    refresh();
    revalidatePath("/admin/crm");
    return ok("Client deleted.");
  } catch (e) {
    if (blockedByInvoices(e)) {
      return { ok: false, error: "This client has invoices or quotes — archive it instead." };
    }
    return fail(e);
  }
}

/* ─────────────────────────── from the CRM ────────────────────────────── */

type LeadForClient = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  owner_id: string | null;
  client_id: string | null;
  stage: { is_won: boolean } | null;
};

/**
 * Turn a lead into a client and link the two. A client with the same email
 * is reused rather than duplicated (a repeat customer's new deal). Won leads
 * become active clients; anything earlier is a prospect. The lead's owner
 * manages the account when they can open Clients, otherwise whoever converts.
 */
export async function convertLeadToClient(leadId: string): Promise<ActionResult> {
  try {
    const session = await authorize("clients");
    const { supabase, profile } = session;
    if (!canAccess(profile, "crm")) return { ok: false, error: "You don't have access to the CRM." };

    const { data: lead, error: readError } = await supabase
      .from("leads")
      .select("id, name, company, email, phone, owner_id, client_id, stage:pipeline_stages(is_won)")
      .eq("id", leadId)
      .maybeSingle<LeadForClient>();
    if (readError) throw readError;
    if (!lead) return { ok: false, error: "That lead no longer exists." };
    if (lead.client_id) return ok("Already a client.", lead.client_id);

    let clientId: string | null = null;
    let reused = false;
    if (lead.email?.trim()) {
      // Case-insensitive: Nadia@Perera.lk is the client nadia@perera.lk. ilike's
      // wildcards (and PostgREST's `*` for `%`) are escaped so it's an exact match.
      const exact = lead.email.trim().replace(/[\\%_*]/g, (m) => `\\${m}`);
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .ilike("email", exact)
        .neq("status", "archived")
        .limit(1)
        .maybeSingle<{ id: string }>();
      clientId = existing?.id ?? null;
      reused = !!clientId;
    }

    if (!clientId) {
      const manager = lead.owner_id && (await canManage(session, lead.owner_id)) ? lead.owner_id : undefined;
      const { data: created, error: insertError } = await supabase
        .from("clients")
        .insert({
          name: lead.name,
          company: lead.company,
          email: lead.email,
          phone: lead.phone,
          status: lead.stage?.is_won ? "active" : "prospect",
          ...(manager && { account_manager_id: manager }),
        })
        .select("id")
        .single<{ id: string }>();
      if (insertError) throw insertError;
      clientId = created.id;
    }

    const { data: linked, error: linkError } = await supabase
      .from("leads")
      .update({ client_id: clientId })
      .eq("id", leadId)
      .select("id");
    if (linkError) throw linkError;
    mustAffect(linked, "The client was saved, but this lead couldn't be linked to it.");

    revalidatePath("/admin/crm");
    refresh(clientId);
    return ok(reused ? "Linked to the existing client with that email." : "Client created.", clientId);
  } catch (e) {
    return fail(e);
  }
}
