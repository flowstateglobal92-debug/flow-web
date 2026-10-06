import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ActionResult = { ok: boolean; error?: string; message?: string; id?: string };

export const ok = (message?: string, id?: string): ActionResult => ({ ok: true, message, id });
export const fail = (error: unknown): ActionResult => ({
  ok: false,
  error: friendly(error),
});

/** Supabase errors arrive as plain objects with a message; RLS denials get a human sentence. */
function friendly(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "Something went wrong.");
  if (/row-level security|permission denied/i.test(raw)) return "You don't have permission to do that.";
  return raw;
}

/**
 * RLS doesn't error when it filters a row out of an UPDATE/DELETE — it just
 * touches nothing. Chain `.select("id")` and pass the rows here so a blocked
 * change reports as blocked instead of "Saved".
 */
export function mustAffect(rows: unknown[] | null | undefined, message = "You can't change this item.") {
  if (!rows || rows.length === 0) throw new Error(message);
}

/** Next free slot at the bottom of a kanban column. */
export async function nextPosition(supabase: SupabaseClient, stageId: string) {
  const { data } = await supabase
    .from("leads")
    .select("position")
    .eq("stage_id", stageId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>();
  return (data?.position ?? -1) + 1;
}

export const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
export const optional = (fd: FormData, key: string) => text(fd, key) || null;
export const amount = (fd: FormData, key: string) => {
  const n = Number(String(fd.get(key) ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
