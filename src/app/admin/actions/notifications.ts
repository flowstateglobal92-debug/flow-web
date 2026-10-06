"use server";

import { authorizeUser } from "@/lib/admin/auth";
import { loadTeam } from "@/lib/admin/team";
import type { TeamMember } from "@/lib/admin/types";
import { fail, ok, type ActionResult } from "./shared";

/**
 * The bell's few writes. Nothing here revalidates: marking an alert read is
 * applied optimistically in the browser, and re-rendering the whole route for
 * a dot would be the slowest part of the click. The API may only touch
 * `read_at` on your own rows (0009 column grant + policy).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function markNotificationsRead(ids: string[]): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeUser();
    const clean = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((id) => UUID.test(id)))].slice(0, 200);
    if (clean.length === 0) return ok();

    // Already-read rows are skipped, so this is safe to repeat.
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", clean)
      .eq("recipient_id", profile.id)
      .is("read_at", null);
    if (error) throw error;
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeUser();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", profile.id)
      .is("read_at", null);
    if (error) throw error;
    return ok("All caught up.");
  } catch (e) {
    return fail(e);
  }
}

/** Teammates for avatars in the bell and alerts — the Shell only knows the viewer. */
export async function getTeamDirectory(): Promise<TeamMember[]> {
  try {
    const { supabase } = await authorizeUser();
    return await loadTeam(supabase);
  } catch {
    return [];
  }
}
