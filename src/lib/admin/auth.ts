import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_READY } from "@/lib/supabase/env";
import { canAccess, firstAllowedHref, isSuperAdmin } from "./modules";
import type { AccessKey, Profile } from "./types";

/**
 * The gates every admin page and Server Action goes through.
 *
 * Server Actions are reachable by direct POST, so authorisation is checked
 * here rather than trusted from the proxy redirect — and RLS checks it again
 * underneath. Pages redirect; actions throw a plain Error so the existing
 * `try { … } catch (e) { return fail(e) }` turns it into a readable toast
 * (a redirect would surface as "NEXT_REDIRECT").
 */

const PROFILE_COLUMNS = "id, email, full_name, role, permissions, workspace, is_active, title, created_at";

export type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string };
  profile: Profile;
};

/**
 * Who is asking, once per request. Returns null for "not signed in", and a
 * session with `profile: null` when signed in but without a readable, active
 * profile (viewers and deactivated accounts can't read their own row — the
 * workspace fence hides it).
 */
export const getSession = cache(async () => {
  if (!SUPABASE_READY) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle<Profile>();

  const usable = profile && profile.is_active && profile.role !== "viewer" ? profile : null;
  return { supabase, user: { id: user.id, email: user.email }, profile: usable };
});

/** Any active team member. */
export async function requireUser(): Promise<Session> {
  // No keys yet → the login page explains what to do instead of throwing here.
  if (!SUPABASE_READY) redirect("/admin/login");
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if (!session.profile) redirect("/admin/login?denied=1");
  return session as Session;
}

/** A page inside one module. Without access you land on the first page you can open. */
export async function requireModule(key: AccessKey): Promise<Session> {
  const session = await requireUser();
  if (!canAccess(session.profile, key)) redirect(firstAllowedHref(session.profile));
  return session;
}

export async function requireSuperAdmin(): Promise<Session> {
  const session = await requireUser();
  if (!isSuperAdmin(session.profile)) redirect(firstAllowedHref(session.profile));
  return session;
}

/* ───────────────────────────── for actions ───────────────────────────── */

export class AccessError extends Error {}

/** Any active member (Approvals, My account, notifications, search). */
export async function authorizeUser(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AccessError("Your session has ended. Sign in again.");
  if (!session.profile) throw new AccessError("This account doesn't have access.");
  return session as Session;
}

export async function authorize(key: AccessKey): Promise<Session> {
  const session = await authorizeUser();
  if (!canAccess(session.profile, key)) {
    throw new AccessError(`You don't have access to ${labelFor(key)}.`);
  }
  return session;
}

export async function authorizeSuperAdmin(): Promise<Session> {
  const session = await authorizeUser();
  if (!isSuperAdmin(session.profile)) {
    throw new AccessError(
      session.profile.workspace === "demo" ? "That's disabled in the demo." : "Only the super admin can do that.",
    );
  }
  return session;
}

function labelFor(key: AccessKey) {
  const labels: Record<AccessKey, string> = {
    dashboard: "the dashboard",
    inquiries: "Inquiries",
    email: "Email",
    crm: "the CRM",
    clients: "Clients",
    invoices: "Invoices",
    finance: "Expenses",
    reports: "Reports",
    calendar: "the calendar",
    todos: "To-dos",
    workload: "Workload",
    team: "Team & Users",
  };
  return labels[key];
}
