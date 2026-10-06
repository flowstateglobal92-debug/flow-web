import "server-only";

import type { Session } from "./auth";
import type { TeamMember } from "./types";

/**
 * Active teammates in the caller's workspace (RLS scopes it), for pickers,
 * avatars and @mentions. Filter by module with `canAccess` before offering
 * someone as an assignee — the database re-checks.
 */
export async function loadTeam(supabase: Session["supabase"]): Promise<TeamMember[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, permissions, title, is_active")
    .eq("is_active", true)
    .neq("role", "viewer")
    .order("full_name", { ascending: true, nullsFirst: false })
    .returns<TeamMember[]>();
  return data ?? [];
}

/** Client-safe; re-exported so server code can keep importing it from here. */
export { displayName } from "./format";
