"use server";

import { revalidatePath } from "next/cache";
import { authorizeUser } from "@/lib/admin/auth";
import { fail, mustAffect, ok, optional, text, type ActionResult } from "./shared";

/** Your own name and job title — the only profile fields anyone edits about themselves. */
export async function updateMyProfile(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeUser();
    const full_name = text(formData, "full_name");
    if (!full_name) return { ok: false, error: "Add your name." };

    const { data, error } = await supabase
      .from("profiles")
      .update({ full_name, title: optional(formData, "title") })
      .eq("id", profile.id)
      .select("id");
    if (error) throw error;
    mustAffect(data);

    revalidatePath("/admin", "layout");
    return ok("Profile saved.");
  } catch (e) {
    return fail(e);
  }
}

/** Change your own password. The current one is checked first. Not available in the demo. */
export async function changeMyPassword(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, profile, user } = await authorizeUser();
    if (profile.workspace === "demo") return { ok: false, error: "The demo password can't be changed." };

    const current = String(formData.get("current") ?? "");
    const next = String(formData.get("next") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (next.length < 8) return { ok: false, error: "Use at least 8 characters." };
    if (next !== confirm) return { ok: false, error: "The new passwords don't match." };

    const { error: wrong } = await supabase.auth.signInWithPassword({ email: user.email ?? profile.email, password: current });
    if (wrong) return { ok: false, error: "Your current password isn't right." };

    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) throw error;
    return ok("Password changed.");
  } catch (e) {
    return fail(e);
  }
}
