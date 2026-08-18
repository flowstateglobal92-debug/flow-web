"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_READY } from "@/lib/supabase/env";

export type AuthState = { error: string | null };

/**
 * Email + password sign-in. Accounts are created in the Supabase dashboard —
 * there is no public signup — and the first account created is the admin
 * (migration 0001). A signed-in non-admin is refused here rather than being
 * let through to bounce off `requireAdmin`.
 */
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!SUPABASE_READY) {
    return { error: "Supabase is not configured. Add the keys to .env.local and restart the server." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: error?.message ?? "Could not sign you in." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle<{ role: string }>();

  if (profile?.role !== "admin") {
    await supabase.auth.signOut();
    return { error: "That account doesn't have admin access." };
  }

  revalidatePath("/admin", "layout");
  // Only same-origin paths — never bounce to an attacker-supplied absolute URL.
  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/admin", "layout");
  redirect("/admin/login");
}
