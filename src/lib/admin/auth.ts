import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_READY } from "@/lib/supabase/env";
import type { Profile } from "./types";

/**
 * The single gate every admin page and Server Action goes through.
 *
 * Server Actions are reachable by direct POST, so authorisation is checked here
 * rather than trusted from the proxy redirect. Signed in but not an admin →
 * straight back out, no half-rendered dashboard.
 */
export async function requireAdmin() {
  // No keys yet → the login page explains what to do instead of throwing here.
  if (!SUPABASE_READY) redirect("/admin/login");

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile || profile.role !== "admin") redirect("/admin/login?denied=1");

  return { supabase, user, profile };
}
