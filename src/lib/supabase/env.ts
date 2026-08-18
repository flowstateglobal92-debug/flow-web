/**
 * Supabase connection details.
 *
 * Both the legacy `ANON_KEY` and the newer `PUBLISHABLE_KEY` names are read so
 * the project works whichever one the Supabase dashboard hands out. Each
 * `process.env.NEXT_PUBLIC_*` read is written out literally — Next.js inlines
 * these at build time by exact match, so they cannot be built dynamically.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

/** False until the env vars are filled in — used to show a setup notice instead of crashing. */
export const SUPABASE_READY = Boolean(SUPABASE_URL && SUPABASE_KEY);

export function assertSupabaseEnv() {
  if (!SUPABASE_READY) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
    );
  }
}
