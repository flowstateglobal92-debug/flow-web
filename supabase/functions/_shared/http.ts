// Request plumbing shared by the desktop app's functions. Every function is
// POST { op, ...args } with the caller's Supabase access token as a bearer
// token, and answers { ok, error?, message?, id?, data? } — the same
// ActionResult shape the web admin's Server Actions return.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type Result = { ok: boolean; error?: string; message?: string; id?: string; data?: unknown };

export const reply = (body: Result, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const failed = (error: unknown, status = 200) => reply({ ok: false, error: friendly(error) }, status);

/** Supabase errors arrive as plain objects with a message; RLS denials get a human sentence. */
export function friendly(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "Something went wrong.");
  if (/row-level security|permission denied/i.test(raw)) return "You don't have permission to do that.";
  return raw;
}

export type Caller = { supabase: SupabaseClient; user: User; token: string };

/**
 * The person calling, with a client that acts as them (RLS applies). Null
 * when the token is missing, expired or revoked.
 */
export async function caller(req: Request): Promise<Caller | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("The function is missing SUPABASE_URL / SUPABASE_ANON_KEY.");
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { supabase, user: data.user, token };
}

/** The body as an object, or null when it isn't JSON. */
export async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json();
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const str = (v: unknown) => (typeof v === "string" ? v : "");
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
