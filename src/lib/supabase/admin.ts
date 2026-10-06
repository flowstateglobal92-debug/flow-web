import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Service-role client — bypasses RLS. Used only by Team & Users (creating,
 * banning and deleting accounts) and the demo heal/reset.
 *
 * Built with supabase-js, never @supabase/ssr: an SSR client would attach the
 * signed-in user's cookie session and supabase-js prefers that token over the
 * key, so requests would silently run as the user instead. The key is read
 * inside the function so nothing at module level can inline it into a bundle.
 */
let client: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !SUPABASE_URL) {
    throw new Error("Team management needs SUPABASE_SERVICE_ROLE_KEY in the environment.");
  }
  client ??= createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

/** True when the key is present — Team & Users shows a setup notice otherwise. */
export function serviceRoleReady() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL);
}
