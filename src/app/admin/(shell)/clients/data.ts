import "server-only";

import type { Session } from "@/lib/admin/auth";
import { clientTitle, type ClientOption } from "./model";

type Db = Session["supabase"];
type DbError = { code?: string; message?: string } | null;

/**
 * Reads that survive a migration that hasn't run yet. Clients (0011),
 * ownership (0012), invoices (0013) and friends land separately, and a page
 * should render empty rather than crash while one of them is missing.
 */

/** Postgres "undefined table / column" and PostgREST's schema-cache misses. */
const MISSING = new Set(["42P01", "42703", "PGRST200", "PGRST204", "PGRST205"]);
export const isMissing = (error: DbError | undefined) => !!error?.code && MISSING.has(error.code);

/**
 * Select `base, extra`; if a column in `extra` doesn't exist yet, select
 * `base` alone. `full` says whether the extra columns came back; `ready` is
 * false when even the plain select fails because the table is missing.
 */
export async function selectTolerant<T>(
  run: (columns: string) => PromiseLike<{ data: T[] | null; error: DbError }>,
  base: string,
  extra: string,
): Promise<{ rows: T[]; ready: boolean; full: boolean }> {
  const all = await run(`${base}, ${extra}`);
  if (!all.error) return { rows: all.data ?? [], ready: true, full: true };
  if (!isMissing(all.error)) return { rows: [], ready: true, full: true };
  const plain = await run(base);
  return { rows: plain.data ?? [], ready: !isMissing(plain.error), full: false };
}

/** Rows or nothing — for side panels whose module may not be installed yet. */
export async function rowsOrEmpty<T>(query: PromiseLike<{ data: T[] | null; error: DbError }>): Promise<T[]> {
  const { data, error } = await query;
  return error ? [] : (data ?? []);
}

/** Non-archived clients for pickers. CRM, invoices and calendar users can read these too (0011). */
export async function loadClientOptions(supabase: Db): Promise<ClientOption[]> {
  const rows = await rowsOrEmpty(
    supabase
      .from("clients")
      .select("id, name, company, status")
      .neq("status", "archived")
      .order("name", { ascending: true })
      .limit(500)
      .returns<ClientOption[]>(),
  );
  // Sorted the way they're shown — business first.
  return rows.sort((a, b) => clientTitle(a).localeCompare(clientTitle(b)));
}
