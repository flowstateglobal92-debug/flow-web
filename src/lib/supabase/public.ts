import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/**
 * Anonymous client with no cookies — for the public website form.
 *
 * The cookie-bound server client would send a signed-in admin's (or the demo
 * account's) session along with a visitor's submission. This one always posts
 * as `anon`, which RLS only allows to insert a fresh inquiry into the live
 * workspace.
 */
let client: SupabaseClient | null = null;

export function createPublicClient(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
