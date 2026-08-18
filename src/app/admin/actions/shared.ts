import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ActionResult = { ok: boolean; error?: string; message?: string };

export const ok = (message?: string): ActionResult => ({ ok: true, message });
export const fail = (error: unknown): ActionResult => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error ?? "Something went wrong."),
});

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
